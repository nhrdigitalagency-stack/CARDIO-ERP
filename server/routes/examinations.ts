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
import { EXAMINATION_TYPE_LABELS } from '../../src/shared/constants';
import type { ExaminationType } from '../../src/shared/types';
import { emitSyncEvent } from '../services/eventBus';
import { sendExamValidatedEmail } from '../services/emailService';
import { sendExamValidatedWhatsApp } from '../services/whatsappService';

export const examinationsRouter = Router();

examinationsRouter.use(requireSupabaseConfigured, requireAuth, requireCsrf);

const examTypeValues = [
  'ECG',
  'HOLTER_ECG',
  'HOLTER_MAPA',
  'ECHOCARDIOGRAPHIE_DOPPLER',
  'ECHOGRAPHIE_TRANS_OESOPHAGIENNE',
  'ECHO_DOPPLER_VASCULAIRE',
  'EPREUVE_EFFORT',
  'POLYGRAPHIE_VENTILATOIRE',
] as const;

const examStatusValues = [
  'PRESCRIT',
  'PROGRAMME',
  'EN_COURS',
  'REALISE',
  'RESULTAT_DISPONIBLE',
  'A_INTERPRETER',
  'VALIDE',
  'ANNULE',
] as const;

const createExamSchema = z.object({
  patientId: z.string().min(1, 'Patient requis'),
  consultationId: z.string().optional(),
  type: z.enum(examTypeValues),
  scheduledDate: z.string().optional(),
  technicalNotes: z.string().optional(),
});

const updateExamSchema = z.object({
  scheduledDate: z.string().optional(),
  performedDate: z.string().optional(),
  operatorName: z.string().optional(),
  technicalNotes: z.string().optional(),
  attachedDocumentId: z.string().optional(),
  resultSummary: z.string().optional(),
  reportText: z.string().optional(),
  status: z.enum(examStatusValues).optional(),
});

examinationsRouter.get('/', requireAnyPermission(['examinations:read', 'portal:access']), async (req, res) => {
  const user = req.user!;
  const isPatient = user.roles.includes('PATIENT') && !hasPermission(user.roles, 'examinations:read');
  const isMedical = hasPermission(user.roles, 'medical:read');

  if (isPatient && !user.patientId) return res.json({ examinations: [] });

  const examinations = await repository.listExaminations({
    patientId: isPatient ? user.patientId : typeof req.query.patientId === 'string' ? req.query.patientId : undefined,
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    type: typeof req.query.type === 'string' ? req.query.type : undefined,
  });

  // Patients only ever receive VALIDATED & SHARED examinations
  if (isPatient) {
    return res.json({
      examinations: examinations.filter((e) => e.status === 'VALIDE' && e.sharedWithPatient),
    });
  }

  // Non-medical staff (ACCUEIL) cannot read clinical reportText/resultSummary interpretations
  if (!isMedical) {
    return res.json({
      examinations: examinations.map((e) => ({
        ...e,
        resultSummary: undefined,
        reportText: undefined,
      })),
    });
  }

  return res.json({ examinations });
});

examinationsRouter.post('/', requirePermission('examinations:prescribe'), async (req, res) => {
  const parsed = createExamSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Données examen invalides' });
  }

  const now = new Date().toISOString();
  const examNumber = await repository.getNextExamNumber();
  const created = await repository.createExamination({
    examNumber,
    patientId: parsed.data.patientId,
    prescribingDoctorId: req.user!._id,
    consultationId: parsed.data.consultationId,
    prescriptionDate: now.slice(0, 10),
    type: parsed.data.type,
    scheduledDate: parsed.data.scheduledDate,
    technicalNotes: parsed.data.technicalNotes,
    status: parsed.data.scheduledDate ? 'PROGRAMME' : 'PRESCRIT',
    sharedWithPatient: false,
    isDemo: false,
    createdAt: now,
    updatedAt: now,
  });

  await logAuditSafe(req, 'EXAM_PRESCRIBED', 'examination', created._id, 'INFO', `Prescription ${created.examNumber} (${created.type})`);
  emitSyncEvent(['examination', 'patient']);
  return res.status(201).json({ examination: created });
});

