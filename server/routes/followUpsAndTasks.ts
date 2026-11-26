import { Router } from 'express';
import { z } from 'zod';
import { repository } from '../repositories/SupabaseRepository';
import { hasPermission } from '../services/security';
import {
  logAuditSafe,
  requireAnyPermission,
  requireAuth,
  requireCsrf,
  requirePermission,
  requireSupabaseConfigured,
} from '../middleware/auth';
import type { FollowUpType } from '../../src/shared/types';
import { FOLLOWUP_TYPE_LABELS } from '../../src/shared/constants';
import { emitSyncEvent } from '../services/eventBus';
import { sendFollowUpReminderEmail } from '../services/emailService';
import { sendFollowUpReminderWhatsApp } from '../services/whatsappService';

export const followUpsRouter = Router();
export const tasksRouter = Router();

followUpsRouter.use(requireSupabaseConfigured, requireAuth, requireCsrf);
tasksRouter.use(requireSupabaseConfigured, requireAuth, requireCsrf);

const MEDICAL_FOLLOWUP_TYPES: FollowUpType[] = [
  'CONTROLE_MEDICAL',
  'RESULTAT_EXAMEN',
  'EXAMEN_COMPLEMENTAIRE',
  'SURVEILLANCE',
];

const followUpTypeEnum = z.enum([
  'APPEL_TELEPHONIQUE',
  'CONTROLE_MEDICAL',
  'RESULTAT_EXAMEN',
  'EXAMEN_COMPLEMENTAIRE',
  'SURVEILLANCE',
  'RENDEZ_VOUS_SUIVI',
  'RELANCE_ADMINISTRATIVE',
]);

const followUpStatusEnum = z.enum([
  'A_EFFECTUER',
  'EN_COURS',
  'PATIENT_CONTACTE',
  'PATIENT_INJOIGNABLE',
  'REPORTE',
  'TERMINE',
  'ANNULE',
]);

const priorityEnum = z.enum(['BASSE', 'NORMALE', 'HAUTE', 'CRITIQUE']);

const createFollowUpSchema = z.object({
  patientId: z.string().min(1, 'Patient requis'),
  consultationId: z.string().optional(),
  examinationId: z.string().optional(),
  type: followUpTypeEnum,
  reason: z.string().min(3, 'Motif du suivi requis'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date prévue invalide'),
  assigneeId: z.string().min(1, 'Responsable requis'),
  priority: priorityEnum.default('NORMALE'),
  notes: z.string().optional(),
  nextAction: z.string().optional(),
});

const updateFollowUpSchema = z.object({
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  assigneeId: z.string().optional(),
  priority: priorityEnum.optional(),
  status: followUpStatusEnum.optional(),
  contactOutcome: z.string().optional(),
  notes: z.string().optional(),
  nextAction: z.string().optional(),
  relanceNote: z.string().optional(),
});

followUpsRouter.get('/', requireAnyPermission(['followups:read', 'portal:access']), async (req, res) => {
  const user = req.user!;
  const isPatient = user.roles.includes('PATIENT') && !hasPermission(user.roles, 'followups:read');

  if (isPatient) {
    if (!user.patientId) return res.json({ followUps: [] });
    const list = await repository.listFollowUps({ patientId: user.patientId });
    return res.json({
      followUps: list.filter((f) => f.type === 'CONTROLE_MEDICAL' || f.type === 'RENDEZ_VOUS_SUIVI'),
    });
  }

  const followUps = await repository.listFollowUps({
    patientId: typeof req.query.patientId === 'string' ? req.query.patientId : undefined,
    assigneeId: typeof req.query.assigneeId === 'string' ? req.query.assigneeId : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
  });

  const today = new Date().toISOString().slice(0, 10);
  const dateFilter = typeof req.query.date === 'string' ? req.query.date.trim() : '';
  const dueMode = typeof req.query.dueMode === 'string' ? req.query.dueMode.trim() : '';

  const filtered = followUps.filter((f) => {
    if (dateFilter && f.dueDate !== dateFilter) return false;
    const isClosed = f.status === 'TERMINE' || f.status === 'ANNULE';
    if (dueMode === 'today') return !isClosed && f.dueDate === today;
    if (dueMode === 'overdue') return !isClosed && f.dueDate < today;
    if (dueMode === 'upcoming') return !isClosed && f.dueDate > today;
    return true;
  });

  return res.json({ followUps: filtered });
});

followUpsRouter.post('/', requireAnyPermission(['followups:write_admin', 'followups:write_medical']), async (req, res) => {
  const parsed = createFollowUpSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Données de suivi invalides' });
  }

  const isMedicalType = MEDICAL_FOLLOWUP_TYPES.includes(parsed.data.type);
  if (isMedicalType && !hasPermission(req.user!.roles, 'followups:write_medical')) {
    return res.status(403).json({
      error: 'La création de ce suivi médical est réservée au médecin.',
    });
  }

  const now = new Date().toISOString();
  const actorName = `${req.user!.firstName} ${req.user!.lastName}`;
  const created = await repository.createFollowUp({
    ...parsed.data,
    status: 'A_EFFECTUER',
    history: [{ at: now, byId: req.user!._id, byName: actorName, action: 'Suivi programmé', note: parsed.data.notes }],
    isDemo: false,
    createdById: req.user!._id,
    createdAt: now,
    updatedAt: now,
  });

  await repository.createNotification({
    recipientUserId: created.assigneeId,
    eventType: 'SUIVI_A_EFFECTUER',
    title: 'Nouveau suivi patient assigné',
    message: `${created.patientName} — ${created.reason} (échéance : ${created.dueDate}).`,
    linkModule: 'follow-ups',
    relatedEntityId: created._id,
    readByUserIds: [],
    channel: 'INTERNE',
    createdAt: now,
  });

  await logAuditSafe(req, 'FOLLOWUP_CREATED', 'followUp', created._id, 'INFO', `Suivi créé pour ${created.patientName}`);
  emitSyncEvent(['followup', 'patient', 'notification']);

  repository
    .findUserById(created.assigneeId)
    .then((assignee) => {
      if (!assignee?.email) return;
      return sendFollowUpReminderEmail({
        recipientEmail: assignee.email,
        recipientName: `${assignee.title ? assignee.title + ' ' : ''}${assignee.firstName} ${assignee.lastName}`.trim(),
        isPatientRecipient: false,
        patientId: created.patientId,
        patientName: created.patientName || 'Patient',
        followUpId: created._id,
        followUpTypeLabel: FOLLOWUP_TYPE_LABELS[created.type as FollowUpType] || created.type,
        dueDate: created.dueDate,
        reason: created.reason,
      });
    })
    .catch(() => undefined);

  return res.status(201).json({ followUp: created });
});

