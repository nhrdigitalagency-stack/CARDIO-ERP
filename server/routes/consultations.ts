import { Router } from 'express';
import { z } from 'zod';
import { repository } from '../repositories/SupabaseRepository';
import { logAuditSafe, requireAuth, requireCsrf, requirePermission, requireSupabaseConfigured } from '../middleware/auth';
import { emitSyncEvent } from '../services/eventBus';

export const consultationsRouter = Router();

// Strictly medical access only — ACCUEIL & PATIENT are blocked by requirePermission('consultations:read')
consultationsRouter.use(requireSupabaseConfigured, requireAuth, requireCsrf);

const vitalsSchema = z
  .object({
    systolicBP: z.number().min(40).max(300).optional(),
    diastolicBP: z.number().min(20).max(200).optional(),
    heartRate: z.number().min(20).max(260).optional(),
    temperature: z.number().min(30).max(44).optional(),
    oxygenSaturation: z.number().min(50).max(100).optional(),
    weight: z.number().min(1).max(350).optional(),
    height: z.number().min(30).max(250).optional(),
    bmi: z.number().optional(),
    respiratoryRate: z.number().min(5).max(80).optional(),
  })
  .optional()
  .default({});

const prescriptionLineSchema = z.object({
  medication: z.string().min(1),
  dosage: z.string().min(1),
  frequency: z.string().min(1),
  duration: z.string().min(1),
  instructions: z.string().optional(),
});

const examTypeEnum = z.enum([
  'ECG',
  'HOLTER_ECG',
  'HOLTER_MAPA',
  'ECHOCARDIOGRAPHIE_DOPPLER',
  'ECHOGRAPHIE_TRANS_OESOPHAGIENNE',
  'ECHO_DOPPLER_VASCULAIRE',
  'EPREUVE_EFFORT',
  'POLYGRAPHIE_VENTILATOIRE',
]);

const createConsultationSchema = z.object({
  patientId: z.string().min(1, 'Patient requis'),
  appointmentId: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  reason: z.string().min(2, 'Motif requis'),
  illnessHistory: z.string().optional(),
  symptoms: z.string().optional(),
  relevantHistory: z.string().optional(),
  clinicalExam: z.string().optional(),
  vitals: vitalsSchema,
  observations: z.string().optional(),
  diagnosticHypotheses: z.string().optional(),
  confirmedDiagnosis: z.string().optional(),
  prescribedExams: z.array(examTypeEnum).optional(),
  treatmentsText: z.string().optional(),
  prescriptionLines: z.array(prescriptionLineSchema).optional(),
  recommendations: z.string().optional(),
  nextControlDate: z.string().optional(),
});

function computeBmi(vitals: any) {
  if (vitals?.weight && vitals?.height && vitals.height > 0) {
    const hm = vitals.height / 100;
    return { ...vitals, bmi: Number((vitals.weight / (hm * hm)).toFixed(1)) };
  }
  return vitals || {};
}

consultationsRouter.get('/', requirePermission('consultations:read'), async (req, res) => {
  const patientId = typeof req.query.patientId === 'string' ? req.query.patientId : undefined;
  const consultations = await repository.listConsultations({ patientId });
  res.json({ consultations });
});

consultationsRouter.get('/:id', requirePermission('consultations:read'), async (req, res) => {
  const consultation = await repository.findConsultationById(req.params.id);
  if (!consultation) return res.status(404).json({ error: 'Consultation introuvable.' });
  return res.json({ consultation });
});

