import { Router } from 'express';
import fs from 'fs';
import path from 'path';
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
import { seedDemoEnvironment } from '../services/demoSeed';
import {
  logAuditSafe,
  requireAuth,
  requireCsrf,
  requirePermission,
  requireSupabaseConfigured,
} from '../middleware/auth';
import type { SystemStatusResponse } from '../../src/shared/types';
import { emitSyncEvent } from '../services/eventBus';
import { startSupabaseRealtime } from '../services/supabaseRealtime';
import { getLastReminderRunAt, startReminderScheduler } from '../services/reminderScheduler';

export const systemRouter = Router();

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
  return res.status(ok ? 200 : 200).json({
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

// Initial bootstrap seed allowed ONLY when no users exist yet in Supabase
systemRouter.post('/bootstrap-demo', requireSupabaseConfigured, async (req, res) => {
  try {
    const anyUsers = await repository.hasAnyUsers();
    if (anyUsers) {
      return res.status(403).json({
        error: 'Des utilisateurs existent déjà. Connectez-vous en administrateur pour réinitialiser la démonstration.',
      });
    }
    const result = await seedDemoEnvironment('Initialisation initiale');
    await logAuditSafe(req, 'DEMO_SEED', 'system', 'demo', 'INFO', 'Initialisation initiale des données de démonstration');
    emitSyncEvent('system');
    return res.json({ ok: true, ...result });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Erreur lors de l’initialisation Supabase.' });
  }
});

// Admin-protected demo reset (preserves non-demo production records & audit logs)
systemRouter.post(
  '/reset-demo',
  requireSupabaseConfigured,
  requireAuth,
  requireCsrf,
  requirePermission('settings:manage'),
  async (req, res) => {
    try {
      const result = await seedDemoEnvironment(`${req.user!.firstName} ${req.user!.lastName}`);
      await logAuditSafe(
        req,
        'DEMO_RESET',
        'system',
        'demo',
        'WARNING',
        'Réinitialisation des données fictives de démonstration'
      );
      emitSyncEvent('system');
      return res.json({ ok: true, ...result });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Échec de réinitialisation de la démonstration.' });
    }
  }
);