followUpsRouter.patch('/:id', requireAnyPermission(['followups:write_admin', 'followups:write_medical']), async (req, res) => {
  const existing = await repository.findFollowUpById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Suivi introuvable.' });

  const parsed = updateFollowUpSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Données invalides' });
  }

  // Prevent closing medical follow-ups by non-doctors
  if (
    (parsed.data.status === 'TERMINE' || parsed.data.status === 'ANNULE') &&
    MEDICAL_FOLLOWUP_TYPES.includes(existing.type) &&
    !hasPermission(req.user!.roles, 'followups:write_medical')
  ) {
    return res.status(403).json({ error: 'Seul le médecin peut clôturer ou annuler un suivi médical.' });
  }

  const now = new Date().toISOString();
  const actorName = `${req.user!.firstName} ${req.user!.lastName}`;
  const actionLabel = parsed.data.status && parsed.data.status !== existing.status
    ? `Statut modifié -> ${parsed.data.status}`
    : parsed.data.dueDate && parsed.data.dueDate !== existing.dueDate
    ? `Reporté au ${parsed.data.dueDate}`
    : 'Relance / mise à jour';

  const history = [
    ...(existing.history || []),
    {
      at: now,
      byId: req.user!._id,
      byName: actorName,
      action: actionLabel,
      note: parsed.data.relanceNote || parsed.data.contactOutcome || undefined,
    },
  ];

  const { relanceNote: _omit, ...rest } = parsed.data;
  const updated = await repository.updateFollowUp(existing._id, {
    ...rest,
    history,
    updatedAt: now,
  });

  await logAuditSafe(req, 'FOLLOWUP_UPDATED', 'followUp', updated._id, 'INFO', actionLabel);
  emitSyncEvent(['followup', 'patient']);
  return res.json({ followUp: updated });
});