consultationsRouter.post('/', requirePermission('consultations:write'), async (req, res) => {
  const parsed = createConsultationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Données de consultation invalides' });
  }

  const now = new Date().toISOString();
  const vitals = computeBmi(parsed.data.vitals);

  const created = await repository.createConsultation({
    ...parsed.data,
    doctorId: req.user!._id,
    vitals,
    status: 'BROUILLON',
    corrections: [],
    isDemo: false,
    createdAt: now,
    updatedAt: now,
  });

  if (Object.keys(vitals).length > 0) {
    await repository.createVitalSigns({
      patientId: created.patientId,
      consultationId: created._id,
      ...vitals,
      recordedById: req.user!._id,
      recordedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  await logAuditSafe(
    req,
    'CONSULTATION_DRAFT_CREATED',
    'consultation',
    created._id,
    'INFO',
    `Brouillon consultation créé pour ${created.patientName}`
  );
  emitSyncEvent(['consultation', 'patient']);
  return res.status(201).json({ consultation: created });
});

consultationsRouter.patch('/:id', requirePermission('consultations:write'), async (req, res) => {
  const existing = await repository.findConsultationById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Consultation introuvable.' });

  // Validated consultations CANNOT be silently modified
  if (existing.status === 'VALIDEE') {
    return res.status(409).json({
      error:
        'Cette consultation est validée et verrouillée. Utilisez la procédure de correction horodatée avec motif.',
      code: 'CONSULTATION_LOCKED',
    });
  }

  const parsed = createConsultationSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Données invalides' });
  }

  const vitals = parsed.data.vitals ? computeBmi(parsed.data.vitals) : existing.vitals;
  const updated = await repository.updateConsultation(existing._id, {
    ...parsed.data,
    vitals,
    updatedAt: new Date().toISOString(),
  });

  await logAuditSafe(req, 'CONSULTATION_DRAFT_UPDATED', 'consultation', updated._id, 'INFO', 'Mise à jour brouillon');
  emitSyncEvent(['consultation', 'patient']);
  return res.json({ consultation: updated });
});

// Validate consultation -> locks record, creates prescribed exams & prescriptions, updates medicalRecord
consultationsRouter.post('/:id/validate', requirePermission('consultations:validate'), async (req, res) => {
  const existing = await repository.findConsultationById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Consultation introuvable.' });
  if (existing.status === 'VALIDEE') {
    return res.status(400).json({ error: 'Cette consultation est déjà validée.' });
  }

  const now = new Date().toISOString();
  const validated = await repository.updateConsultation(existing._id, {
    status: 'VALIDEE',
    validatedAt: now,
    validatedById: req.user!._id,
    updatedAt: now,
  });

  // Update medicalRecord lastConsultationAt
  await repository.upsertMedicalRecord(existing.patientId, {
    lastConsultationAt: now,
    primaryDoctorId: req.user!._id,
  });

  // Create formal Diagnosis records
  if (existing.confirmedDiagnosis?.trim()) {
    await repository.createDiagnosis({
      patientId: existing.patientId,
      consultationId: existing._id,
      label: existing.confirmedDiagnosis.trim(),
      type: 'RETENU',
      authorId: req.user!._id,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Create Prescription document if lines exist
  if (existing.prescriptionLines && existing.prescriptionLines.length > 0) {
    await repository.createPrescription({
      patientId: existing.patientId,
      consultationId: existing._id,
      doctorId: req.user!._id,
      date: existing.date,
      lines: existing.prescriptionLines,
      notes: existing.recommendations,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Create Examination records for prescribed exams
  const createdExams = [];
  if (existing.prescribedExams && existing.prescribedExams.length > 0) {
    for (const examType of existing.prescribedExams) {
      const examNumber = await repository.getNextExamNumber();
      const ex = await repository.createExamination({
        examNumber,
        patientId: existing.patientId,
        prescribingDoctorId: req.user!._id,
        consultationId: existing._id,
        prescriptionDate: existing.date,
        type: examType,
        status: 'PRESCRIT',
        sharedWithPatient: false,
        createdAt: now,
        updatedAt: now,
      });
      createdExams.push(ex);
    }
  }

  // If nextControlDate is specified, suggest/create a follow-up reminder if requested
  if (req.body?.autoCreateFollowUp && existing.nextControlDate) {
    await repository.createFollowUp({
      patientId: existing.patientId,
      consultationId: existing._id,
      type: 'CONTROLE_MEDICAL',
      reason: `Contrôle post-consultation (${existing.reason})`,
      dueDate: existing.nextControlDate,
      assigneeId: req.user!._id,
      priority: 'NORMALE',
      status: 'A_EFFECTUER',
      history: [
        {
          at: now,
          byId: req.user!._id,
          byName: `${req.user!.firstName} ${req.user!.lastName}`,
          action: 'Suivi programmé lors de la validation de consultation',
        },
      ],
      createdById: req.user!._id,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Mark linked appointment as TERMINE if present
  if (existing.appointmentId) {
    await repository.updateAppointment(existing.appointmentId, {
      status: 'TERMINE',
      consultationEndedAt: now,
      updatedAt: now,
    });
  }

  await logAuditSafe(
    req,
    'CONSULTATION_VALIDATED',
    'consultation',
    validated._id,
    'INFO',
    `Consultation validée et verrouillée pour ${validated.patientName}`
  );

  if (existing.nextControlDate) {
    await repository.createNotification({
      recipientRoles: ['ACCUEIL'],
      eventType: 'CONTROLE_A_PROGRAMMER',
      title: `Contrôle à programmer (${validated.patientName})`,
      message: `Prochain contrôle recommandé vers le ${existing.nextControlDate}.`,
      linkModule: 'appointments',
      relatedEntityId: validated._id,
      readByUserIds: [],
      channel: 'INTERNE',
      createdAt: now,
    });
  }

  emitSyncEvent(['consultation', 'patient', 'examination', 'followup', 'appointment', 'queue', 'notification']);

  return res.json({ consultation: validated, createdExams });
});

// Timestamped correction (addendum) on a validated consultation
consultationsRouter.post('/:id/amend', requirePermission('consultations:validate'), async (req, res) => {
  const schema = z.object({
    reason: z.string().min(5, 'Le motif de correction est obligatoire (min. 5 caractères)'),
    observations: z.string().optional(),
    confirmedDiagnosis: z.string().optional(),
    treatmentsText: z.string().optional(),
    recommendations: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Motif requis' });
  }

  const existing = await repository.findConsultationById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Consultation introuvable.' });
  if (existing.status !== 'VALIDEE') {
    return res.status(400).json({ error: 'Seule une consultation validée nécessite une correction horodatée.' });
  }

  const now = new Date().toISOString();
  const changedFields: string[] = [];
  if (parsed.data.observations !== undefined && parsed.data.observations !== existing.observations) changedFields.push('observations');
  if (parsed.data.confirmedDiagnosis !== undefined && parsed.data.confirmedDiagnosis !== existing.confirmedDiagnosis)
    changedFields.push('diagnostic retenu');
  if (parsed.data.treatmentsText !== undefined && parsed.data.treatmentsText !== existing.treatmentsText) changedFields.push('traitements');
  if (parsed.data.recommendations !== undefined && parsed.data.recommendations !== existing.recommendations)
    changedFields.push('recommandations');

  const correction = {
    correctedAt: now,
    correctedById: req.user!._id,
    correctedByName: `${req.user!.title ? req.user!.title + ' ' : ''}${req.user!.firstName} ${req.user!.lastName}`,
    reason: parsed.data.reason,
    changesSummary: changedFields.length ? `Champs modifiés : ${changedFields.join(', ')}` : 'Addendum enregistré',
  };

  const updated = await repository.updateConsultation(existing._id, {
    observations: parsed.data.observations ?? existing.observations,
    confirmedDiagnosis: parsed.data.confirmedDiagnosis ?? existing.confirmedDiagnosis,
    treatmentsText: parsed.data.treatmentsText ?? existing.treatmentsText,
    recommendations: parsed.data.recommendations ?? existing.recommendations,
    corrections: [...(existing.corrections || []), correction],
    updatedAt: now,
  });

  await logAuditSafe(
    req,
    'CONSULTATION_AMENDED',
    'consultation',
    updated._id,
    'WARNING',
    `Correction horodatée : ${parsed.data.reason}`
  );

  emitSyncEvent(['consultation', 'patient']);

  return res.json({ consultation: updated });
});
