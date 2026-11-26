import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { z } from 'zod';
import { repository } from '../repositories/SupabaseRepository';
import { isR2Configured, isSupabaseConfigured } from '../config/env';
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
import { CLINIC_DEFAULTS, EXAMINATION_TYPE_LABELS } from '../../src/shared/constants';
import type { ExaminationType } from '../../src/shared/types';
import { emitSyncEvent } from '../services/eventBus';
import { invalidateClinicMetaCache } from '../services/ogMeta';

export const financeRouter = Router();

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.mimetype)) {
      cb(new Error('Format logo non supporté (PNG, JPEG, WEBP, SVG).'));
      return;
    }
    cb(null, true);
  },
});

const DEFAULT_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none">
  <rect width="48" height="48" rx="10" fill="#073B70"/>
  <path d="M24 38C24 38 10 29 10 18.5C10 13.8 13.7 10 18.3 10C21 10 23 11.4 24 13.3C25 11.4 27 10 29.7 10C34.3 10 38 13.8 38 18.5C38 29 24 38 24 38Z" stroke="#FFFFFF" stroke-width="2.4" stroke-linejoin="round"/>
  <path d="M12.5 22.5H17.5L20 16.5L23.5 28L26.5 20L28.5 22.5H35.5" stroke="#D71920" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const OFFICIAL_LOGO_PATH = path.resolve(
  process.cwd(),
  'public',
  'assets',
  'aistudio',
  'Capture_d__cran_2026-11-12_093834_f90e82fc.png'
);

function resolveLogoMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

// Public endpoint to display custom uploaded cabinet logo (from Cloudflare R2), official logo, or SVG fallback
// Query ?og=1 guarantees a raster PNG/JPEG/WEBP image suitable for WhatsApp/OpenGraph crawlers
financeRouter.get('/settings/logo', async (req, res) => {
  const forOg = req.query.og === '1' || req.query.og === 'true';
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Cache-Control', forOg ? 'public, max-age=300' : 'no-cache');

  if (isSupabaseConfigured() && isR2Configured()) {
    try {
      const settings = await repository.getClinicSettings();
      if (settings?.logoStorageKey && settings.logoStorageKey.startsWith('branding/')) {
        const mime = resolveLogoMimeType(settings.logoStorageKey);
        if (!forOg || mime !== 'image/svg+xml') {
          const obj = await getFileStreamFromR2(settings.logoStorageKey, 'branding/');
          res.setHeader('Content-Type', obj.contentType || mime);
          return obj.stream.pipe(res);
        }
      }
    } catch {
      // Fall back to official cabinet logo
    }
  }

  if (fs.existsSync(OFFICIAL_LOGO_PATH)) {
    res.setHeader('Content-Type', 'image/png');
    return res.sendFile(OFFICIAL_LOGO_PATH);
  }

  res.setHeader('Content-Type', 'image/svg+xml');
  return res.status(200).send(DEFAULT_LOGO_SVG);
});

financeRouter.use(requireSupabaseConfigured, requireAuth, requireCsrf);

// ---------------- SERVICES & PRICING (FCFA) ----------------

financeRouter.get('/services', requireAnyPermission(['services:manage', 'payments:read', 'appointments:read']), async (_req, res) => {
  const services = await repository.listServices();
  res.json({ services });
});