followUpsRouter.post('/:id/complete', requireAnyPermission(['followups:write_admin', 'followups:write_medical']), async (req, res) => {
  const existing = await repository.findFollowUpById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Suivi introuvable.' });

  if (MEDICAL_FOLLOWUP_TYPES.includes(existing.type) && !hasPermission(req.user!.roles, 'followups:write_medical')) {
    return res.status(403).json({
      error: 'Décision médicale : seul un médecin peut clôturer ce suivi médical.',
    });
  }

  const schema = z.object({
    contactOutcome: z.string().min(2, 'Veuillez indiquer le résultat / compte rendu de clôture'),
    nextAction: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Motif de clôture requis' });
  }

  const now = new Date().toISOString();
  const actorName = `${req.user!.firstName} ${req.user!.lastName}`;
  const updated = await repository.updateFollowUp(existing._id, {
    status: 'TERMINE',
    contactOutcome: parsed.data.contactOutcome,
    nextAction: parsed.data.nextAction ?? existing.nextAction,
    closedAt: now,
    closedById: req.user!._id,
    history: [
      ...(existing.history || []),
      {
        at: now,
        byId: req.user!._id,
        byName: actorName,
        action: 'Suivi clôturé',
        note: parsed.data.contactOutcome,
      },
    ],
    updatedAt: now,
  });

  await logAuditSafe(req, 'FOLLOWUP_COMPLETED', 'followUp', updated._id, 'INFO', `Suivi clôturé (${updated.patientName})`);
  emitSyncEvent(['followup', 'patient']);
  return res.json({ followUp: updated });
});

// Manual immediate Resend email and/or WhatsApp patient recall for a follow-up
followUpsRouter.post(
  '/:id/send-reminder',
  requireAnyPermission(['followups:write_admin', 'followups:write_medical']),
  async (req, res) => {
    const existing = await repository.findFollowUpById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Suivi introuvable.' });

    const patient = await repository.findPatientById(existing.patientId);
    if (!patient) return res.status(404).json({ error: 'Patient introuvable.' });

    const rawChannel = typeof req.body?.channel === 'string' ? req.body.channel.toUpperCase() : 'EMAIL';
    const channel: 'EMAIL' | 'WHATSAPP' | 'BOTH' =
      rawChannel === 'WHATSAPP' || rawChannel === 'BOTH' ? rawChannel : 'EMAIL';

    if (channel === 'EMAIL' && !patient.email) {
      return res.status(400).json({
        error: "Ce patient n'a pas d'adresse e-mail enregistrée dans sa fiche administrative.",
      });
    }
    if (channel === 'WHATSAPP' && !patient.phone) {
      return res.status(400).json({
        error: "Ce patient n'a pas de numéro de téléphone WhatsApp enregistré dans sa fiche.",
      });
    }

    const customNote =
      typeof req.body?.customNote === 'string' && req.body.customNote.trim()
        ? req.body.customNote.trim().slice(0, 400)
        : undefined;
    const typeLabel = FOLLOWUP_TYPE_LABELS[existing.type as FollowUpType] || existing.type;
    const patientFullName = `${patient.firstName} ${patient.lastName}`;

    const emailRes =
      (channel === 'EMAIL' || channel === 'BOTH') && patient.email
        ? await sendFollowUpReminderEmail({
            recipientEmail: patient.email,
            recipientName: patientFullName,
            isPatientRecipient: true,
            patientId: patient._id,
            patientName: patientFullName,
            followUpId: existing._id,
            followUpTypeLabel: typeLabel,
            dueDate: existing.dueDate,
            reason: customNote || 'Rappel de suivi cardiologique au cabinet',
            force: true,
          })
        : null;

    const waRes =
      (channel === 'WHATSAPP' || channel === 'BOTH') && patient.phone
        ? await sendFollowUpReminderWhatsApp({
            recipientPhone: patient.phone,
            recipientName: patientFullName,
            isPatientRecipient: true,
            patientId: patient._id,
            patientName: patientFullName,
            followUpId: existing._id,
            followUpTypeLabel: typeLabel,
            dueDate: existing.dueDate,
            reason: customNote,
            force: true,
          })
        : null;

    const overallOk = Boolean((emailRes && emailRes.ok) || (waRes && waRes.ok));
    const now = new Date().toISOString();
    const actorName = `${req.user!.firstName} ${req.user!.lastName}`;
    const newEntries = [...(existing.history || [])];

    if (emailRes) {
      newEntries.push({
        at: now,
        byId: req.user!._id,
        byName: actorName,
        action: emailRes.ok
          ? `Relance e-mail Resend envoyée à ${patient.email}`
          : `Échec relance e-mail Resend (${emailRes.error || emailRes.status})`,
        note: customNote,
      });
    }
    if (waRes) {
      newEntries.push({
        at: now,
        byId: req.user!._id,
        byName: actorName,
        action: waRes.ok
          ? `Relance WhatsApp envoyée à ${patient.phone}`
          : `Échec relance WhatsApp (${waRes.error || waRes.status})`,
        note: customNote,
      });
    }

    const updated = await repository.updateFollowUp(existing._id, {
      history: newEntries,
      updatedAt: now,
    });

    const primaryRes = channel === 'WHATSAPP' ? waRes : emailRes || waRes;
    await logAuditSafe(
      req,
      overallOk ? 'FOLLOWUP_REMINDER_SENT' : 'FOLLOWUP_REMINDER_FAILED',
      'followUp',
      existing._id,
      overallOk ? 'INFO' : 'WARNING',
      overallOk
        ? `Relance ${channel} envoyée pour ${patientFullName} (ID: ${primaryRes?.messageId || 'n/a'})`
        : `Échec relance ${channel} pour ${patientFullName}: ${primaryRes?.error || primaryRes?.status || 'erreur'}`
    );
    emitSyncEvent(['followup', 'notification']);

    if (!overallOk) {
      return res.status(502).json({
        ok: false,
        status: primaryRes?.status || 'FAILED',
        error: primaryRes?.error || `L'envoi de la relance ${channel} a échoué.`,
        followUp: updated,
      });
    }

    return res.json({
      ok: true,
      channel,
      status: primaryRes?.status || 'SENT',
      providerMessageId: primaryRes?.messageId,
      followUp: updated,
    });
  }
);

// ---------------- TASKS ROUTES ----------------

const taskCategoryEnum = z.enum(['ACCUEIL', 'ADMINISTRATION', 'CONSULTATION', 'EXAMENS', 'SUIVI', 'DOCUMENTS', 'AUTRES']);
const taskStatusEnum = z.enum(['A_FAIRE', 'EN_COURS', 'EN_ATTENTE', 'TERMINEE', 'ANNULEE']);

const createTaskSchema = z.object({
  title: z.string().min(3, 'Titre requis'),
  description: z.string().optional(),
  category: taskCategoryEnum,
  patientId: z.string().optional(),
  assigneeId: z.string().min(1, 'Responsable requis'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date limite invalide'),
  priority: priorityEnum.default('NORMALE'),
});

const updateTaskSchema = z.object({
  title: z.string().min(3).optional(),
  description: z.string().optional(),
  category: taskCategoryEnum.optional(),
  assigneeId: z.string().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  priority: priorityEnum.optional(),
  status: taskStatusEnum.optional(),
});

tasksRouter.get('/', requirePermission('tasks:read'), async (req, res) => {
  const tasks = await repository.listTasks({
    assigneeId: typeof req.query.assigneeId === 'string' ? req.query.assigneeId : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    category: typeof req.query.category === 'string' ? req.query.category : undefined,
  });
  return res.json({ tasks });
});

tasksRouter.post('/', requirePermission('tasks:write'), async (req, res) => {
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Données tâche invalides' });
  }

  const now = new Date().toISOString();
  const actorName = `${req.user!.firstName} ${req.user!.lastName}`;
  const created = await repository.createTask({
    ...parsed.data,
    status: 'A_FAIRE',
    history: [{ at: now, byName: actorName, action: 'Tâche créée' }],
    isDemo: false,
    createdById: req.user!._id,
    createdAt: now,
    updatedAt: now,
  });

  await logAuditSafe(req, 'TASK_CREATED', 'task', created._id, 'INFO', `Tâche créée: ${created.title}`);
  emitSyncEvent(['task', 'notification']);
  return res.status(201).json({ task: created });
});

tasksRouter.patch('/:id', requirePermission('tasks:write'), async (req, res) => {
  const existing = await repository.findTaskById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Tâche introuvable.' });

  const parsed = updateTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Données invalides' });
  }

  const now = new Date().toISOString();
  const actorName = `${req.user!.firstName} ${req.user!.lastName}`;
  const action = parsed.data.status && parsed.data.status !== existing.status
    ? `Statut -> ${parsed.data.status}`
    : 'Tâche modifiée';

  const updated = await repository.updateTask(existing._id, {
    ...parsed.data,
    history: [...(existing.history || []), { at: now, byName: actorName, action }],
    updatedAt: now,
  });

  await logAuditSafe(req, 'TASK_UPDATED', 'task', updated._id, 'INFO', `${updated.title}: ${action}`);
  emitSyncEvent('task');
  return res.json({ task: updated });
});
