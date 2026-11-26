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
import { APPOINTMENT_TYPE_LABELS } from '../../src/shared/constants';
import type { AppointmentStatus, AppointmentType } from '../../src/shared/types';
import { emitSyncEvent } from '../services/eventBus';
import { sendAppointmentEmail, sendStaffAlertEmail } from '../services/emailService';
import { sendAppointmentWhatsApp, sendStaffAlertWhatsApp } from '../services/whatsappService';

export const appointmentsRouter = Router();
export const queueRouter = Router();

appointmentsRouter.use(requireSupabaseConfigured, requireAuth, requireCsrf);
queueRouter.use(requireSupabaseConfigured, requireAuth, requireCsrf);

const appointmentTypeValues = [
  'PREMIERE_CONSULTATION',
  'CONSULTATION_SUIVI',
  'CONSULTATION_CONTROLE',
  'CONSULTATION_URGENTE',
  'ECG',
  'HOLTER_ECG',
  'MAPA',
  'ECHOCARDIOGRAPHIE_DOPPLER',
  'ECHOGRAPHIE_TRANS_OESOPHAGIENNE',
  'ECHO_DOPPLER_VASCULAIRE',
  'EPREUVE_EFFORT',
  'POLYGRAPHIE_VENTILATOIRE',
] as const;

const appointmentStatusValues = [
  'EN_ATTENTE',
  'CONFIRME',
  'PATIENT_ARRIVE',
  'EN_ATTENTE_CONSULTATION',
  'EN_CONSULTATION',
  'TERMINE',
  'ANNULE',
  'ABSENT',
] as const;

const createApptSchema = z.object({
  patientId: z.string().min(1, 'Patient requis'),
  doctorId: z.string().min(1, 'Médecin requis'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Heure de début invalide'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Heure de fin invalide'),
  type: z.enum(appointmentTypeValues),
  reason: z.string().min(2, 'Motif du rendez-vous requis'),
  adminPriority: z.enum(['NORMALE', 'PRIORITAIRE', 'URGENCE_A_VALIDER']).default('NORMALE'),
  notes: z.string().optional(),
});

const updateApptSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  doctorId: z.string().optional(),
  type: z.enum(appointmentTypeValues).optional(),
  status: z.enum(appointmentStatusValues).optional(),
  reason: z.string().min(2).optional(),
  adminPriority: z.enum(['NORMALE', 'PRIORITAIRE', 'URGENCE_A_VALIDER']).optional(),
  notes: z.string().optional(),
});

appointmentsRouter.get('/', requireAnyPermission(['appointments:read', 'portal:access']), async (req, res) => {
  const user = req.user!;
  const isPatient = user.roles.includes('PATIENT') && !hasPermission(user.roles, 'appointments:read');

  if (isPatient && !user.patientId) {
    return res.json({ appointments: [] });
  }

  const appointments = await repository.listAppointments({
    date: typeof req.query.date === 'string' ? req.query.date : undefined,
    startDate: typeof req.query.startDate === 'string' ? req.query.startDate : undefined,
    endDate: typeof req.query.endDate === 'string' ? req.query.endDate : undefined,
    doctorId: typeof req.query.doctorId === 'string' ? req.query.doctorId : undefined,
    patientId: isPatient ? user.patientId : typeof req.query.patientId === 'string' ? req.query.patientId : undefined,
    type: typeof req.query.type === 'string' ? req.query.type : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
  });

  return res.json({ appointments });
});

appointmentsRouter.get('/check-availability', requirePermission('appointments:read'), async (req, res) => {
  const doctorId = typeof req.query.doctorId === 'string' ? req.query.doctorId : '';
  const date = typeof req.query.date === 'string' ? req.query.date : '';
  const startTime = typeof req.query.startTime === 'string' ? req.query.startTime : '';
  const endTime = typeof req.query.endTime === 'string' ? req.query.endTime : '';
  const excludeId = typeof req.query.excludeId === 'string' ? req.query.excludeId : undefined;

  if (!doctorId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
    return res.status(400).json({ error: 'Paramètres de vérification invalides.' });
  }
  if (endTime <= startTime) {
    return res.status(400).json({ error: "L'heure de fin doit être postérieure à l'heure de début." });
  }

  const sameDay = await repository.listAppointments({ doctorId, date });
  const conflict = sameDay.find(
    (a) =>
      a._id !== excludeId &&
      a.status !== 'ANNULE' &&
      a.status !== 'ABSENT' &&
      startTime < a.endTime &&
      endTime > a.startTime
  );

  return res.json({
    available: !conflict,
    conflictWith: conflict
      ? {
          _id: conflict._id,
          patientName: conflict.patientName,
          startTime: conflict.startTime,
          endTime: conflict.endTime,
        }
      : null,
  });
});