financeRouter.post('/services', requirePermission('services:manage'), async (req, res) => {
  const schema = z.object({
    code: z.string().min(2),
    name: z.string().min(2),
    category: z.enum([
      'CONSULTATION',
      'ECG',
      'HOLTER_ECG',
      'MAPA',
      'ECHOCARDIOGRAPHIE',
      'ECHOCARDIOGRAPHIE_TRANS_OESOPHAGIENNE',
      'ECHO_DOPPLER',
      'EPREUVE_EFFORT',
      'POLYGRAPHIE_VENTILATOIRE',
    ]),
    priceFcfa: z.number().min(0).nullable(),
    active: z.boolean().default(true),
    description: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Prestation invalide' });

  const now = new Date().toISOString();
  const created = await repository.createService({
    ...parsed.data,
    isDemo: false,
    createdAt: now,
    updatedAt: now,
  });
  await logAuditSafe(req, 'SERVICE_CREATED', 'service', created._id, 'INFO', `Prestation ${created.name}`);
  emitSyncEvent('service');
  return res.status(201).json({ service: created });
});

financeRouter.patch('/services/:id', requirePermission('services:manage'), async (req, res) => {
  const schema = z.object({
    name: z.string().min(2).optional(),
    priceFcfa: z.number().min(0).nullable().optional(),
    active: z.boolean().optional(),
    description: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Tarif ou libellé invalide' });

  const existing = await repository.findServiceById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Prestation introuvable.' });

  const updated = await repository.updateService(existing._id, {
    ...parsed.data,
    updatedAt: new Date().toISOString(),
  });
  await logAuditSafe(
    req,
    'SERVICE_UPDATED',
    'service',
    updated._id,
    'INFO',
    `Tarif ${updated.name}: ${updated.priceFcfa ?? 'Non défini'} FCFA`
  );
  emitSyncEvent('service');
  return res.json({ service: updated });
});

// ---------------- PAYMENTS ----------------

financeRouter.get('/payments', requirePermission('payments:read'), async (req, res) => {
  const payments = await repository.listPayments({
    startDate: typeof req.query.startDate === 'string' ? req.query.startDate : undefined,
    endDate: typeof req.query.endDate === 'string' ? req.query.endDate : undefined,
    patientId: typeof req.query.patientId === 'string' ? req.query.patientId : undefined,
  });
  return res.json({ payments });
});

financeRouter.post('/payments', requirePermission('payments:write'), async (req, res) => {
  const schema = z.object({
    patientId: z.string().min(1, 'Patient requis'),
    serviceId: z.string().optional(),
    serviceName: z.string().min(2, 'Prestation requise'),
    totalAmountFcfa: z.number().min(0, 'Montant invalide'),
    amountPaidFcfa: z.number().min(0, 'Montant versé invalide'),
    method: z.enum(['ESPECES', 'MOBILE_MONEY', 'CARTE', 'VIREMENT', 'CHEQUE', 'ASSURANCE']),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    notes: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Paiement invalide' });

  if (parsed.data.amountPaidFcfa > parsed.data.totalAmountFcfa) {
    return res.status(400).json({ error: 'Le montant versé ne peut pas dépasser le montant total.' });
  }

  const remaining = Math.max(0, parsed.data.totalAmountFcfa - parsed.data.amountPaidFcfa);
  const status =
    parsed.data.amountPaidFcfa === 0
      ? 'IMPAYE'
      : remaining === 0
      ? 'PAYE'
      : 'PARTIEL';

  const now = new Date().toISOString();
  const receiptNumber = await repository.getNextReceiptNumber();
  const created = await repository.createPayment({
    receiptNumber,
    patientId: parsed.data.patientId,
    serviceId: parsed.data.serviceId,
    serviceName: parsed.data.serviceName,
    totalAmountFcfa: parsed.data.totalAmountFcfa,
    amountPaidFcfa: parsed.data.amountPaidFcfa,
    remainingBalanceFcfa: remaining,
    status,
    method: parsed.data.method,
    date: parsed.data.date,
    notes: parsed.data.notes,
    recordedById: req.user!._id,
    isDemo: false,
    createdAt: now,
    updatedAt: now,
  });

  await logAuditSafe(
    req,
    'PAYMENT_RECORDED',
    'payment',
    created._id,
    'INFO',
    `Reçu ${created.receiptNumber} : ${created.amountPaidFcfa} FCFA (${created.status})`
  );
  emitSyncEvent('payment');
  return res.status(201).json({ payment: created });
});

financeRouter.patch('/payments/:id', requirePermission('payments:write'), async (req, res) => {
  const existing = await repository.findPaymentById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Paiement introuvable.' });

  const schema = z.object({
    additionalPaidFcfa: z.number().min(0),
    method: z.enum(['ESPECES', 'MOBILE_MONEY', 'CARTE', 'VIREMENT', 'CHEQUE', 'ASSURANCE']).optional(),
    notes: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Montant invalide' });

  const newPaid = existing.amountPaidFcfa + parsed.data.additionalPaidFcfa;
  if (newPaid > existing.totalAmountFcfa) {
    return res.status(400).json({ error: 'Le cumul dépasse le montant total de la prestation.' });
  }
  const remaining = existing.totalAmountFcfa - newPaid;
  const status = remaining === 0 ? 'PAYE' : newPaid === 0 ? 'IMPAYE' : 'PARTIEL';

  const updated = await repository.updatePayment(existing._id, {
    amountPaidFcfa: newPaid,
    remainingBalanceFcfa: remaining,
    status,
    method: parsed.data.method ?? existing.method,
    notes: parsed.data.notes ?? existing.notes,
    updatedAt: new Date().toISOString(),
  });
  await logAuditSafe(req, 'PAYMENT_UPDATED', 'payment', updated._id, 'INFO', `Complément ${parsed.data.additionalPaidFcfa} FCFA`);
  emitSyncEvent('payment');
  return res.json({ payment: updated });
});

// ---------------- COORDINATION ALERTS HELPER (NO AUTOMATED MEDICAL DECISIONS) ----------------

let lastOverdueAlertSyncAt = 0;

function diffDaysIso(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T12:00:00Z`).getTime();
  const to = new Date(`${toIso}T12:00:00Z`).getTime();
  return Math.max(0, Math.round((to - from) / 86400000));
}

async function syncOverdueCoordinationAlerts(
  today: string,
  overdueFollowUps: Array<{ _id: string; patientName?: string; reason: string; dueDate: string; assigneeId: string }>,
  overdueTasks: Array<{ _id: string; title: string; dueDate: string; assigneeId: string }>
): Promise<void> {
  const nowMs = Date.now();
  // Throttle database check to at most once every 5 minutes per server instance
  if (nowMs - lastOverdueAlertSyncAt < 5 * 60 * 1000) return;
  lastOverdueAlertSyncAt = nowMs;

  if (!overdueFollowUps.length && !overdueTasks.length) return;

  try {
    // Check recent notifications created today across staff roles to prevent duplicates
    const existing = await repository.listNotifications('system-check', ['ADMIN', 'MEDECIN', 'ACCUEIL']);
    const todayPrefix = today;
    const alreadyNotifiedEntityIds = new Set(
      existing
        .filter(
          (n) =>
            n.createdAt.slice(0, 10) === todayPrefix &&
            (n.eventType === 'TACHE_EN_RETARD' || n.eventType === 'SUIVI_A_EFFECTUER') &&
            n.relatedEntityId
        )
        .map((n) => n.relatedEntityId as string)
    );

    const nowIso = new Date().toISOString();
    let createdAny = false;

    for (const f of overdueFollowUps.slice(0, 5)) {
      if (alreadyNotifiedEntityIds.has(f._id)) continue;
      await repository.createNotification({
        recipientUserId: f.assigneeId,
        recipientRoles: ['ACCUEIL', 'MEDECIN'],
        eventType: 'SUIVI_A_EFFECTUER',
        title: `Suivi en retard : ${f.patientName || 'Patient'}`,
        message: `${f.reason} (échéance dépassée : ${f.dueDate}).`,
        linkModule: 'follow-ups',
        relatedEntityId: f._id,
        readByUserIds: [],
        channel: 'INTERNE',
        createdAt: nowIso,
      });
      createdAny = true;
    }

    for (const t of overdueTasks.slice(0, 5)) {
      if (alreadyNotifiedEntityIds.has(t._id)) continue;
      await repository.createNotification({
        recipientUserId: t.assigneeId,
        recipientRoles: ['ACCUEIL', 'ADMIN'],
        eventType: 'TACHE_EN_RETARD',
        title: `Tâche non réalisée en retard`,
        message: `${t.title} (date limite : ${t.dueDate}).`,
        linkModule: 'tasks',
        relatedEntityId: t._id,
        readByUserIds: [],
        channel: 'INTERNE',
        createdAt: nowIso,
      });
      createdAny = true;
    }

    if (createdAny) {
      emitSyncEvent('notification');
    }
  } catch (err) {
    console.warn('[OVERDUE_ALERT_SYNC_WARN]', err);
  }
}

// ---------------- ROLE-SPECIFIC DASHBOARD ----------------

financeRouter.get('/dashboard', async (req, res) => {
  const user = req.user!;
  const today = new Date().toISOString().slice(0, 10);

  // Patient portal dashboard
  if (user.roles.includes('PATIENT') && user.roles.length === 1) {
    if (!user.patientId) {
      return res.json({ role: 'PATIENT', patient: null, appointments: [], examinations: [], followUps: [], documents: [] });
    }
    const [patient, appointments, examinations, followUps, documents, settings] = await Promise.all([
      repository.findPatientById(user.patientId),
      repository.listAppointments({ patientId: user.patientId }),
      repository.listExaminations({ patientId: user.patientId }),
      repository.listFollowUps({ patientId: user.patientId }),
      repository.listDocuments({ patientId: user.patientId }),
      repository.getClinicSettings(),
    ]);

    return res.json({
      role: 'PATIENT',
      patient,
      appointments,
      examinations: examinations.filter((e) => e.status === 'VALIDE' && e.sharedWithPatient),
      followUps: followUps.filter((f) => f.type === 'CONTROLE_MEDICAL' || f.type === 'RENDEZ_VOUS_SUIVI'),
      documents: documents.filter((d) => d.sharedWithPatient),
      clinicInfo: settings || CLINIC_DEFAULTS,
    });
  }

  const isMedecin = hasPermission(user.roles, 'medical:read');
  const isAdmin = hasPermission(user.roles, 'statistics:read_admin');

  const [patients, appointments, followUps, tasks, examinations, consultations, payments] = await Promise.all([
    repository.listPatients({ status: 'ALL' }),
    repository.listAppointments({}),
    repository.listFollowUps({}),
    repository.listTasks({}),
    repository.listExaminations({}),
    repository.listConsultations({}),
    isAdmin || hasPermission(user.roles, 'payments:read') ? repository.listPayments({}) : Promise.resolve([]),
  ]);

  const todayAppts = appointments.filter((a) => a.date === today);
  const openFollowUps = followUps.filter((f) => f.status !== 'TERMINE' && f.status !== 'ANNULE');
  const overdueFollowUps = openFollowUps
    .filter((f) => f.dueDate < today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const todayFollowUps = openFollowUps.filter((f) => f.dueDate === today);

  // Patients to call today: prioritize phone follow-ups & admin reminders due today, plus other due-today follow-ups
  const patientsToCallToday = [...todayFollowUps].sort((a, b) => {
    const aCall = a.type === 'APPEL_TELEPHONIQUE' || a.type === 'RELANCE_ADMINISTRATIVE' ? 0 : 1;
    const bCall = b.type === 'APPEL_TELEPHONIQUE' || b.type === 'RELANCE_ADMINISTRATIVE' ? 0 : 1;
    return aCall - bCall;
  });

  const openTasks = tasks.filter((t) => t.status !== 'TERMINEE' && t.status !== 'ANNULEE');
  const overdueTasks = openTasks
    .filter((t) => t.dueDate < today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  // Unvalidated exams (performed / awaiting medical interpretation or validation)
  const unvalidatedExamsRaw = examinations.filter((e) =>
    ['REALISE', 'RESULTAT_DISPONIBLE', 'A_INTERPRETER'].includes(e.status)
  );
  const unvalidatedExams = isMedecin
    ? unvalidatedExamsRaw
    : unvalidatedExamsRaw.map((e) => ({ ...e, resultSummary: undefined, reportText: undefined }));

  // Controls to schedule: patients with validated consultation nextControlDate or open CONTROLE_MEDICAL/RENDEZ_VOUS_SUIVI
  // who do NOT yet have a future active appointment scheduled
  const activeAppointments = appointments.filter(
    (a) => a.status !== 'ANNULE' && a.status !== 'ABSENT' && a.status !== 'TERMINE'
  );
  const hasFutureApptAfter = (patientId: string, minDateExclusive: string) =>
    activeAppointments.some((a) => a.patientId === patientId && a.date > minDateExclusive);
  const hasUpcomingOrTodayAppt = (patientId: string) =>
    activeAppointments.some((a) => a.patientId === patientId && a.date >= today);

  const patientMap = new Map(patients.map((p) => [p._id, p]));
  const controlsMap = new Map<
    string,
    {
      id: string;
      patientId: string;
      patientName: string;
      patientNumber?: string;
      patientPhone?: string;
      recommendedDate: string;
      source: 'CONSULTATION' | 'SUIVI';
      label: string;
      assigneeName?: string;
    }
  >();

  for (const c of consultations) {
    if (c.status === 'VALIDEE' && c.nextControlDate && !hasFutureApptAfter(c.patientId, c.date)) {
      const p = patientMap.get(c.patientId);
      if (!controlsMap.has(c.patientId)) {
        controlsMap.set(c.patientId, {
          id: c._id,
          patientId: c.patientId,
          patientName: c.patientName || (p ? `${p.firstName} ${p.lastName}` : 'Patient'),
          patientNumber: c.patientNumber || p?.patientNumber,
          patientPhone: p?.phone,
          recommendedDate: c.nextControlDate,
          source: 'CONSULTATION',
          label: `Contrôle recommandé suite à la consultation du ${c.date}`,
          assigneeName: c.doctorName,
        });
      }
    }
  }

  for (const f of openFollowUps) {
    if (
      (f.type === 'CONTROLE_MEDICAL' || f.type === 'RENDEZ_VOUS_SUIVI') &&
      !hasUpcomingOrTodayAppt(f.patientId) &&
      !controlsMap.has(f.patientId)
    ) {
      controlsMap.set(f.patientId, {
        id: f._id,
        patientId: f.patientId,
        patientName: f.patientName || 'Patient',
        patientNumber: f.patientNumber,
        patientPhone: f.patientPhone,
        recommendedDate: f.dueDate,
        source: 'SUIVI',
        label: f.reason,
        assigneeName: f.assigneeName,
      });
    }
  }

  const controlsToSchedule = Array.from(controlsMap.values()).sort((a, b) =>
    a.recommendedDate.localeCompare(b.recommendedDate)
  );

  // Fire background deduplicated internal coordination alerts (non-blocking)
  void syncOverdueCoordinationAlerts(today, overdueFollowUps, overdueTasks);

  // Visible consultations for metrics/charts strictly follow RBAC
  const visibleConsultations = isMedecin || isAdmin ? consultations : [];

  // 7-day consultations chart
  const last7Days: Array<{ date: string; label: string; consultations: number; appointments: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit' });
    last7Days.push({
      date: iso,
      label,
      consultations: visibleConsultations.filter((c) => c.date === iso).length,
      appointments: appointments.filter((a) => a.date === iso && a.status !== 'ANNULE').length,
    });
  }

  // Exams by category
  const examsByCategoryMap = new Map<string, number>();
  for (const ex of examinations) {
    const label = EXAMINATION_TYPE_LABELS[ex.type as ExaminationType] || ex.type;
    examsByCategoryMap.set(label, (examsByCategoryMap.get(label) || 0) + 1);
  }
  const examsByCategory = Array.from(examsByCategoryMap.entries()).map(([name, value]) => ({ name, value }));

  const monthPrefix = today.slice(0, 7);
  const activePatients = patients.filter((p) => p.status === 'ACTIF');
  const newPatientsThisMonth = patients.filter((p) => p.createdAt.slice(0, 7) === monthPrefix);
  const nonCancelledAppts = appointments.filter((a) => a.status !== 'ANNULE');
  const absentAppts = appointments.filter((a) => a.status === 'ABSENT');
  const absenceRate = nonCancelledAppts.length
    ? Number(((absentAppts.length / nonCancelledAppts.length) * 100).toFixed(1))
    : 0;

  const totalRevenueFcfa = payments
    .filter((p) => p.status !== 'ANNULE')
    .reduce((acc, p) => acc + p.amountPaidFcfa, 0);
  const pendingBalanceFcfa = payments
    .filter((p) => p.status !== 'ANNULE')
    .reduce((acc, p) => acc + p.remainingBalanceFcfa, 0);

  return res.json({
    today,
    primaryRole: isMedecin ? 'MEDECIN' : isAdmin ? 'ADMIN' : 'ACCUEIL',
    metrics: {
      totalPatients: activePatients.length,
      newPatientsThisMonth: newPatientsThisMonth.length,
      consultationsToday: visibleConsultations.filter((c) => c.date === today).length,
      totalConsultations: visibleConsultations.length,
      appointmentsToday: todayAppts.filter((a) => a.status !== 'ANNULE').length,
      totalAppointments: nonCancelledAppts.length,
      patientsArrived: todayAppts.filter((a) => a.status === 'PATIENT_ARRIVE').length,
      patientsWaiting: todayAppts.filter((a) => a.status === 'PATIENT_ARRIVE' || a.status === 'EN_ATTENTE_CONSULTATION').length,
      patientsInConsultation: todayAppts.filter((a) => a.status === 'EN_CONSULTATION').length,
      appointmentsConfirmed: todayAppts.filter((a) => a.status === 'CONFIRME').length,
      appointmentsUnconfirmed: todayAppts.filter((a) => a.status === 'EN_ATTENTE').length,
      appointmentsAbsent: todayAppts.filter((a) => a.status === 'ABSENT').length,
      patientRequests: appointments.filter((a) => a.requestedByPatient && a.status === 'EN_ATTENTE').length,
      examsToInterpret: examinations.filter((e) => e.status === 'A_INTERPRETER' || e.status === 'RESULTAT_DISPONIBLE').length,
      examsPerformed: examinations.filter((e) => ['REALISE', 'RESULTAT_DISPONIBLE', 'A_INTERPRETER', 'VALIDE'].includes(e.status)).length,
      resultsToValidate: unvalidatedExams.length,
      followUpsToDo: openFollowUps.length,
      followUpsToday: todayFollowUps.length,
      followUpsOverdue: overdueFollowUps.length,
      controlsToScheduleCount: controlsToSchedule.length,
      upcomingAppointments: appointments.filter((a) => a.date >= today && a.status !== 'ANNULE' && a.status !== 'TERMINE').length,
      openTasks: openTasks.length,
      overdueTasks: overdueTasks.length,
      absenceRate,
      totalRevenueFcfa,
      pendingBalanceFcfa,
    },
    charts: {
      last7Days,
      examsByCategory,
    },
    lists: {
      recentPatients: activePatients.slice(0, 5),
      priorityFollowUps: [...overdueFollowUps, ...todayFollowUps].slice(0, 6),
      patientsToCallToday: patientsToCallToday.slice(0, 8),
      overdueFollowUps: overdueFollowUps.slice(0, 8).map((f) => ({
        ...f,
        daysOverdue: diffDaysIso(f.dueDate, today),
      })),
      unvalidatedExams: unvalidatedExams.slice(0, 8),
      controlsToSchedule: controlsToSchedule.slice(0, 8),
      overdueTasks: overdueTasks.slice(0, 8).map((t) => ({
        ...t,
        daysOverdue: diffDaysIso(t.dueDate, today),
      })),
      urgentTasks: [...openTasks]
        .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
        .slice(0, 6),
      upcomingSchedule: appointments
        .filter((a) => a.date >= today && a.status !== 'ANNULE' && a.status !== 'TERMINE')
        .slice(0, 6),
    },
  });
});

// ---------------- STATISTICS ----------------

financeRouter.get('/statistics', requireAnyPermission(['statistics:read_medical', 'statistics:read_admin']), async (req, res) => {
  const period = typeof req.query.period === 'string' ? req.query.period : 'month';
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  let startDate = typeof req.query.startDate === 'string' ? req.query.startDate : '';
  let endDate = typeof req.query.endDate === 'string' ? req.query.endDate : today;

  if (period === 'today') {
    startDate = today;
    endDate = today;
  } else if (period === 'week') {
    const d = new Date(now);
    d.setDate(d.getDate() - 6);
    startDate = d.toISOString().slice(0, 10);
  } else if (period === 'month') {
    startDate = `${today.slice(0, 7)}-01`;
  } else if (period === 'year') {
    startDate = `${today.slice(0, 4)}-01-01`;
  } else if (!startDate) {
    startDate = `${today.slice(0, 7)}-01`;
  }

  const [patients, consultations, appointments, examinations, followUps, payments] = await Promise.all([
    repository.listPatients({ status: 'ALL' }),
    repository.listConsultations({}),
    repository.listAppointments({ startDate, endDate }),
    repository.listExaminations({}),
    repository.listFollowUps({}),
    hasPermission(req.user!.roles, 'payments:read') || hasPermission(req.user!.roles, 'statistics:read_admin')
      ? repository.listPayments({ startDate, endDate })
      : Promise.resolve([]),
  ]);

  const inRange = (d: string) => d >= startDate && d <= endDate;

  const filteredConsultations = consultations.filter((c) => inRange(c.date));
  const filteredExams = examinations.filter((e) => inRange(e.prescriptionDate));
  const newPatients = patients.filter((p) => inRange(p.createdAt.slice(0, 10)));

  const completedFollowUps = followUps.filter((f) => f.status === 'TERMINE' && inRange(f.dueDate));
  const overdueFollowUps = followUps.filter((f) => f.status !== 'TERMINE' && f.status !== 'ANNULE' && f.dueDate < today);

  const nonCancelledAppts = appointments.filter((a) => a.status !== 'ANNULE');
  const absentAppts = appointments.filter((a) => a.status === 'ABSENT');
  const absenceRate = nonCancelledAppts.length
    ? Number(((absentAppts.length / nonCancelledAppts.length) * 100).toFixed(1))
    : 0;

  const examCatMap = new Map<string, number>();
  for (const e of filteredExams) {
    const label = EXAMINATION_TYPE_LABELS[e.type as ExaminationType] || e.type;
    examCatMap.set(label, (examCatMap.get(label) || 0) + 1);
  }

  const dailyRevMap = new Map<string, number>();
  for (const p of payments.filter((p) => p.status !== 'ANNULE')) {
    dailyRevMap.set(p.date, (dailyRevMap.get(p.date) || 0) + p.amountPaidFcfa);
  }

  const dailyActivityMap = new Map<string, { date: string; consultations: number; appointments: number }>();
  for (const c of filteredConsultations) {
    const entry = dailyActivityMap.get(c.date) || { date: c.date, consultations: 0, appointments: 0 };
    entry.consultations += 1;
    dailyActivityMap.set(c.date, entry);
  }
  for (const a of nonCancelledAppts) {
    const entry = dailyActivityMap.get(a.date) || { date: a.date, consultations: 0, appointments: 0 };
    entry.appointments += 1;
    dailyActivityMap.set(a.date, entry);
  }

  return res.json({
    range: { period, startDate, endDate },
    summary: {
      totalPatients: patients.filter((p) => p.status === 'ACTIF').length,
      newPatients: newPatients.length,
      consultationsCount: filteredConsultations.length,
      appointmentsCount: nonCancelledAppts.length,
      examsCount: filteredExams.length,
      absenceRate,
      followUpsCompleted: completedFollowUps.length,
      followUpsOverdue: overdueFollowUps.length,
      paymentsCount: payments.length,
      revenueFcfa: payments.filter((p) => p.status !== 'ANNULE').reduce((acc, p) => acc + p.amountPaidFcfa, 0),
    },
    charts: {
      examsByCategory: Array.from(examCatMap.entries()).map(([name, value]) => ({ name, value })),
      revenueByDate: Array.from(dailyRevMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, amount]) => ({ date, amount })),
      activityByDate: Array.from(dailyActivityMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
    },
  });
});

// ---------------- AUDIT LOGS (ADMIN ONLY) ----------------

function escapeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  // Neutralize CSV formula injection (Excel/Sheets)
  const neutralized = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${neutralized.replace(/"/g, '""')}"`;
}

financeRouter.get('/audit-logs', requirePermission('audit:read'), async (req, res) => {
  const severity = typeof req.query.severity === 'string' ? req.query.severity : undefined;
  const logs = await repository.listAuditLogs(250);
  const filtered = severity && severity !== 'ALL' ? logs.filter((l) => l.severity === severity) : logs;
  res.json({ logs: filtered });
});

financeRouter.get('/audit-logs/export', requirePermission('audit:read'), async (req, res) => {
  const severity = typeof req.query.severity === 'string' ? req.query.severity : undefined;
  const logs = await repository.listAllAuditLogs(severity);

  const headers = [
    'ID Journal',
    'Horodatage (ISO)',
    'Gravité',
    'Action',
    'Type de ressource',
    'ID Document affecté',
    'ID Utilisateur',
    'Acteur',
    'Rôles',
    'Détails',
    'Adresse IP',
  ];

  const rows = logs.map((l) =>
    [
      l._id,
      l.createdAt,
      l.severity,
      l.action,
      l.resourceType,
      l.resourceId || '',
      l.actorUserId || '',
      l.actorName,
      (l.actorRoles || []).join(' | '),
      l.details,
      l.ipAddress || '',
    ]
      .map(escapeCsvCell)
      .join(',')
  );

  const csvContent = '\uFEFF' + [headers.map(escapeCsvCell).join(','), ...rows].join('\r\n');

  await logAuditSafe(
    req,
    'AUDIT_LOG_EXPORTED',
    'auditLog',
    'export-csv',
    'INFO',
    `Export CSV complet du journal d'audit (${logs.length} entrées${severity && severity !== 'ALL' ? `, filtre: ${severity}` : ''})`
  );

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="cardio-erp-audit-journal-${new Date().toISOString().slice(0, 10)}.csv"`
  );
  return res.send(csvContent);
});

// ---------------- CLINIC SETTINGS ----------------

financeRouter.get('/settings', requirePermission('settings:manage'), async (_req, res) => {
  const settings = await repository.getClinicSettings();
  res.json({
    settings: settings || {
      _id: 'clinic-settings-main',
      _type: 'clinicSettings',
      ...CLINIC_DEFAULTS,
      notificationChannels: {
        smsEnabled: false,
        whatsappEnabled: false,
        emailEnabled: true,
        autoRemindersEnabled: true,
        appointmentReminderHoursBefore: 24,
        neverSendSensitiveMedicalData: true,
      },
      archivingPolicyYears: 20,
      updatedAt: new Date().toISOString(),
    },
  });
});

financeRouter.patch('/settings', requirePermission('settings:manage'), async (req, res) => {
  const schema = z.object({
    clinicName: z.string().min(2).optional(),
    leadDoctorName: z.string().min(2).optional(),
    specialty: z.string().min(2).optional(),
    city: z.string().min(2).optional(),
    phone: z.string().min(5).optional(),
    email: z.string().email().optional(),
    address: z.string().min(3).optional(),
    slogan: z.string().optional(),
    archivingPolicyYears: z.number().min(5).max(50).optional(),
    notificationChannels: z
      .object({
        smsEnabled: z.boolean(),
        smsProvider: z.string().optional(),
        whatsappEnabled: z.boolean(),
        whatsappBusinessNumber: z.string().optional(),
        emailEnabled: z.boolean(),
        senderEmail: z.string().optional(),
        autoRemindersEnabled: z.boolean().optional(),
        appointmentReminderHoursBefore: z.number().min(1).max(168).optional(),
        neverSendSensitiveMedicalData: z.boolean(),
      })
      .optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Paramètres invalides' });

  const updated = await repository.upsertClinicSettings({
    ...parsed.data,
    updatedAt: new Date().toISOString(),
  });
  invalidateClinicMetaCache();
  await logAuditSafe(req, 'SETTINGS_UPDATED', 'clinicSettings', updated._id, 'WARNING', 'Mise à jour paramètres du cabinet');
  emitSyncEvent('settings');
  return res.json({ settings: updated });
});

financeRouter.post('/settings/logo', requirePermission('settings:manage'), logoUpload.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fichier logo requis.' });

  if (!isR2Configured()) {
    return res.status(503).json({
      error: 'Stockage Cloudflare R2 non configuré. Renseignez les variables R2_* pour enregistrer un logo personnalisé.',
      code: 'R2_NOT_CONFIGURED',
    });
  }

  const ext = path.extname(req.file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '') || '.png';
  const logoKey = `branding/clinic-logo-${crypto.randomUUID()}${ext}`;

  try {
    await uploadFileToR2({
      key: logoKey,
      body: req.file.buffer,
      contentType: req.file.mimetype,
      allowedPrefix: 'branding/',
      metadata: { uploadedById: req.user!._id },
    });
  } catch (err: any) {
    console.error('[R2_LOGO_UPLOAD_ERROR]', err?.message || err);
    return res.status(502).json({ error: 'Échec du téléversement du logo vers Cloudflare R2.' });
  }

  const updated = await repository.upsertClinicSettings({
    logoStorageKey: logoKey,
    updatedAt: new Date().toISOString(),
  });
  invalidateClinicMetaCache();
  await logAuditSafe(req, 'LOGO_UPDATED', 'clinicSettings', updated._id, 'INFO', `Téléversement logo R2 (${logoKey})`);
  emitSyncEvent('settings');
  return res.json({ ok: true, logoUrl: `/api/settings/logo?t=${Date.now()}` });
});

financeRouter.get('/admin/backup', requirePermission('settings:manage'), async (req, res) => {
  const [patients, appointments, examinations, followUps, tasks, services, payments, settings, auditLogs] =
    await Promise.all([
      repository.listPatients({ status: 'ALL' }),
      repository.listAppointments({}),
      repository.listExaminations({}),
      repository.listFollowUps({}),
      repository.listTasks({}),
      repository.listServices(),
      repository.listPayments({}),
      repository.getClinicSettings(),
      repository.listAuditLogs(250),
    ]);

  await logAuditSafe(req, 'BACKUP_EXPORTED', 'system', 'backup', 'SECURITY', 'Export sauvegarde JSON administrateur');

  const snapshot = {
    exportedAt: new Date().toISOString(),
    exportedBy: `${req.user!.firstName} ${req.user!.lastName}`,
    note: 'Les hash de mots de passe et les pièces jointes binaires (stockées sur Cloudflare R2) ne sont pas inclus dans ce JSON ; sauvegarde Supabase PostgreSQL complémentaire.',
    counts: {
      patients: patients.length,
      appointments: appointments.length,
      examinations: examinations.length,
      followUps: followUps.length,
      tasks: tasks.length,
      services: services.length,
      payments: payments.length,
      auditLogs: auditLogs.length,
    },
    data: { settings, patients, appointments, examinations, followUps, tasks, services, payments, auditLogs },
  };

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="cardio-erp-backup-${new Date().toISOString().slice(0, 10)}.json"`
  );
  return res.send(JSON.stringify(snapshot, null, 2));
});
