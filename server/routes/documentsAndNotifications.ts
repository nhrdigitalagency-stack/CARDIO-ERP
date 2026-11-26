import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { z } from 'zod';
import { repository } from '../repositories/SupabaseRepository';
import { isR2Configured } from '../config/env';
import { getFileStreamFromR2, uploadFileToR2 } from '../services/r2Storage';
import { hasPermission } from '../services/security';
import {
  logAuditSafe,
  requireAnyPermission,
  requireAuth,
  requireCsrf,
  requirePermission,
  requireSupabaseConfigured,
} from '../middleware/auth';
import { emitSyncEvent } from '../services/eventBus';
import { sendTestEmail } from '../services/emailService';
import { sendTestWhatsApp } from '../services/whatsappService';
import { runAutomaticReminders } from '../services/reminderScheduler';

export const documentsRouter = Router();
export const notificationsRouter = Router();

const ALLOWED_MIMES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      cb(new Error('Format non autorisé. Formats acceptés : PDF, PNG, JPEG, WEBP.'));
      return;
    }
    cb(null, true);
  },
});

documentsRouter.use(requireSupabaseConfigured, requireAuth, requireCsrf);
notificationsRouter.use(requireSupabaseConfigured, requireAuth, requireCsrf);

const MEDICAL_ONLY_CATEGORIES = new Set([
  'COMPTE_RENDU',
  'RESULTAT_ECG',
  'RESULTAT_HOLTER',
  'RESULTAT_MAPA',
  'RESULTAT_ECHOGRAPHIQUE',
  'PRESCRIPTION',
  'ORDONNANCE',
]);

documentsRouter.get(
  '/',
  requireAnyPermission(['documents:read_admin', 'documents:read_medical', 'portal:access']),
  async (req, res) => {
    const user = req.user!;
    const isPatient = user.roles.includes('PATIENT') && !hasPermission(user.roles, 'documents:read_admin');
    const isMedical = hasPermission(user.roles, 'documents:read_medical');

    if (isPatient && !user.patientId) return res.json({ documents: [] });

    const docs = await repository.listDocuments({
      patientId: isPatient ? user.patientId : typeof req.query.patientId === 'string' ? req.query.patientId : undefined,
      category: typeof req.query.category === 'string' ? req.query.category : undefined,
      includeArchived: req.query.includeArchived === 'true' && hasPermission(user.roles, 'patients:archive'),
    });

    if (isPatient) {
      return res.json({ documents: docs.filter((d) => d.sharedWithPatient) });
    }
    if (!isMedical) {
      return res.json({
        documents: docs.filter((d) => !MEDICAL_ONLY_CATEGORIES.has(d.category) || d.sharedWithPatient),
      });
    }
    return res.json({ documents: docs });
  }
);

documentsRouter.post('/upload', requirePermission('documents:write'), upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Aucun fichier sélectionné.' });
  }

  if (!isR2Configured()) {
    return res.status(503).json({
      error:
        'Stockage Cloudflare R2 non configuré. Veuillez renseigner les variables R2_* dans la configuration serveur pour téléverser des documents.',
      code: 'R2_NOT_CONFIGURED',
    });
  }

  const schema = z.object({
    title: z.string().min(2, 'Titre du document requis'),
    category: z.enum([
      'COMPTE_RENDU',
      'RESULTAT_ECG',
      'RESULTAT_HOLTER',
      'RESULTAT_MAPA',
      'RESULTAT_ECHOGRAPHIQUE',
      'PRESCRIPTION',
      'ORDONNANCE',
      'COURRIER_MEDICAL',
      'AUTRE',
    ]),
    patientId: z.string().min(1, 'Patient requis'),
    consultationId: z.string().optional(),
    examinationId: z.string().optional(),
    sharedWithPatient: z.union([z.boolean(), z.string()]).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Métadonnées invalides' });
  }

  const ext = path.extname(req.file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '') || '.bin';
  const safePatientSegment = parsed.data.patientId.replace(/[^a-zA-Z0-9_-]/g, '');
  const generatedFileName = `${crypto.randomUUID()}${ext}`;
  const storageKey = `documents/${safePatientSegment}/${generatedFileName}`;

  try {
    await uploadFileToR2({
      key: storageKey,
      body: req.file.buffer,
      contentType: req.file.mimetype,
      allowedPrefix: 'documents/',
      metadata: {
        patientId: safePatientSegment,
        category: parsed.data.category,
        uploadedById: req.user!._id,
      },
    });
  } catch (err: any) {
    console.error('[R2_UPLOAD_ERROR]', err?.message || err);
    return res.status(502).json({
      error: 'Échec du téléversement vers Cloudflare R2. Vérifiez vos identifiants et droits du bucket R2.',
    });
  }

  const isMedical = hasPermission(req.user!.roles, 'medical:write');
  const shared = isMedical && (parsed.data.sharedWithPatient === true || parsed.data.sharedWithPatient === 'true');

  const now = new Date().toISOString();
  const created = await repository.createDocument({
    title: parsed.data.title,
    category: parsed.data.category,
    patientId: parsed.data.patientId,
    consultationId: parsed.data.consultationId || undefined,
    examinationId: parsed.data.examinationId || undefined,
    fileName: generatedFileName,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
    storageKey,
    sharedWithPatient: shared,
    archived: false,
    uploadedById: req.user!._id,
    isDemo: false,
    createdAt: now,
    updatedAt: now,
  });

  // If linked to an examination, attach it automatically
  if (parsed.data.examinationId) {
    await repository.updateExamination(parsed.data.examinationId, {
      attachedDocumentId: created._id,
      updatedAt: now,
    });
  }

  await logAuditSafe(
    req,
    'DOCUMENT_UPLOADED',
    'medicalDocument',
    created._id,
    'INFO',
    `Import fichier R2: ${created.title} (${storageKey})`
  );
  emitSyncEvent(['document', 'examination', 'patient']);
  return res.status(201).json({ document: created });
});