appointmentsRouter.post('/', requireAnyPermission(['appointments:write', 'portal:access']), async (req, res) => {
  const user = req.user!;
  const isStaff = hasPermission(user.roles, 'appointments:write');
  const isPatient = user.roles.includes('PATIENT');

  if (!isStaff && !isPatient) {
    return res.status(403).json({ error: 'Accès refusé.' });
  }

  const parsed = createApptSchema.safeParse({
    ...req.body,
    patientId: isStaff ? req.body.patientId : user.patientId,
  });
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Données rendez-vous invalides' });
  }

  const data = parsed.data;
  if (data.endTime <= data.startTime) {
    return res.status(400).json({ error: "L'heure de fin doit être postérieure à l'heure de début." });
  }

  // Prevent double booking for the same doctor
  const available = await repository.checkDoctorAvailability(data.doctorId, data.date, data.startTime, data.endTime);
  if (!available) {
    return res.status(409).json({
      error: 'Créneau indisponible : un rendez-vous existe déjà sur cette plage horaire pour ce médecin.',
      code: 'DOUBLE_BOOKING',
    });
  }

  const isUrgent = data.type === 'CONSULTATION_URGENTE' || data.adminPriority === 'URGENCE_A_VALIDER';
  const now = new Date().toISOString();

  const created = await repository.createAppointment({
    patientId: data.patientId,
    doctorId: data.doctorId,
    date: data.date,
    startTime: data.startTime,
    endTime: data.endTime,
    type: data.type,
    status: isStaff ? 'CONFIRME' : 'EN_ATTENTE',
    reason: data.reason,
    adminPriority: isUrgent ? 'URGENCE_A_VALIDER' : data.adminPriority,
    urgencyValidatedByHealthPro: false,
    requestedByPatient: !isStaff,
    notes: data.notes,
    isDemo: false,
    createdById: user._id,
    createdAt: now,
    updatedAt: now,
  });

  // Notify staff / doctor
  const typeLabel = APPOINTMENT_TYPE_LABELS[created.type as AppointmentType] || created.type;
  await repository.createNotification({
    recipientRoles: isUrgent ? ['MEDECIN', 'ACCUEIL'] : ['ACCUEIL'],
    eventType: isUrgent ? 'URGENCE_SIGNALEE' : 'NOUVEAU_RDV',
    title: isUrgent ? 'Urgence signalée : validation médicale requise' : 'Nouveau rendez-vous enregistré',
    message: `${created.patientName} — ${typeLabel} le ${created.date} à ${created.startTime}.`,
    linkModule: 'appointments',
    relatedEntityId: created._id,
    readByUserIds: [],
    channel: 'INTERNE',
    createdAt: now,
  });

  await logAuditSafe(
    req,
    'APPOINTMENT_CREATED',
    'appointment',
    created._id,
    isUrgent ? 'WARNING' : 'INFO',
    `RDV créé pour ${created.patientName} (${created.date} ${created.startTime})`
  );
  emitSyncEvent(['appointment', 'queue', 'notification']);

  // Real Resend notifications (non-blocking)
  (async () => {
    const [patient, doctor] = await Promise.all([
      repository.findPatientById(created.patientId),
      repository.findUserById(created.doctorId),
    ]);
    const doctorDisplayName =
      created.doctorName ||
      (doctor ? `${doctor.title || ''} ${doctor.firstName} ${doctor.lastName}`.trim() : 'Cardiologue');

    if (created.status === 'CONFIRME' && patient) {
      if (patient.email) {
        await sendAppointmentEmail({
          mode: 'CONFIRMATION',
          patientId: created.patientId,
          patientName: `${patient.firstName} ${patient.lastName}`,
          patientEmail: patient.email,
          doctorName: doctorDisplayName,
          date: created.date,
          startTime: created.startTime,
          typeLabel,
          appointmentId: created._id,
        });
      }
      if (patient.phone) {
        await sendAppointmentWhatsApp({
          mode: 'CONFIRMATION',
          patientId: created.patientId,
          patientName: `${patient.firstName} ${patient.lastName}`,
          patientPhone: patient.phone,
          doctorName: doctorDisplayName,
          date: created.date,
          startTime: created.startTime,
          typeLabel,
          appointmentId: created._id,
        });
      }
    }
    if (isUrgent && doctor) {
      const doctorFullName = `${doctor.title || ''} ${doctor.firstName} ${doctor.lastName}`.trim();
      if (doctor.email) {
        await sendStaffAlertEmail({
          recipientEmail: doctor.email,
          recipientName: doctorFullName,
          title: `Urgence signalée : ${created.patientName || 'Patient'}`,
          message: `Un rendez-vous prioritaire (${typeLabel}) a été signalé pour le ${created.date} à ${created.startTime}. Une validation médicale humaine est requise.`,
          category: 'RDV_CONFIRMATION',
          linkPath: '/rendez-vous',
          relatedEntityId: created._id,
        });
      }
      if (doctor.phone) {
        await sendStaffAlertWhatsApp({
          recipientPhone: doctor.phone,
          recipientName: doctorFullName,
          title: `Urgence signalée : ${created.patientName || 'Patient'}`,
          message: `Rendez-vous prioritaire (${typeLabel}) le ${created.date} à ${created.startTime}. Validation médicale requise.`,
          category: 'RDV_CONFIRMATION',
          relatedEntityId: created._id,
        });
      }
    }
  })().catch(() => undefined);

  return res.status(201).json({ appointment: created });
});

