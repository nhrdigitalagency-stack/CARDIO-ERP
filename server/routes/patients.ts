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
import { emitSyncEvent } from '../services/eventBus';
import { sendPatientPortalInviteEmail } from '../services/emailService';

export const patientsRouter = Router();

patientsRouter.use(requireSupabaseConfigured, requireAuth, requireCsrf);

const patientCreateSchema = z.object({
  firstName: z.string().min(2, 'Prénom requis'),
  lastName: z.string().min(2, 'Nom requis'),
  gender: z.enum(['M', 'F']),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date de naissance invalide (AAAA-MM-JJ)'),
  phone: z.string().min(6, 'Téléphone requis'),
  email: z.string().email('E-mail invalide').optional().or(z.literal('')),
  address: z.string().optional(),
  profession: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  bloodGroup: z.string().optional(),
  portalInvited: z.boolean().optional(),
  confirmDuplicateIgnore: z.boolean().optional(),
});

const patientUpdateSchema = patientCreateSchema.partial().extend({
  status: z.enum(['ACTIF', 'ARCHIVE']).optional(),
  medicalAlerts: z.array(z.string()).optional(),
});

// Check potential duplicates before creating
patientsRouter.post('/check-duplicates', requireAnyPermission(['patients:read_admin', 'patients:write_admin']), async (req, res) => {
  const schema = z.object({
    lastName: z.string().min(1),
    birthDate: z.string().optional().default(''),
    phone: z.string().optional().default(''),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Paramètres invalides' });

  const duplicates = await repository.findDuplicatePatients(
    parsed.data.lastName,
    parsed.data.birthDate,
    parsed.data.phone
  );
  return res.json({ duplicates });
});

patientsRouter.get('/', requireAnyPermission(['patients:read_admin', 'portal:access']), async (req, res) => {
  const user = req.user!;

  // PATIENT role can ONLY see their own linked patient record
  if (user.roles.includes('PATIENT') && !hasPermission(user.roles, 'patients:read_admin')) {
    if (!user.patientId) return res.json({ patients: [] });
    const own = await repository.findPatientById(user.patientId);
    return res.json({ patients: own ? [own] : [] });
  }

  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const status = typeof req.query.status === 'string' ? (req.query.status as any) : 'ALL';
  const gender = typeof req.query.gender === 'string' && (req.query.gender === 'M' || req.query.gender === 'F') ? req.query.gender : undefined;

  const patients = await repository.listPatients({ search, status, gender });
  return res.json({ patients });
});

patientsRouter.post('/', requirePermission('patients:write_admin'), async (req, res) => {
  const parsed = patientCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Données patient invalides' });
  }

  const duplicates = await repository.findDuplicatePatients(
    parsed.data.lastName,
    parsed.data.birthDate,
    parsed.data.phone
  );
  if (duplicates.length > 0 && !parsed.data.confirmDuplicateIgnore) {
    return res.status(409).json({
      error: 'Doublon potentiel détecté. Vérifiez les dossiers existants avant de confirmer la création.',
      code: 'POTENTIAL_DUPLICATE',
      duplicates,
    });
  }

  const now = new Date().toISOString();
  const patientNumber = await repository.getNextPatientNumber();
  const created = await repository.createPatient({
    patientNumber,
    firstName: parsed.data.firstName.trim(),
    lastName: parsed.data.lastName.trim().toUpperCase(),
    gender: parsed.data.gender,
    birthDate: parsed.data.birthDate,
    phone: parsed.data.phone.trim(),
    email: parsed.data.email || '',
    address: parsed.data.address || '',
    profession: parsed.data.profession || '',
    emergencyContactName: parsed.data.emergencyContactName || '',
    emergencyContactPhone: parsed.data.emergencyContactPhone || '',
    bloodGroup: parsed.data.bloodGroup || '',
    medicalAlerts: [],
    status: 'ACTIF',
    portalInvited: Boolean(parsed.data.portalInvited),
    portalActivated: false,
    isDemo: false,
    createdById: req.user!._id,
    createdAt: now,
    updatedAt: now,
  });

  await repository.upsertMedicalRecord(created._id, { isDemo: false });
  await logAuditSafe(req, 'PATIENT_CREATED', 'patient', created._id, 'INFO', `Création patient ${created.patientNumber}`);
  emitSyncEvent('patient');

  if (created.portalInvited && created.email) {
    sendPatientPortalInviteEmail({
      patientEmail: created.email,
      patientName: `${created.firstName} ${created.lastName}`,
      patientNumber: created.patientNumber,
      patientId: created._id,
    }).catch(() => undefined);
  }

  return res.status(201).json({ patient: created });
});

// Helper to verify access to a specific patient (blocks IDOR for PATIENT role)
function canAccessPatient(user: Express.Request['user'], patientId: string): boolean {
  if (!user) return false;
  if (hasPermission(user.roles, 'patients:read_admin')) return true;
  if (user.roles.includes('PATIENT') && user.patientId === patientId) return true;
  return false;
}

patientsRouter.get('/:id', requireAnyPermission(['patients:read_admin', 'portal:access']), async (req, res) => {
  const user = req.user!;
  const isStaff = hasPermission(user.roles, 'patients:read_admin');
  const patient = await repository.findPatientById(req.params.id);

  if (!patient) {
    if (!isStaff) {
      await logAuditSafe(req, 'IDOR_BLOCKED', 'patient', req.params.id, 'SECURITY', 'Tentative accès dossier patient inexistant ou non autorisé');
      return res.status(403).json({ error: 'Accès non autorisé à ce dossier patient.' });
    }
    return res.status(404).json({ error: 'Patient introuvable.' });
  }

  const canonicalId = patient._id;
  if (!canAccessPatient(user, canonicalId)) {
    await logAuditSafe(req, 'IDOR_BLOCKED', 'patient', canonicalId, 'SECURITY', 'Tentative accès dossier patient non autorisé');
    return res.status(403).json({ error: 'Accès non autorisé à ce dossier patient.' });
  }

  const isMedical = hasPermission(user.roles, 'medical:read');
  const isPatientSelf = user.roles.includes('PATIENT') && user.patientId === canonicalId;
  const canReadPayments = isStaff && hasPermission(user.roles, 'payments:read');

  // Fetch allowed sub-collections according to strict RBAC
  const [appointments, followUps, documents, payments, auditLogs] = await Promise.all([
    repository.listAppointments({ patientId: canonicalId }),
    repository.listFollowUps({ patientId: canonicalId }),
    repository.listDocuments({ patientId: canonicalId }),
    canReadPayments ? repository.listPayments({ patientId: canonicalId }) : Promise.resolve([]),
    hasPermission(user.roles, 'audit:read') || isMedical ? repository.listAuditLogs(200) : Promise.resolve([]),
  ]);

  const relatedIds = new Set<string>([
    canonicalId,
    ...appointments.map((a) => a._id),
    ...followUps.map((f) => f._id),
    ...documents.map((d) => d._id),
    ...payments.map((p) => p._id),
  ]);
  const fullName = `${patient.firstName} ${patient.lastName}`;

  if (isMedical) {
    const [
      medicalRecord,
      histories,
      allergies,
      medications,
      consultations,
      vitals,
      diagnoses,
      prescriptions,
      examinations,
    ] = await Promise.all([
      repository.getMedicalRecordByPatient(canonicalId),
      repository.listMedicalHistory(canonicalId),
      repository.listAllergies(canonicalId),
      repository.listMedications(canonicalId),
      repository.listConsultations({ patientId: canonicalId }),
      repository.listVitalSigns(canonicalId),
      repository.listDiagnoses(canonicalId),
      repository.listPrescriptions(canonicalId),
      repository.listExaminations({ patientId: canonicalId }),
    ]);

    consultations.forEach((c) => relatedIds.add(c._id));
    examinations.forEach((e) => relatedIds.add(e._id));
    const patientAudit = auditLogs.filter(
      (l) => relatedIds.has(l.resourceId || '') || l.details.includes(patient.patientNumber) || l.details.includes(fullName)
    );

    return res.json({
      patient,
      accessLevel: 'MEDICAL',
      medicalRecord,
      histories,
      allergies,
      medications,
      consultations,
      vitals,
      diagnoses,
      prescriptions,
      examinations,
      appointments,
      followUps,
      documents,
      payments,
      auditLogs: patientAudit,
    });
  }

  if (isPatientSelf) {
    // Patients ONLY see validated & shared exam results and shared documents
    const allExams = await repository.listExaminations({ patientId: canonicalId });
    const sharedValidatedExams = allExams.filter((e) => e.status === 'VALIDE' && e.sharedWithPatient);
    const sharedDocs = documents.filter((d) => d.sharedWithPatient);

    return res.json({
      patient,
      accessLevel: 'PATIENT_SELF',
      appointments,
      followUps: followUps.filter((f) => f.type === 'CONTROLE_MEDICAL' || f.type === 'RENDEZ_VOUS_SUIVI'),
      examinations: sharedValidatedExams,
      documents: sharedDocs,
    });
  }

  // ACCUEIL / ADMIN (without MEDECIN role): Administrative view ONLY (confidential medical notes withheld)
  const exams = await repository.listExaminations({ patientId: canonicalId });
  exams.forEach((e) => relatedIds.add(e._id));
  const patientAudit = auditLogs.filter(
    (l) => relatedIds.has(l.resourceId || '') || l.details.includes(patient.patientNumber) || l.details.includes(fullName)
  );
  const adminExams = exams.map((e) => ({
    _id: e._id,
    _type: e._type,
    examNumber: e.examNumber,
    patientId: e.patientId,
    type: e.type,
    prescriptionDate: e.prescriptionDate,
    scheduledDate: e.scheduledDate,
    status: e.status,
  }));

  return res.json({
    patient,
    accessLevel: 'ADMINISTRATIVE',
    appointments,
    followUps,
    examinations: adminExams,
    documents: documents.filter((d) => d.category === 'COURRIER_MEDICAL' || d.category === 'AUTRE' || d.sharedWithPatient),
    payments,
    auditLogs: patientAudit,
  });
});

patientsRouter.patch('/:id', requireAnyPermission(['patients:write_admin', 'portal:access']), async (req, res) => {
  const user = req.user!;
  const isStaff = hasPermission(user.roles, 'patients:write_admin');
  const existing = await repository.findPatientById(req.params.id);

  if (!existing) {
    if (!isStaff) {
      return res.status(403).json({ error: 'Modification non autorisée.' });
    }
    return res.status(404).json({ error: 'Patient introuvable.' });
  }

  const canonicalId = existing._id;
  const isPatientSelf = user.roles.includes('PATIENT') && user.patientId === canonicalId;

  if (!isStaff && !isPatientSelf) {
    return res.status(403).json({ error: 'Modification non autorisée.' });
  }

  if (isPatientSelf && !isStaff) {
    // Patients may only update their own contact details
    const selfSchema = z.object({
      phone: z.string().min(6).optional(),
      email: z.string().email().optional().or(z.literal('')),
      address: z.string().optional(),
      emergencyContactName: z.string().optional(),
      emergencyContactPhone: z.string().optional(),
    });
    const parsed = selfSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Coordonnées invalides' });
    const updated = await repository.updatePatient(canonicalId, { ...parsed.data, updatedAt: new Date().toISOString() });
    await logAuditSafe(req, 'PATIENT_SELF_UPDATED', 'patient', canonicalId, 'INFO', 'Mise à jour coordonnées par le patient');
    emitSyncEvent('patient');
    return res.json({ patient: updated });
  }

  const parsed = patientUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Données invalides' });
  }

  if (parsed.data.status === 'ARCHIVE' && !hasPermission(user.roles, 'patients:archive') && !hasPermission(user.roles, 'medical:write')) {
    return res.status(403).json({ error: "L'archivage nécessite les droits administrateur ou médecin." });
  }

  if (parsed.data.medicalAlerts !== undefined && !hasPermission(user.roles, 'medical:write')) {
    return res.status(403).json({ error: 'Seul le médecin peut modifier les alertes médicales.' });
  }

  const updated = await repository.updatePatient(canonicalId, {
    ...parsed.data,
    lastName: parsed.data.lastName ? parsed.data.lastName.trim().toUpperCase() : existing.lastName,
    updatedAt: new Date().toISOString(),
  });
  await logAuditSafe(req, 'PATIENT_UPDATED', 'patient', canonicalId, 'INFO', `Mise à jour patient ${updated.patientNumber}`);
  emitSyncEvent('patient');

  if (parsed.data.portalInvited && !existing.portalInvited && updated.email) {
    sendPatientPortalInviteEmail({
      patientEmail: updated.email,
      patientName: `${updated.firstName} ${updated.lastName}`,
      patientNumber: updated.patientNumber,
      patientId: updated._id,
    }).catch(() => undefined);
  }

  return res.json({ patient: updated });
});

