import { repository } from '../repositories/SupabaseRepository';
import { hashPassword } from './security';
import { CLINIC_DEFAULTS, ROLE_PERMISSIONS } from '../../src/shared/constants';
import type { RoleCode } from '../../src/shared/types';

function isoDateOffset(daysOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return d.toISOString().slice(0, 10);
}

export async function seedDemoEnvironment(actorName = 'Système'): Promise<{
  createdCounts: Record<string, number>;
}> {
  const now = new Date().toISOString();
  const today = isoDateOffset(0);
  const yesterday = isoDateOffset(-1);
  const twoDaysAgo = isoDateOffset(-2);
  const tomorrow = isoDateOffset(1);
  const inThreeDays = isoDateOffset(3);

  // 1. Ensure clinic settings & roles exist
  await repository.upsertClinicSettings({
    clinicName: CLINIC_DEFAULTS.clinicName,
    leadDoctorName: CLINIC_DEFAULTS.leadDoctorName,
    specialty: CLINIC_DEFAULTS.specialty,
    city: CLINIC_DEFAULTS.city,
    phone: CLINIC_DEFAULTS.phone,
    email: CLINIC_DEFAULTS.email,
    address: CLINIC_DEFAULTS.address,
    slogan: CLINIC_DEFAULTS.slogan,
    updatedAt: now,
  });

  const roleCodes: RoleCode[] = ['ADMIN', 'MEDECIN', 'ACCUEIL', 'PATIENT'];
  const roleNames: Record<RoleCode, string> = {
    ADMIN: 'Administrateur',
    MEDECIN: 'Médecin / Docteur',
    ACCUEIL: 'Accueil / Secrétariat',
    PATIENT: 'Patient',
  };
  for (const code of roleCodes) {
    await repository.upsertRole({
      _id: `role-${code.toLowerCase()}`,
      _type: 'role',
      code,
      name: roleNames[code],
      description: `Rôle système ${roleNames[code]}`,
      permissions: ROLE_PERMISSIONS[code],
      createdAt: now,
      updatedAt: now,
    });
  }

  // Delete previous demo data if present so reset is idempotent
  await repository.deleteAllDemoData();

  const demoPassHash = await hashPassword('CardioDemo2026!');

  // 2. Create 3 fictional staff demo accounts + 1 fictional patient portal account
  const adminUser = await repository.createUser({
    email: 'admin.demo@cardio-erp.test',
    username: 'admin.demo',
    firstName: 'Hervé [Démo]',
    lastName: 'KOUAM',
    title: 'M.',
    specialty: 'Administration',
    phone: '+237 600 00 00 01',
    roles: ['ADMIN'],
    isActive: true,
    isDemo: true,
    passwordHash: demoPassHash,
    createdAt: now,
    updatedAt: now,
  });

  const doctorUser = await repository.createUser({
    email: 'medecin.demo@cardio-erp.test',
    username: 'medecin.demo',
    firstName: 'Paulin [Démo]',
    lastName: 'MBAPPE',
    title: 'Dr',
    specialty: 'Cardiologie',
    phone: '+237 600 00 00 02',
    roles: ['MEDECIN', 'ADMIN'],
    isActive: true,
    isDemo: true,
    passwordHash: demoPassHash,
    createdAt: now,
    updatedAt: now,
  });

  const accueilUser = await repository.createUser({
    email: 'accueil.demo@cardio-erp.test',
    username: 'accueil.demo',
    firstName: 'Clarisse [Démo]',
    lastName: 'NGONO',
    title: 'Mme',
    specialty: 'Accueil & Secrétariat',
    phone: '+237 600 00 00 03',
    roles: ['ACCUEIL'],
    isActive: true,
    isDemo: true,
    passwordHash: demoPassHash,
    createdAt: now,
    updatedAt: now,
  });

  // 3. Create 5 fictional patients
  const patientsPayload = [
    {
      patientNumber: 'PAT-00001',
      firstName: 'Jean-Baptiste [Démo]',
      lastName: 'NDONGO',
      gender: 'M' as const,
      birthDate: '1968-04-12',
      phone: '+237 600 11 22 01',
      email: 'patient.demo@cardio-erp.test',
      address: 'Quartier Fictif 1, Douala',
      profession: 'Comptable',
      emergencyContactName: 'Marie NDONGO [Démo]',
      emergencyContactPhone: '+237 600 11 22 91',
      bloodGroup: 'O+',
      medicalAlerts: ['HTA suivie', 'Allergie pénicilline'],
    },
    {
      patientNumber: 'PAT-00002',
      firstName: 'Solange [Démo]',
      lastName: 'MBOUOMBOUO',
      gender: 'F' as const,
      birthDate: '1975-09-23',
      phone: '+237 600 11 22 02',
      email: 'solange.demo@cardio-erp.test',
      address: 'Quartier Fictif 2, Douala',
      profession: 'Enseignante',
      emergencyContactName: 'Paul MBOUOMBOUO [Démo]',
      emergencyContactPhone: '+237 600 11 22 92',
      bloodGroup: 'A+',
      medicalAlerts: ['Arythmie à explorer'],
    },
    {
      patientNumber: 'PAT-00003',
      firstName: 'Armand [Démo]',
      lastName: 'FOTSO',
      gender: 'M' as const,
      birthDate: '1959-11-03',
      phone: '+237 600 11 22 03',
      email: 'armand.demo@cardio-erp.test',
      address: 'Quartier Fictif 3, Douala',
      profession: 'Retraité',
      emergencyContactName: 'Céline FOTSO [Démo]',
      emergencyContactPhone: '+237 600 11 22 93',
      bloodGroup: 'B+',
      medicalAlerts: ['Diabète type 2', 'Anticoagulant'],
    },
    {
      patientNumber: 'PAT-00004',
      firstName: 'Nadine [Démo]',
      lastName: 'EKWALA',
      gender: 'F' as const,
      birthDate: '1984-02-17',
      phone: '+237 600 11 22 04',
      email: 'nadine.demo@cardio-erp.test',
      address: 'Quartier Fictif 4, Douala',
      profession: 'Architecte',
      emergencyContactName: 'Luc EKWALA [Démo]',
      emergencyContactPhone: '+237 600 11 22 94',
      bloodGroup: 'AB+',
      medicalAlerts: [],
    },
    {
      patientNumber: 'PAT-00005',
      firstName: 'Samuel [Démo]',
      lastName: 'TCHATCHOUANG',
      gender: 'M' as const,
      birthDate: '1963-07-29',
      phone: '+237 600 11 22 05',
      email: 'samuel.demo@cardio-erp.test',
      address: 'Quartier Fictif 5, Douala',
      profession: 'Commerçant',
      emergencyContactName: 'Esther TCHATCHOUANG [Démo]',
      emergencyContactPhone: '+237 600 11 22 95',
      bloodGroup: 'O-',
      medicalAlerts: ['Dyspnée effort'],
    },
  ];

  const createdPatients = [];
  for (const p of patientsPayload) {
    const created = await repository.createPatient({
      ...p,
      status: 'ACTIF',
      portalInvited: p.patientNumber === 'PAT-00001',
      portalActivated: p.patientNumber === 'PAT-00001',
      isDemo: true,
      createdById: accueilUser._id,
      createdAt: now,
      updatedAt: now,
    });
    createdPatients.push(created);

    await repository.upsertMedicalRecord(created._id, {
      summary: 'Dossier fictif de démonstration pour évaluation du flux cardiologique.',
      riskFactors: p.medicalAlerts,
      primaryDoctorId: doctorUser._id,
      isDemo: true,
    });
  }

  // Create patient portal demo user linked to PAT-00001
  await repository.createUser({
    email: 'patient.demo@cardio-erp.test',
    username: 'patient.demo',
    firstName: 'Jean-Baptiste [Démo]',
    lastName: 'NDONGO',
    title: 'M.',
    phone: '+237 600 11 22 01',
    roles: ['PATIENT'],
    patientId: createdPatients[0]._id,
    isActive: true,
    isDemo: true,
    passwordHash: demoPassHash,
    createdAt: now,
    updatedAt: now,
  });

  // Medical histories, allergies, medications for PAT-00001
  await repository.createMedicalHistory({
    patientId: createdPatients[0]._id,
    category: 'CARDIOVASCULAIRE',
    title: 'Hypertension artérielle essentielle (Démo)',
    details: 'Suivie depuis 2019 sous bithérapie.',
    diagnosedYear: '2019',
    authorId: doctorUser._id,
    isDemo: true,
    createdAt: now,
    updatedAt: now,
  });
  await repository.createAllergy({
    patientId: createdPatients[0]._id,
    allergen: 'Pénicilline (Démo)',
    reaction: 'Urticaire généralisée',
    severity: 'MODEREE',
    authorId: doctorUser._id,
    isDemo: true,
    createdAt: now,
    updatedAt: now,
  });
  await repository.createMedication({
    patientId: createdPatients[0]._id,
    name: 'Amlodipine (Démo)',
    dosage: '10 mg',
    frequency: '1 comprimé le matin',
    startDate: twoDaysAgo,
    active: true,
    prescribedById: doctorUser._id,
    notes: 'Surveillance tensionnelle',
    isDemo: true,
    createdAt: now,
    updatedAt: now,
  });

  // 4. Create 5 appointments (including today's active queue)
  const appointmentsPayload = [
    {
      patientId: createdPatients[0]._id,
      date: today,
      startTime: '09:00',
      endTime: '09:30',
      type: 'CONSULTATION_CONTROLE' as const,
      status: 'EN_ATTENTE_CONSULTATION' as const,
      reason: 'Contrôle tensionnel trimestriel [Démo]',
      adminPriority: 'NORMALE' as const,
      queueNumber: 1,
      arrivedAt: `${today}T08:48:00.000Z`,
    },
    {
      patientId: createdPatients[1]._id,
      date: today,
      startTime: '09:45',
      endTime: '10:30',
      type: 'ECHOCARDIOGRAPHIE_DOPPLER' as const,
      status: 'PATIENT_ARRIVE' as const,
      reason: 'Bilan palpitations [Démo]',
      adminPriority: 'PRIORITAIRE' as const,
      queueNumber: 2,
      arrivedAt: `${today}T09:32:00.000Z`,
    },
    {
      patientId: createdPatients[2]._id,
      date: today,
      startTime: '11:00',
      endTime: '11:30',
      type: 'ECG' as const,
      status: 'CONFIRME' as const,
      reason: 'ECG de contrôle [Démo]',
      adminPriority: 'NORMALE' as const,
    },
    {
      patientId: createdPatients[3]._id,
      date: tomorrow,
      startTime: '10:00',
      endTime: '10:30',
      type: 'PREMIERE_CONSULTATION' as const,
      status: 'EN_ATTENTE' as const,
      reason: 'Bilan cardiovasculaire préventif [Démo]',
      adminPriority: 'NORMALE' as const,
    },
    {
      patientId: createdPatients[4]._id,
      date: inThreeDays,
      startTime: '14:30',
      endTime: '15:15',
      type: 'HOLTER_ECG' as const,
      status: 'CONFIRME' as const,
      reason: 'Exploration vertiges [Démo]',
      adminPriority: 'URGENCE_A_VALIDER' as const,
      urgencyValidatedByHealthPro: false,
    },
  ];

  const createdAppts = [];
  for (const a of appointmentsPayload) {
    createdAppts.push(
      await repository.createAppointment({
        ...a,
        doctorId: doctorUser._id,
        isDemo: true,
        createdById: accueilUser._id,
        createdAt: now,
        updatedAt: now,
      })
    );
  }

  // 5. Create 3 consultations
  const c1 = await repository.createConsultation({
    patientId: createdPatients[0]._id,
    doctorId: doctorUser._id,
    date: twoDaysAgo,
    time: '10:15',
    reason: 'Contrôle HTA [Démo]',
    illnessHistory: 'Patient suivi pour HTA, bonne observance thérapeutique.',
    symptoms: 'Céphalées matinales légères occasionnelles.',
    relevantHistory: 'HTA essentielle diagnostiquée en 2019.',
    clinicalExam: 'Auscultation cardiaque régulière B1 B2 bien perçus, sans souffle.',
    vitals: {
      systolicBP: 138,
      diastolicBP: 86,
      heartRate: 74,
      temperature: 36.8,
      oxygenSaturation: 98,
      weight: 82,
      height: 176,
      bmi: 26.5,
      respiratoryRate: 16,
    },
    observations: 'Tension artérielle en amélioration par rapport au bilan précédent.',
    diagnosticHypotheses: 'HTA stabilisée',
    confirmedDiagnosis: 'Hypertension artérielle contrôlée [Démo]',
    prescribedExams: ['ECG'],
    treatmentsText: 'Poursuite Amlodipine 10 mg 1x/j',
    prescriptionLines: [
      {
        medication: 'Amlodipine [Démo]',
        dosage: '10 mg',
        frequency: '1 comprimé le matin',
        duration: '3 mois',
        instructions: 'Mesures tensionnelles hebdomadaires',
      },
    ],
    recommendations: 'Réduire apports sodés, activité physique régulière 30 min/j.',
    nextControlDate: isoDateOffset(30),
    status: 'VALIDEE',
    validatedAt: now,
    validatedById: doctorUser._id,
    isDemo: true,
    createdAt: now,
    updatedAt: now,
  });

  await repository.createVitalSigns({
    patientId: createdPatients[0]._id,
    consultationId: c1._id,
    ...c1.vitals,
    recordedById: doctorUser._id,
    recordedAt: now,
    isDemo: true,
    createdAt: now,
    updatedAt: now,
  });

  const c2 = await repository.createConsultation({
    patientId: createdPatients[1]._id,
    doctorId: doctorUser._id,
    date: yesterday,
    time: '15:00',
    reason: 'Palpitations récentes [Démo]',
    symptoms: 'Épisodes de tachycardie brève au repos.',
    clinicalExam: 'Rythme régulier lors de la consultation.',
    vitals: {
      systolicBP: 124,
      diastolicBP: 78,
      heartRate: 88,
      temperature: 36.7,
      oxygenSaturation: 99,
      weight: 68,
      height: 165,
      bmi: 25.0,
      respiratoryRate: 17,
    },
    diagnosticHypotheses: 'Extrasystolie bénigne vs trouble du rythme paroxystique',
    prescribedExams: ['ECG', 'HOLTER_ECG'],
    recommendations: 'Éviter excitants (caféine) en attendant le Holter.',
    status: 'VALIDEE',
    validatedAt: now,
    validatedById: doctorUser._id,
    isDemo: true,
    createdAt: now,
    updatedAt: now,
  });

  await repository.createConsultation({
    patientId: createdPatients[2]._id,
    doctorId: doctorUser._id,
    date: today,
    time: '08:30',
    reason: 'Bilan cardiovasculaire annuel [Démo]',
    symptoms: 'Fatigue modérée à la marche rapide.',
    clinicalExam: 'Examen clinique en cours de rédaction.',
    vitals: {
      systolicBP: 146,
      diastolicBP: 90,
      heartRate: 79,
      temperature: 36.9,
      oxygenSaturation: 97,
      weight: 85,
      height: 173,
      bmi: 28.4,
      respiratoryRate: 18,
    },
    status: 'BROUILLON',
    isDemo: true,
    createdAt: now,
    updatedAt: now,
  });

  // 6. Create 5 examinations
  const examsPayload = [
    {
      examNumber: 'EXM-00001',
      patientId: createdPatients[0]._id,
      consultationId: c1._id,
      type: 'ECG' as const,
      prescriptionDate: twoDaysAgo,
      scheduledDate: twoDaysAgo,
      performedDate: twoDaysAgo,
      operatorName: 'Cabinet Paris 16 [Démo]',
      resultSummary: 'Rythme sinusal régulier à 72 bpm, pas de trouble de repolarisation [Démo].',
      reportText: 'Tracé ECG 12 dérivations normal pour l’âge. Espace PR 160 ms, QRS fin.',
      interpretingDoctorId: doctorUser._id,
      validatedAt: now,
      sharedWithPatient: true,
      status: 'VALIDE' as const,
    },
    {
      examNumber: 'EXM-00002',
      patientId: createdPatients[1]._id,
      consultationId: c2._id,
      type: 'HOLTER_ECG' as const,
      prescriptionDate: yesterday,
      scheduledDate: yesterday,
      performedDate: today,
      operatorName: 'Technicien Exploration [Démo]',
      technicalNotes: 'Enregistrement 24h complet exploitable.',
      resultSummary: 'Quelques extrasystoles supraventriculaires isolées.',
      status: 'A_INTERPRETER' as const,
      sharedWithPatient: false,
    },
    {
      examNumber: 'EXM-00003',
      patientId: createdPatients[2]._id,
      type: 'HOLTER_MAPA' as const,
      prescriptionDate: yesterday,
      scheduledDate: today,
      status: 'RESULTAT_DISPONIBLE' as const,
      resultSummary: 'Profil tensionnel sur 24h disponible pour lecture médicale.',
      sharedWithPatient: false,
    },
    {
      examNumber: 'EXM-00004',
      patientId: createdPatients[3]._id,
      type: 'ECHOCARDIOGRAPHIE_DOPPLER' as const,
      prescriptionDate: today,
      scheduledDate: tomorrow,
      status: 'PROGRAMME' as const,
      sharedWithPatient: false,
    },
    {
      examNumber: 'EXM-00005',
      patientId: createdPatients[4]._id,
      type: 'EPREUVE_EFFORT' as const,
      prescriptionDate: today,
      status: 'PRESCRIT' as const,
      sharedWithPatient: false,
    },
  ];

  const createdExams = [];
  for (const ex of examsPayload) {
    createdExams.push(
      await repository.createExamination({
        ...ex,
        prescribingDoctorId: doctorUser._id,
        isDemo: true,
        createdAt: now,
        updatedAt: now,
      })
    );
  }

  // 7. Create 4 follow-ups (overdue, today, upcoming, completed)
  await repository.createFollowUp({
    patientId: createdPatients[2]._id,
    type: 'APPEL_TELEPHONIQUE',
    reason: 'Vérifier tolérance traitement et confirmer pose MAPA [Démo]',
    dueDate: yesterday,
    assigneeId: accueilUser._id,
    priority: 'HAUTE',
    status: 'A_EFFECTUER',
    notes: 'Rappel prioritaire non encore effectué.',
    nextAction: 'Appeler le patient ce matin',
    history: [{ at: now, byId: doctorUser._id, byName: 'Dr Paulin MBAPPE [Démo]', action: 'Suivi programmé' }],
    isDemo: true,
    createdById: doctorUser._id,
    createdAt: now,
    updatedAt: now,
  });

  await repository.createFollowUp({
    patientId: createdPatients[1]._id,
    examinationId: createdExams[1]._id,
    type: 'RESULTAT_EXAMEN',
    reason: 'Communiquer compte rendu Holter ECG après validation médicale [Démo]',
    dueDate: today,
    assigneeId: doctorUser._id,
    priority: 'CRITIQUE',
    status: 'EN_COURS',
    nextAction: 'Valider le tracé puis programmer entretien',
    history: [{ at: now, byId: doctorUser._id, byName: 'Dr Paulin MBAPPE [Démo]', action: 'Création du suivi' }],
    isDemo: true,
    createdById: doctorUser._id,
    createdAt: now,
    updatedAt: now,
  });

  await repository.createFollowUp({
    patientId: createdPatients[4]._id,
    type: 'EXAMEN_COMPLEMENTAIRE',
    reason: "Programmer date d'épreuve d'effort avec le patient [Démo]",
    dueDate: tomorrow,
    assigneeId: accueilUser._id,
    priority: 'NORMALE',
    status: 'A_EFFECTUER',
    history: [{ at: now, byId: accueilUser._id, byName: 'Mme Clarisse NGONO [Démo]', action: 'Suivi créé' }],
    isDemo: true,
    createdById: doctorUser._id,
    createdAt: now,
    updatedAt: now,
  });

  await repository.createFollowUp({
    patientId: createdPatients[0]._id,
    consultationId: c1._id,
    type: 'CONTROLE_MEDICAL',
    reason: 'Contrôle tensionnel et remise ordonnance [Démo]',
    dueDate: twoDaysAgo,
    assigneeId: accueilUser._id,
    priority: 'NORMALE',
    status: 'TERMINE',
    contactOutcome: 'Patient joint, RDV confirmé.',
    closedAt: now,
    closedById: accueilUser._id,
    history: [{ at: now, byId: accueilUser._id, byName: 'Mme Clarisse NGONO [Démo]', action: 'Clôturé après appel' }],
    isDemo: true,
    createdById: doctorUser._id,
    createdAt: now,
    updatedAt: now,
  });

  // 8. Create 5 tasks
  const tasksPayload = [
    {
      title: 'Confirmer les rendez-vous de demain par téléphone [Démo]',
      description: 'Contacter les 3 patients programmés demain matin.',
      category: 'ACCUEIL' as const,
      assigneeId: accueilUser._id,
      dueDate: today,
      priority: 'HAUTE' as const,
      status: 'A_FAIRE' as const,
    },
    {
      title: 'Interpréter le Holter ECG EXM-00002 [Démo]',
      description: 'Tracé disponible pour validation finale.',
      category: 'EXAMENS' as const,
      patientId: createdPatients[1]._id,
      assigneeId: doctorUser._id,
      dueDate: today,
      priority: 'CRITIQUE' as const,
      status: 'EN_COURS' as const,
    },
    {
      title: 'Configurer les tarifs officiels des prestations en FCFA [Démo]',
      description: 'Renseigner la grille tarifaire du cabinet dans Administration.',
      category: 'ADMINISTRATION' as const,
      assigneeId: adminUser._id,
      dueDate: tomorrow,
      priority: 'NORMALE' as const,
      status: 'A_FAIRE' as const,
    },
    {
      title: 'Relancer patient Armand FOTSO (suivi en retard) [Démo]',
      description: 'Suivi téléphonique prévu hier.',
      category: 'SUIVI' as const,
      patientId: createdPatients[2]._id,
      assigneeId: accueilUser._id,
      dueDate: yesterday,
      priority: 'HAUTE' as const,
      status: 'EN_ATTENTE' as const,
    },
    {
      title: 'Archiver les dossiers antérieurs vérifiés [Démo]',
      description: 'Contrôle mensuel des documents numérisés.',
      category: 'DOCUMENTS' as const,
      assigneeId: accueilUser._id,
      dueDate: twoDaysAgo,
      priority: 'BASSE' as const,
      status: 'TERMINEE' as const,
    },
  ];

  for (const t of tasksPayload) {
    await repository.createTask({
      ...t,
      history: [{ at: now, byName: actorName, action: 'Tâche créée (Démo)' }],
      isDemo: true,
      createdById: adminUser._id,
      createdAt: now,
      updatedAt: now,
    });
  }

  // 9. Create standard clinic services (prices left null to be configured by Admin — never invented)
  const servicesList = [
    { code: 'SRV-CONS', name: 'Consultation cardiologique', category: 'CONSULTATION' as const },
    { code: 'SRV-ECG', name: 'Électrocardiogramme (ECG)', category: 'ECG' as const },
    { code: 'SRV-HOLTER', name: 'Holter ECG 24h/48h', category: 'HOLTER_ECG' as const },
    { code: 'SRV-MAPA', name: 'Holter tensionnel (MAPA)', category: 'MAPA' as const },
    { code: 'SRV-ECHO', name: 'Échocardiographie Doppler', category: 'ECHOCARDIOGRAPHIE' as const },
    { code: 'SRV-ETO', name: 'Échographie trans-œsophagienne', category: 'ECHOCARDIOGRAPHIE_TRANS_OESOPHAGIENNE' as const },
    { code: 'SRV-VASC', name: 'Écho-Doppler vasculaire', category: 'ECHO_DOPPLER' as const },
    { code: 'SRV-EFF', name: "Épreuve d'effort", category: 'EPREUVE_EFFORT' as const },
    { code: 'SRV-POLY', name: 'Polygraphie ventilatoire', category: 'POLYGRAPHIE_VENTILATOIRE' as const },
  ];
  for (const s of servicesList) {
    await repository.createService({
      ...s,
      priceFcfa: null,
      active: true,
      description: 'Tarif en FCFA à renseigner par l’administrateur du cabinet.',
      isDemo: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  // 10. Create initial internal notifications
  await repository.createNotification({
    recipientRoles: ['MEDECIN'],
    eventType: 'EXAMEN_A_INTERPRETER',
    title: 'Examen EXM-00002 à interpréter',
    message: 'Le Holter ECG de Solange MBOUOMBOUO [Démo] est prêt pour interprétation médicale.',
    linkModule: 'examinations',
    relatedEntityId: createdExams[1]._id,
    readByUserIds: [],
    channel: 'INTERNE',
    isDemo: true,
    createdAt: now,
  });

  await repository.createNotification({
    recipientRoles: ['ACCUEIL', 'MEDECIN'],
    eventType: 'PATIENT_ARRIVE',
    title: 'Patient arrivé en salle d’attente',
    message: 'Solange MBOUOMBOUO [Démo] est arrivée pour son échocardiographie Doppler.',
    linkModule: 'queue',
    relatedEntityId: createdAppts[1]._id,
    readByUserIds: [],
    channel: 'INTERNE',
    isDemo: true,
    createdAt: now,
  });

  return {
    createdCounts: {
      users: 4,
      patients: 5,
      appointments: 5,
      consultations: 3,
      examinations: 5,
      followUps: 4,
      tasks: 5,
      services: 9,
    },
  };
}