documentsRouter.get(
  '/:id/download',
  requireAnyPermission(['documents:read_admin', 'documents:read_medical', 'portal:access']),
  async (req, res) => {
    const doc = await repository.findDocumentById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document introuvable.' });

    const user = req.user!;
    const isPatient = user.roles.includes('PATIENT') && !hasPermission(user.roles, 'documents:read_admin');
    const isMedical = hasPermission(user.roles, 'documents:read_medical');

    if (isPatient) {
      if (doc.patientId !== user.patientId || !doc.sharedWithPatient) {
        await logAuditSafe(
          req,
          'DOCUMENT_DOWNLOAD_BLOCKED',
          'medicalDocument',
          doc._id,
          'SECURITY',
          'Tentative téléchargement document non partagé'
        );
        return res.status(403).json({ error: 'Accès non autorisé à ce document.' });
      }
    } else if (!isMedical && MEDICAL_ONLY_CATEGORIES.has(doc.category) && !doc.sharedWithPatient) {
      await logAuditSafe(req, 'DOCUMENT_DOWNLOAD_BLOCKED', 'medicalDocument', doc._id, 'SECURITY', 'Accès médical requis');
      return res.status(403).json({ error: 'Ce document médical confidentiel est réservé au médecin.' });
    }

    if (!isR2Configured()) {
      return res.status(503).json({
        error: 'Stockage Cloudflare R2 non configuré sur ce serveur.',
        code: 'R2_NOT_CONFIGURED',
      });
    }

    try {
      const r2Object = await getFileStreamFromR2(doc.storageKey, 'documents/');
      await logAuditSafe(req, 'DOCUMENT_DOWNLOADED', 'medicalDocument', doc._id, 'INFO', `Téléchargement R2 ${doc.originalName}`);
      res.setHeader('Content-Type', doc.mimeType || r2Object.contentType || 'application/octet-stream');
      if (r2Object.contentLength) {
        res.setHeader('Content-Length', String(r2Object.contentLength));
      }
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.originalName)}"`);
      return r2Object.stream.pipe(res);
    } catch (err: any) {
      console.error('[R2_DOWNLOAD_ERROR]', err?.message || err);
      return res.status(404).json({ error: 'Fichier introuvable sur le stockage Cloudflare R2.' });
    }
  }
);