// Update Medical Record synthesis, risk factors & medical alerts (MEDECIN only)
patientsRouter.patch('/:id/medical-record', requirePermission('medical:write'), async (req, res) => {
  const patient = await repository.findPatientById(req.params.id);
  if (!patient) return res.status(404).json({ error: 'Patient introuvable.' });

  const schema = z.object({
    summary: z.string().max(4000).optional(),
    riskFactors: z.array(z.string().min(1).max(120)).optional(),
    medicalAlerts: z.array(z.string().min(1).max(160)).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Données dossier médical invalides' });

  const now = new Date().toISOString();
  const medicalRecord = await repository.upsertMedicalRecord(patient._id, {
    summary: parsed.data.summary,
    riskFactors: parsed.data.riskFactors,
    primaryDoctorId: req.user!._id,
    isDemo: patient.isDemo,
  });

  let updatedPatient = patient;
  if (parsed.data.medicalAlerts !== undefined) {
    updatedPatient = await repository.updatePatient(patient._id, {
      medicalAlerts: parsed.data.medicalAlerts,
      updatedAt: now,
    });
  }

  await logAuditSafe(req, 'MEDICAL_RECORD_UPDATED', 'patient', patient._id, 'INFO', `Synthèse dossier médical mise à jour (${patient.patientNumber})`);
  emitSyncEvent('patient');
  return res.json({ medicalRecord, patient: updatedPatient });
});

// Medical-only sub-endpoints (Antécédents, Allergies, Traitements, Constantes)
patientsRouter.post('/:id/history', requirePermission('medical:write'), async (req, res) => {
  const patient = await repository.findPatientById(req.params.id);
  if (!patient) return res.status(404).json({ error: 'Patient introuvable.' });

  const schema = z.object({
    category: z.enum(['CARDIOVASCULAIRE', 'CHIRURGICAL', 'FAMILIAL', 'AUTRE']),
    title: z.string().min(2),
    details: z.string().optional(),
    diagnosedYear: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Antécédent invalide' });

  const now = new Date().toISOString();
  const item = await repository.createMedicalHistory({
    patientId: patient._id,
    ...parsed.data,
    authorId: req.user!._id,
    createdAt: now,
    updatedAt: now,
  });
  await logAuditSafe(req, 'MEDICAL_HISTORY_ADDED', 'patient', patient._id, 'INFO', `Ajout antécédent: ${item.title}`);
  emitSyncEvent('patient');
  return res.status(201).json({ item });
});

patientsRouter.delete('/:id/history/:itemId', requirePermission('medical:write'), async (req, res) => {
  const patient = await repository.findPatientById(req.params.id);
  if (!patient) return res.status(404).json({ error: 'Patient introuvable.' });

  const existing = await repository.findMedicalHistoryById(req.params.itemId);
  if (!existing || existing.patientId !== patient._id) {
    return res.status(404).json({ error: 'Antécédent introuvable.' });
  }

  await repository.deleteMedicalHistory(existing._id);
  await logAuditSafe(req, 'MEDICAL_HISTORY_DELETED', 'patient', patient._id, 'WARNING', `Suppression antécédent: ${existing.title}`);
  emitSyncEvent('patient');
  return res.json({ ok: true });
});

patientsRouter.post('/:id/allergies', requirePermission('medical:write'), async (req, res) => {
  const patient = await repository.findPatientById(req.params.id);
  if (!patient) return res.status(404).json({ error: 'Patient introuvable.' });

  const schema = z.object({
    allergen: z.string().min(2),
    reaction: z.string().optional(),
    severity: z.enum(['LEGERE', 'MODEREE', 'SEVERE']),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Allergie invalide' });

  const now = new Date().toISOString();
  const item = await repository.createAllergy({
    patientId: patient._id,
    ...parsed.data,
    authorId: req.user!._id,
    createdAt: now,
    updatedAt: now,
  });
  await logAuditSafe(req, 'ALLERGY_ADDED', 'patient', patient._id, 'INFO', `Ajout allergie: ${item.allergen}`);
  emitSyncEvent('patient');
  return res.status(201).json({ item });
});

patientsRouter.delete('/:id/allergies/:itemId', requirePermission('medical:write'), async (req, res) => {
  const patient = await repository.findPatientById(req.params.id);
  if (!patient) return res.status(404).json({ error: 'Patient introuvable.' });

  const existing = await repository.findAllergyById(req.params.itemId);
  if (!existing || existing.patientId !== patient._id) {
    return res.status(404).json({ error: 'Allergie introuvable.' });
  }

  await repository.deleteAllergy(existing._id);
  await logAuditSafe(req, 'ALLERGY_DELETED', 'patient', patient._id, 'WARNING', `Suppression allergie: ${existing.allergen}`);
  emitSyncEvent('patient');
  return res.json({ ok: true });
});

patientsRouter.post('/:id/medications', requirePermission('medical:write'), async (req, res) => {
  const patient = await repository.findPatientById(req.params.id);
  if (!patient) return res.status(404).json({ error: 'Patient introuvable.' });

  const schema = z.object({
    name: z.string().min(2),
    dosage: z.string().min(1),
    frequency: z.string().min(1),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    active: z.boolean().default(true),
    notes: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Traitement invalide' });

  const now = new Date().toISOString();
  const item = await repository.createMedication({
    patientId: patient._id,
    ...parsed.data,
    prescribedById: req.user!._id,
    createdAt: now,
    updatedAt: now,
  });
  await logAuditSafe(req, 'MEDICATION_ADDED', 'patient', patient._id, 'INFO', `Ajout traitement: ${item.name}`);
  emitSyncEvent('patient');
  return res.status(201).json({ item });
});

patientsRouter.patch('/:id/medications/:medId', requirePermission('medical:write'), async (req, res) => {
  const patient = await repository.findPatientById(req.params.id);
  if (!patient) return res.status(404).json({ error: 'Patient introuvable.' });

  const existingMed = await repository.findMedicationById(req.params.medId);
  if (!existingMed || existingMed.patientId !== patient._id) {
    return res.status(404).json({ error: 'Traitement introuvable.' });
  }

  const schema = z.object({ active: z.boolean(), endDate: z.string().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Données invalides' });

  const item = await repository.updateMedication(existingMed._id, {
    ...parsed.data,
    updatedAt: new Date().toISOString(),
  });
  await logAuditSafe(
    req,
    'MEDICATION_UPDATED',
    'patient',
    patient._id,
    'INFO',
    `Traitement ${existingMed.name} ${parsed.data.active ? 'repris' : 'arrêté'}`
  );
  emitSyncEvent('patient');
  return res.json({ item });
});

patientsRouter.post('/:id/vitals', requirePermission('medical:write'), async (req, res) => {
  const patient = await repository.findPatientById(req.params.id);
  if (!patient) return res.status(404).json({ error: 'Patient introuvable.' });

  const schema = z.object({
    systolicBP: z.number().min(40).max(300).optional(),
    diastolicBP: z.number().min(20).max(200).optional(),
    heartRate: z.number().min(20).max(260).optional(),
    temperature: z.number().min(30).max(44).optional(),
    oxygenSaturation: z.number().min(50).max(100).optional(),
    weight: z.number().min(1).max(350).optional(),
    height: z.number().min(30).max(250).optional(),
    respiratoryRate: z.number().min(5).max(80).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Constantes hors plage valide' });

  let bmi: number | undefined;
  if (parsed.data.weight && parsed.data.height && parsed.data.height > 0) {
    const hMeters = parsed.data.height / 100;
    bmi = Number((parsed.data.weight / (hMeters * hMeters)).toFixed(1));
  }

  const now = new Date().toISOString();
  const item = await repository.createVitalSigns({
    patientId: patient._id,
    ...parsed.data,
    bmi,
    recordedById: req.user!._id,
    recordedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await logAuditSafe(req, 'VITALS_RECORDED', 'patient', patient._id, 'INFO', 'Enregistrement constantes');
  emitSyncEvent('patient');
  return res.status(201).json({ item });
});