appointmentsRouter.patch('/:id', requirePermission('appointments:write'), async (req, res) => {
  const existing = await repository.findAppointmentById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Rendez-vous introuvable.' });

  const parsed = updateApptSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Données invalides' });
  }

  const nextDate = parsed.data.date || existing.date;
  const nextStart = parsed.data.startTime || existing.startTime;
  const nextEnd = parsed.data.endTime || existing.endTime;
  const nextDoctor = parsed.data.doctorId || existing.doctorId;

  if (nextEnd <= nextStart) {
    return res.status(400).json({ error: "L'heure de fin doit être postérieure à l'heure de début." });
  }

  if (
    parsed.data.date !== undefined ||
    parsed.data.startTime !== undefined ||
    parsed.data.endTime !== undefined ||
    parsed.data.doctorId !== undefined
  ) {
    const available = await repository.checkDoctorAvailability(nextDoctor, nextDate, nextStart, nextEnd, existing._id);
    if (!available) {
      return res.status(409).json({ error: 'Conflit horaire : le médecin a déjà un rendez-vous sur ce créneau.' });
    }
  }

  const now = new Date().toISOString();
  const patch: Record<string, any> = {
    ...parsed.data,
    updatedAt: now,
  };

  if (parsed.data.status === 'PATIENT_ARRIVE' && !existing.queueNumber) {
    patch.queueNumber = await repository.getNextQueueNumber(nextDate);
    patch.arrivedAt = now;
  }

  const updated = await repository.updateAppointment(existing._id, patch);

  if (parsed.data.status === 'CONFIRME' && existing.status !== 'CONFIRME') {
    await repository.createNotification({
      recipientRoles: ['ACCUEIL', 'MEDECIN'],
      eventType: 'RDV_CONFIRME',
      title: 'Rendez-vous confirmé',
      message: `${updated.patientName} — ${updated.date} à ${updated.startTime}.`,
      linkModule: 'appointments',
      relatedEntityId: updated._id,
      readByUserIds: [],
      channel: 'INTERNE',
      createdAt: now,
    });

    repository
      .findPatientById(updated.patientId)
      .then(async (patient) => {
        if (!patient) return;
        const typeLabel = APPOINTMENT_TYPE_LABELS[updated.type as AppointmentType] || updated.type;
        if (patient.email) {
          await sendAppointmentEmail({
            mode: 'CONFIRMATION',
            patientId: updated.patientId,
            patientName: `${patient.firstName} ${patient.lastName}`,
            patientEmail: patient.email,
            doctorName: updated.doctorName || 'Cardiologue',
            date: updated.date,
            startTime: updated.startTime,
            typeLabel,
            appointmentId: updated._id,
          });
        }
        if (patient.phone) {
          await sendAppointmentWhatsApp({
            mode: 'CONFIRMATION',
            patientId: updated.patientId,
            patientName: `${patient.firstName} ${patient.lastName}`,
            patientPhone: patient.phone,
            doctorName: updated.doctorName || 'Cardiologue',
            date: updated.date,
            startTime: updated.startTime,
            typeLabel,
            appointmentId: updated._id,
          });
        }
      })
      .catch(() => undefined);
  }

  await logAuditSafe(req, 'APPOINTMENT_UPDATED', 'appointment', updated._id, 'INFO', `Statut: ${updated.status}`);
  emitSyncEvent(['appointment', 'queue', 'notification']);
  return res.json({ appointment: updated });
});

// Explicit medical validation of urgent appointments (never automated!)
appointmentsRouter.post('/:id/validate-urgency', requirePermission('medical:write'), async (req, res) => {
  const existing = await repository.findAppointmentById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Rendez-vous introuvable.' });

  const now = new Date().toISOString();
  const updated = await repository.updateAppointment(existing._id, {
    urgencyValidatedByHealthPro: true,
    urgencyValidatedById: req.user!._id,
    urgencyValidatedAt: now,
    updatedAt: now,
  });

  await logAuditSafe(
    req,
    'URGENCY_VALIDATED',
    'appointment',
    updated._id,
    'WARNING',
    `Urgence validée par ${req.user!.firstName} ${req.user!.lastName}`
  );
  emitSyncEvent(['appointment', 'queue', 'notification']);
  return res.json({ appointment: updated });
});