examinationsRouter.patch('/:id', requireAnyPermission(['examinations:operate', 'appointments:write']), async (req, res) => {
  const existing = await repository.findExaminationById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Examen introuvable.' });

  const parsed = updateExamSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Données invalides' });
  }

  const user = req.user!;
  const isMedical = hasPermission(user.roles, 'examinations:operate');

  // Administrative staff can only update scheduling/cancellation
  if (!isMedical) {
    const allowedStatus = parsed.data.status === 'PROGRAMME' || parsed.data.status === 'ANNULE' ? parsed.data.status : undefined;
    const updated = await repository.updateExamination(existing._id, {
      scheduledDate: parsed.data.scheduledDate ?? existing.scheduledDate,
      status: allowedStatus ?? existing.status,
      updatedAt: new Date().toISOString(),
    });
    emitSyncEvent(['examination', 'patient']);
    return res.json({ examination: { ...updated, resultSummary: undefined, reportText: undefined } });
  }

  // Doctors cannot bypass validate-result endpoint to set status = VALIDE
  if (parsed.data.status === 'VALIDE') {
    return res.status(400).json({ error: 'Utilisez la validation médicale explicite pour valider cet examen.' });
  }

  const now = new Date().toISOString();
  const updated = await repository.updateExamination(existing._id, {
    ...parsed.data,
    updatedAt: now,
  });

  if (parsed.data.status === 'RESULTAT_DISPONIBLE' || parsed.data.status === 'A_INTERPRETER') {
    const label = EXAMINATION_TYPE_LABELS[updated.type as ExaminationType] || updated.type;
    await repository.createNotification({
      recipientRoles: ['MEDECIN'],
      eventType: parsed.data.status === 'A_INTERPRETER' ? 'EXAMEN_A_INTERPRETER' : 'RESULTAT_DISPONIBLE',
      title: `${label} (${updated.examNumber}) prêt`,
      message: `Examen de ${updated.patientName} en attente d'interprétation / validation médicale.`,
      linkModule: 'examinations',
      relatedEntityId: updated._id,
      readByUserIds: [],
      channel: 'INTERNE',
      createdAt: now,
    });
  }

  await logAuditSafe(req, 'EXAM_UPDATED', 'examination', updated._id, 'INFO', `Examen ${updated.examNumber} -> ${updated.status}`);
  emitSyncEvent(['examination', 'patient', 'notification']);
  return res.json({ examination: updated });
});

examinationsRouter.post('/:id/validate-result', requirePermission('examinations:validate'), async (req, res) => {
  const schema = z.object({
    resultSummary: z.string().min(3, 'Résumé du résultat requis'),
    reportText: z.string().min(5, 'Compte rendu médical requis'),
    sharedWithPatient: z.boolean().default(true),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Compte rendu requis pour la validation' });
  }

  const existing = await repository.findExaminationById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Examen introuvable.' });

  const now = new Date().toISOString();
  const updated = await repository.updateExamination(existing._id, {
    resultSummary: parsed.data.resultSummary,
    reportText: parsed.data.reportText,
    interpretingDoctorId: req.user!._id,
    validatedAt: now,
    sharedWithPatient: parsed.data.sharedWithPatient,
    status: 'VALIDE',
    updatedAt: now,
  });

  await repository.createExaminationResult({
    examinationId: existing._id,
    patientId: existing.patientId,
    conclusion: parsed.data.resultSummary,
    reportText: parsed.data.reportText,
    interpretingDoctorId: req.user!._id,
    validated: true,
    validatedAt: now,
    sharedWithPatient: parsed.data.sharedWithPatient,
    createdAt: now,
    updatedAt: now,
  });

  if (existing.attachedDocumentId && parsed.data.sharedWithPatient) {
    await repository.updateDocument(existing.attachedDocumentId, {
      sharedWithPatient: true,
      updatedAt: now,
    });
  }

  if (parsed.data.sharedWithPatient) {
    const [allUsers, patient] = await Promise.all([
      repository.listUsers(),
      repository.findPatientById(existing.patientId),
    ]);
    const patientPortalUser = allUsers.find((u) => u.isActive && u.roles.includes('PATIENT') && u.patientId === existing.patientId);
    if (patientPortalUser) {
      await repository.createNotification({
        recipientUserId: patientPortalUser._id,
        recipientRoles: [],
        eventType: 'RESULTAT_DISPONIBLE',
        title: 'Résultat d’examen validé disponible',
        message: `Votre compte rendu (${updated.examNumber}) a été validé par votre cardiologue et est consultable dans votre espace patient.`,
        linkModule: 'patient-portal',
        relatedEntityId: updated._id,
        readByUserIds: [],
        channel: 'INTERNE',
        createdAt: now,
      });
    }
    if (patient) {
      const examTypeLabel = EXAMINATION_TYPE_LABELS[updated.type as ExaminationType] || updated.type;
      if (patient.email) {
        sendExamValidatedEmail({
          patientId: patient._id,
          patientName: `${patient.firstName} ${patient.lastName}`,
          patientEmail: patient.email,
          examNumber: updated.examNumber,
          examTypeLabel,
          examinationId: updated._id,
        }).catch(() => undefined);
      }
      if (patient.phone) {
        sendExamValidatedWhatsApp({
          patientId: patient._id,
          patientName: `${patient.firstName} ${patient.lastName}`,
          patientPhone: patient.phone,
          examNumber: updated.examNumber,
          examTypeLabel,
          examinationId: updated._id,
        }).catch(() => undefined);
      }
    }
  }

  await logAuditSafe(
    req,
    'EXAM_VALIDATED',
    'examination',
    updated._id,
    'INFO',
    `Résultat validé pour ${updated.examNumber} (${updated.patientName})`
  );
  emitSyncEvent(['examination', 'patient', 'document', 'notification']);
  return res.json({ examination: updated });
});
