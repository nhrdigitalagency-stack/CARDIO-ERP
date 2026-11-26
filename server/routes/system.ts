import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import {
  getEnvConfig,
  getMissingEnvVars,
  isR2Configured,
  isResendConfigured,
  isSupabaseConfigured,
  isWhatsAppConfigured,
} from '../config/env';
import { repository } from '../repositories/SupabaseRepository';
import { testR2Connection } from '../services/r2Storage';
import { ensureClinicBaseline } from '../services/clinicBootstrap';
import { hashPassword } from '../services/security';
import { logAuditSafe, requireSupabaseConfigured } from '../middleware/auth';
import type { SystemStatusResponse } from '../../src/shared/types';
import { emitSyncEvent } from '../services/eventBus';
import { startSupabaseRealtime } from '../services/supabaseRealtime';
import { getLastReminderRunAt, startReminderScheduler } from '../services/reminderScheduler';

export const systemRouter = Router();

let bootstrapAdminInFlight = false;

const bootstrapAdminSchema = z.object({
  title: z.string().trim().max(30).optional(),
  firstName: z.string().trim().min(2, 'Prénom requis (min. 2 caractères)').max(80),
  lastName: z.string().trim().min(2, 'Nom requis (min. 2 caractères)').max(80),
  email: z.string().trim().email('Adresse e-mail invalide').max(160),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,40}$/, 'Identifiant invalide (3-40 caractères, lettres/chiffres/._-)'),
  phone: z.string().trim().max(40).optional(),
  specialty: z.string().trim().max(100).optional(),
  password: z.string().min(8, 'Le mot de passe doit contenir au moins 8 caractères.').max(128),
});

systemRouter.get('/status', async (_req, res) => {
  const cfg = getEnvConfig();
  const missingEnvVars = getMissingEnvVars();
  const supabaseConfigured = isSupabaseConfigured();
  const r2Configured = isR2Configured();
  const resendConfigured = isResendConfigured();
  const whatsappConfigured = isWhatsAppConfigured();

  let supabaseConnected = false;
  let supabaseSchemaReady = false;
  let supabaseError: string | undefined;
  let hasDemoData = false;
  let hasAnyUsers = false;

  if (supabaseConfigured) {
    const check = await repository.testConnection();
    supabaseConnected = check.ok;
    supabaseSchemaReady = Boolean(check.schemaReady);
    supabaseError = check.error;
    if (check.ok && check.schemaReady) {
      startSupabaseRealtime();
      startReminderScheduler();
      try {
        hasAnyUsers = await repository.hasAnyUsers();
        hasDemoData = await repository.hasDemoData();
      } catch {
        // Ignore secondary probe error
      }
    }
  }

  let r2Connected = false;
  let r2Error: string | undefined;
  if (r2Configured) {
    const r2Check = await testR2Connection();
    r2Connected = r2Check.ok;
    r2Error = r2Check.error;
  }

  const payload: SystemStatusResponse = {
    supabaseConfigured,
    supabaseConnected,
    supabaseSchemaReady,
    supabaseError,
    r2Configured,
    r2Connected,
    r2BucketName: cfg.r2BucketName || undefined,
    r2Error,
    resendConfigured,
    resendFromEmail: cfg.resendFromEmail || undefined,
    whatsappConfigured,
    whatsappProvider: cfg.whatsappProvider,
    missingEnvVars,
    sessionSecretConfigured: cfg.sessionSecretConfigured,
    hasDemoData,
    hasAnyUsers,
    lastReminderRunAt: getLastReminderRunAt() || undefined,
  };
  res.json(payload);
});

systemRouter.post('/test-connections', async (_req, res) => {
  const cfg = getEnvConfig();
  const supabaseConfigured = isSupabaseConfigured();
  const r2Configured = isR2Configured();
  const resendConfigured = isResendConfigured();

  const supabaseResult = supabaseConfigured
    ? await repository.testConnection()
    : { ok: false, schemaReady: false, error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants.' };

  const r2Result = r2Configured
    ? await testR2Connection()
    : { ok: false, error: 'Variables Cloudflare R2 (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_ENDPOINT/R2_ACCOUNT_ID) manquantes.' };

  let hasAnyUsers = false;
  if (supabaseResult.ok && supabaseResult.schemaReady) {
    startSupabaseRealtime();
    startReminderScheduler();
    hasAnyUsers = await repository.hasAnyUsers().catch(() => false);
  }

  const ok = Boolean(supabaseResult.ok && supabaseResult.schemaReady);
  return res.status(200).json({
    ok,
    hasAnyUsers,
    supabase: supabaseResult,
    r2: {
      configured: r2Configured,
      ok: r2Result.ok,
      bucketName: cfg.r2BucketName || undefined,
      error: r2Result.error,
    },
    resend: {
      configured: resendConfigured,
      fromEmail: cfg.resendFromEmail || undefined,
    },
    whatsapp: {
      configured: isWhatsAppConfigured(),
      provider: cfg.whatsappProvider,
    },
  });
});

// Serves the exact PostgreSQL + RLS migration script so admins can copy it into Supabase SQL Editor
systemRouter.get('/schema-sql', async (_req, res) => {
  try {
    const sqlPath = path.resolve(process.cwd(), 'supabase', 'schema.sql');
    const sql = await fs.promises.readFile(sqlPath, 'utf-8');
    return res.json({ sql });
  } catch {
    return res.status(404).json({ error: 'Fichier supabase/schema.sql introuvable.' });
  }
});

// One-time initial administrator setup — permanently locked once any user exists in Supabase
systemRouter.post('/bootstrap-admin', requireSupabaseConfigured, async (req, res) => {
  if (bootstrapAdminInFlight) {
    return res.status(409).json({ error: 'Initialisation déjà en cours.' });
  }
  bootstrapAdminInFlight = true;
  try {
    const anyUsers = await repository.hasAnyUsers();
    if (anyUsers) {
      return res.status(403).json({
        error: 'Un compte administrateur existe déjà. Connectez-vous pour gérer les utilisateurs.',
      });
    }

    const parsed = bootstrapAdminSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Données invalides.' });
    }

    const data = parsed.data;
    const now = new Date().toISOString();
    await ensureClinicBaseline();
    const passwordHash = await hashPassword(data.password);

    const adminUser = await repository.createUser({
      email: data.email.toLowerCase(),
      username: data.username,
      firstName: data.firstName,
      lastName: data.lastName,
      title: data.title || 'Dr',
      specialty: data.specialty || 'Cardiologie & Direction médicale',
      phone: data.phone || undefined,
      roles: ['ADMIN', 'MEDECIN'],
      isActive: true,
      isDemo: false,
      passwordHash,
      createdAt: now,
      updatedAt: now,
    });

    await logAuditSafe(
      req,
      'ADMIN_BOOTSTRAP',
      'user',
      adminUser._id,
      'SECURITY',
      `Création initiale du compte administrateur (${adminUser.username})`
    );
    emitSyncEvent('system');
    return res.status(201).json({
      ok: true,
      username: adminUser.username,
      email: adminUser.email,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Erreur lors de l'initialisation du compte administrateur." });
  } finally {
    bootstrapAdminInFlight = false;
  }
});