appointmentsRouter.delete('/:id', requirePermission('appointments:write'), async (req, res) => {
  const existing = await repository.findAppointmentById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Rendez-vous introuvable.' });

  // Prefer soft cancel over destructive delete if patient already arrived
  if (existing.status === 'EN_CONSULTATION' || existing.status === 'TERMINE') {
    return res.status(400).json({ error: 'Impossible de supprimer un rendez-vous déjà en cours ou terminé.' });
  }

  await repository.updateAppointment(existing._id, {
    status: 'ANNULE',
    updatedAt: new Date().toISOString(),
  });
  await logAuditSafe(req, 'APPOINTMENT_CANCELLED', 'appointment', existing._id, 'INFO', `RDV annulé (${existing.patientName})`);
  emitSyncEvent(['appointment', 'queue', 'notification']);
  return res.json({ ok: true });
});

// ---------------- QUEUE ROUTES ----------------

queueRouter.get('/', requireAnyPermission(['queue:manage', 'appointments:read']), async (req, res) => {
  const date = typeof req.query.date === 'string' ? req.query.date : new Date().toISOString().slice(0, 10);
  const appointments = await repository.listAppointments({ date });
  const queue = appointments.filter((a) => a.status !== 'ANNULE');
  queue.sort((a, b) => {
    if (a.queueNumber && b.queueNumber) return a.queueNumber - b.queueNumber;
    if (a.queueNumber) return -1;
    if (b.queueNumber) return 1;
    return a.startTime.localeCompare(b.startTime);
  });
  return res.json({ date, queue });
});

queueRouter.post('/:id/action', requirePermission('queue:manage'), async (req, res) => {
  const schema = z.object({
    action: z.enum(['ARRIVED', 'WAITING', 'SIGNAL_DOCTOR', 'START_CONSULTATION', 'FINISH', 'ABSENT']),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Action invalide' });

  const appt = await repository.findAppointmentById(req.params.id);
  if (!appt) return res.status(404).json({ error: 'Passage introuvable.' });

  const now = new Date().toISOString();
  const patch: Record<string, any> = { updatedAt: now };
  let nextStatus: AppointmentStatus = appt.status;

  switch (parsed.data.action) {
    case 'ARRIVED':
      nextStatus = 'PATIENT_ARRIVE';
      if (!appt.queueNumber) patch.queueNumber = await repository.getNextQueueNumber(appt.date);
      patch.arrivedAt = appt.arrivedAt || now;
      break;
    case 'WAITING':
      nextStatus = 'EN_ATTENTE_CONSULTATION';
      if (!appt.queueNumber) patch.queueNumber = await repository.getNextQueueNumber(appt.date);
      patch.arrivedAt = appt.arrivedAt || now;
      break;
    case 'SIGNAL_DOCTOR':
      nextStatus = 'EN_ATTENTE_CONSULTATION';
      if (!appt.queueNumber) patch.queueNumber = await repository.getNextQueueNumber(appt.date);
      patch.arrivedAt = appt.arrivedAt || now;
      await repository.createNotification({
        recipientUserId: appt.doctorId,
        recipientRoles: ['MEDECIN'],
        eventType: 'PATIENT_ARRIVE',
        title: `Patient prêt : ${appt.patientName}`,
        message: `Passage n°${patch.queueNumber || appt.queueNumber} signalé en salle d'attente (${appt.reason}).`,
        linkModule: 'queue',
        relatedEntityId: appt._id,
        readByUserIds: [],
        channel: 'INTERNE',
        createdAt: now,
      });
      break;
    case 'START_CONSULTATION':
      nextStatus = 'EN_CONSULTATION';
      if (!appt.queueNumber) patch.queueNumber = await repository.getNextQueueNumber(appt.date);
      patch.arrivedAt = appt.arrivedAt || now;
      patch.consultationStartedAt = now;
      break;
    case 'FINISH':
      nextStatus = 'TERMINE';
      patch.consultationEndedAt = now;
      break;
    case 'ABSENT':
      nextStatus = 'ABSENT';
      break;
  }

  patch.status = nextStatus;
  const updated = await repository.updateAppointment(appt._id, patch);
  await logAuditSafe(req, 'QUEUE_ACTION', 'appointment', appt._id, 'INFO', `Action file d'attente: ${parsed.data.action}`);
  emitSyncEvent(['queue', 'appointment', 'notification']);
  return res.json({ appointment: updated });
});