documentsRouter.patch('/:id', requirePermission('documents:write'), async (req, res) => {
  const doc = await repository.findDocumentById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document introuvable.' });

  const schema = z.object({
    sharedWithPatient: z.boolean().optional(),
    archived: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Paramètres invalides' });

  if (parsed.data.sharedWithPatient !== undefined && !hasPermission(req.user!.roles, 'medical:write')) {
    return res.status(403).json({ error: 'Seul le médecin peut partager un document médical avec le patient.' });
  }

  const updated = await repository.updateDocument(doc._id, {
    ...parsed.data,
    updatedAt: new Date().toISOString(),
  });
  await logAuditSafe(req, 'DOCUMENT_UPDATED', 'medicalDocument', doc._id, 'INFO', `Mise à jour document ${doc.title}`);
  emitSyncEvent(['document', 'patient']);
  return res.json({ document: updated });
});

// ---------------- NOTIFICATIONS & RESEND DISPATCH / AUTO REMINDERS ----------------

notificationsRouter.get('/', async (req, res) => {
  const list = await repository.listNotifications(req.user!._id, req.user!.roles);
  return res.json({ notifications: list });
});

notificationsRouter.get(
  '/email-logs',
  requireAnyPermission(['settings:manage', 'followups:read', 'audit:read']),
  async (_req, res) => {
    const logs = await repository.listEmailDispatches(100);
    return res.json({ logs });
  }
);

notificationsRouter.post('/test-email', requirePermission('settings:manage'), async (req, res) => {
  const schema = z.object({
    to: z.string().email('Adresse e-mail destinataire invalide'),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Adresse e-mail invalide' });
  }

  const actorName = `${req.user!.firstName} ${req.user!.lastName}`;
  const result = await sendTestEmail(parsed.data.to, actorName);
  await logAuditSafe(
    req,
    result.ok ? 'RESEND_TEST_EMAIL_SENT' : 'RESEND_TEST_EMAIL_FAILED',
    'notification',
    result.messageId,
    result.ok ? 'INFO' : 'WARNING',
    result.ok
      ? `E-mail de test Resend envoyé à ${parsed.data.to}`
      : `Échec e-mail de test Resend vers ${parsed.data.to} : ${result.error || result.status}`
  );
  emitSyncEvent('notification');

  if (!result.ok) {
    return res.status(502).json({
      ok: false,
      status: result.status,
      error: result.error || "Échec de l'envoi via Resend.",
    });
  }
  return res.json({
    ok: true,
    status: result.status,
    providerMessageId: result.messageId,
  });
});

notificationsRouter.post('/test-whatsapp', requirePermission('settings:manage'), async (req, res) => {
  const schema = z.object({
    phone: z.string().min(8, 'Numéro WhatsApp destinataire invalide (ex: +2376XXXXXXXX)'),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Numéro WhatsApp invalide' });
  }

  const actorName = `${req.user!.firstName} ${req.user!.lastName}`;
  const result = await sendTestWhatsApp(parsed.data.phone, actorName);
  await logAuditSafe(
    req,
    result.ok ? 'WHATSAPP_TEST_SENT' : 'WHATSAPP_TEST_FAILED',
    'notification',
    result.messageId,
    result.ok ? 'INFO' : 'WARNING',
    result.ok
      ? `Message WhatsApp de test envoyé à ${parsed.data.phone} (${result.provider})`
      : `Échec test WhatsApp vers ${parsed.data.phone} : ${result.error || result.status}`
  );
  emitSyncEvent('notification');

  if (!result.ok) {
    return res.status(502).json({
      ok: false,
      status: result.status,
      provider: result.provider,
      error: result.error || "Échec de l'envoi WhatsApp.",
    });
  }
  return res.json({
    ok: true,
    status: result.status,
    provider: result.provider,
    providerMessageId: result.messageId,
  });
});

notificationsRouter.post(
  '/run-reminders',
  requireAnyPermission(['settings:manage', 'followups:write_admin', 'followups:write_medical']),
  async (req, res) => {
    const actorName = `${req.user!.firstName} ${req.user!.lastName}`;
    const summary = await runAutomaticReminders({ manualTrigger: true, actorName });
    await logAuditSafe(
      req,
      'AUTO_REMINDERS_EXECUTED',
      'notification',
      'scheduler',
      'INFO',
      `Exécution manuelle des relances automatiques : ${summary.emailsSent} e-mail(s) Resend, ${summary.whatsappSent} WhatsApp envoyés (${summary.appointmentsReminded} RDV J-1, ${summary.followUpsReminded} suivi(s), ${summary.tasksEscalated} tâche(s), ${summary.examsEscalated} examen(s))`
    );
    emitSyncEvent(['notification', 'followup']);
    return res.json({ ok: true, summary });
  }
);

notificationsRouter.post('/:id/read', async (req, res) => {
  await repository.markNotificationRead(req.params.id, req.user!._id);
  emitSyncEvent('notification');
  return res.json({ ok: true });
});

notificationsRouter.post('/read-all', async (req, res) => {
  await repository.markAllNotificationsRead(req.user!._id, req.user!.roles);
  emitSyncEvent('notification');
  return res.json({ ok: true });
});
