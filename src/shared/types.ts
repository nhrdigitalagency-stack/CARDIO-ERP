export type RoleCode = 'ADMIN' | 'MEDECIN' | 'ACCUEIL' | 'PATIENT';

export type Permission =
  | 'users:manage'
  | 'settings:manage'
  | 'audit:read'
  | 'services:manage'
  | 'payments:read'
  | 'payments:write'
  | 'patients:read_admin'
  | 'patients:write_admin'
  | 'patients:archive'
  | 'medical:read'
  | 'medical:write'
  | 'consultations:read'
  | 'consultations:write'
  | 'consultations:validate'
  | 'examinations:read'
  | 'examinations:prescribe'
  | 'examinations:operate'
  | 'examinations:validate'
  | 'appointments:read'
  | 'appointments:write'
  | 'queue:manage'
  | 'followups:read'
  | 'followups:write_admin'
  | 'followups:write_medical'
  | 'tasks:read'
  | 'tasks:write'
  | 'documents:read_admin'
  | 'documents:read_medical'
  | 'documents:write'
  | 'statistics:read_medical'
  | 'statistics:read_admin'
  | 'portal:access';

export interface User {
  _id: string;
  _type: 'user';
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  title?: string; // e.g., "Dr", "Mme", "M."
  specialty?: string;
  phone?: string;
  roles: RoleCode[];
  isActive: boolean;
  isDemo?: boolean;
  patientId?: string; // Linked patient._id when role includes PATIENT
  passwordHash?: string; // Never serialized to frontend
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type PublicUser = Omit<User, 'passwordHash'>;

export interface RoleDefinition {
  _id: string;
  _type: 'role';
  code: RoleCode;
  name: string;
  description: string;
  permissions: Permission[];
  createdAt: string;
  updatedAt: string;
}

export type PatientStatus = 'ACTIF' | 'ARCHIVE';
export type Gender = 'M' | 'F';

export interface Patient {
  _id: string;
  _type: 'patient';
  patientNumber: string; // PAT-00001
  firstName: string;
  lastName: string;
  gender: Gender;
  birthDate: string; // YYYY-MM-DD
  phone: string;
  email?: string;
  address?: string;
  profession?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  bloodGroup?: string;
  medicalAlerts?: string[]; // Non-diagnostic high-level alert tags visible in header for clinical safety
  status: PatientStatus;
  portalInvited?: boolean;
  portalActivated?: boolean;
  isDemo?: boolean;
  createdById?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MedicalRecord {
  _id: string;
  _type: 'medicalRecord';
  patientId: string;
  summary?: string;
  riskFactors?: string[];
  primaryDoctorId?: string;
  lastConsultationAt?: string;
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MedicalHistoryItem {
  _id: string;
  _type: 'medicalHistory';
  patientId: string;
  category: 'CARDIOVASCULAIRE' | 'CHIRURGICAL' | 'FAMILIAL' | 'AUTRE';
  title: string;
  details?: string;
  diagnosedYear?: string;
  authorId: string;
  authorName?: string;
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Allergy {
  _id: string;
  _type: 'allergy';
  patientId: string;
  allergen: string;
  reaction?: string;
  severity: 'LEGERE' | 'MODEREE' | 'SEVERE';
  authorId: string;
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Medication {
  _id: string;
  _type: 'medication';
  patientId: string;
  name: string;
  dosage: string;
  frequency: string;
  startDate?: string;
  endDate?: string;
  active: boolean;
  prescribedById?: string;
  notes?: string;
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type AppointmentType =
  | 'PREMIERE_CONSULTATION'
  | 'CONSULTATION_SUIVI'
  | 'CONSULTATION_CONTROLE'
  | 'CONSULTATION_URGENTE'
  | 'ECG'
  | 'HOLTER_ECG'
  | 'MAPA'
  | 'ECHOCARDIOGRAPHIE_DOPPLER'
  | 'ECHOGRAPHIE_TRANS_OESOPHAGIENNE'
  | 'ECHO_DOPPLER_VASCULAIRE'
  | 'EPREUVE_EFFORT'
  | 'POLYGRAPHIE_VENTILATOIRE';

export type AppointmentStatus =
  | 'EN_ATTENTE'
  | 'CONFIRME'
  | 'PATIENT_ARRIVE'
  | 'EN_ATTENTE_CONSULTATION'
  | 'EN_CONSULTATION'
  | 'TERMINE'
  | 'ANNULE'
  | 'ABSENT';

export type AdminPriority = 'NORMALE' | 'PRIORITAIRE' | 'URGENCE_A_VALIDER';

export interface Appointment {
  _id: string;
  _type: 'appointment';
  patientId: string;
  patientName?: string;
  patientNumber?: string;
  doctorId: string;
  doctorName?: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  type: AppointmentType;
  status: AppointmentStatus;
  reason: string;
  adminPriority: AdminPriority;
  urgencyValidatedByHealthPro?: boolean;
  urgencyValidatedById?: string;
  urgencyValidatedAt?: string;
  queueNumber?: number;
  arrivedAt?: string;
  consultationStartedAt?: string;
  consultationEndedAt?: string;
  requestedByPatient?: boolean;
  notes?: string;
  isDemo?: boolean;
  createdById?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VitalSignsData {
  systolicBP?: number;
  diastolicBP?: number;
  heartRate?: number;
  temperature?: number;
  oxygenSaturation?: number;
  weight?: number;
  height?: number; // cm
  bmi?: number;
  respiratoryRate?: number;
}

export interface VitalSigns extends VitalSignsData {
  _id: string;
  _type: 'vitalSigns';
  patientId: string;
  consultationId?: string;
  recordedById: string;
  recordedAt: string;
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DiagnosisItem {
  _id: string;
  _type: 'diagnosis';
  patientId: string;
  consultationId: string;
  code?: string;
  label: string;
  type: 'HYPOTHESE' | 'RETENU';
  authorId: string;
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PrescriptionLine {
  medication: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions?: string;
}

export interface Prescription {
  _id: string;
  _type: 'prescription';
  patientId: string;
  consultationId?: string;
  doctorId: string;
  doctorName?: string;
  date: string;
  lines: PrescriptionLine[];
  notes?: string;
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConsultationCorrection {
  correctedAt: string;
  correctedById: string;
  correctedByName: string;
  reason: string;
  changesSummary: string;
}

export interface Consultation {
  _id: string;
  _type: 'consultation';
  patientId: string;
  patientName?: string;
  patientNumber?: string;
  doctorId: string;
  doctorName?: string;
  appointmentId?: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  reason: string;
  illnessHistory?: string;
  symptoms?: string;
  relevantHistory?: string;
  clinicalExam?: string;
  vitals: VitalSignsData;
  observations?: string;
  diagnosticHypotheses?: string;
  confirmedDiagnosis?: string;
  prescribedExams?: ExaminationType[];
  treatmentsText?: string;
  prescriptionLines?: PrescriptionLine[];
  recommendations?: string;
  nextControlDate?: string;
  status: 'BROUILLON' | 'VALIDEE';
  validatedAt?: string;
  validatedById?: string;
  corrections?: ConsultationCorrection[];
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ExaminationType =
  | 'ECG'
  | 'HOLTER_ECG'
  | 'HOLTER_MAPA'
  | 'ECHOCARDIOGRAPHIE_DOPPLER'
  | 'ECHOGRAPHIE_TRANS_OESOPHAGIENNE'
  | 'ECHO_DOPPLER_VASCULAIRE'
  | 'EPREUVE_EFFORT'
  | 'POLYGRAPHIE_VENTILATOIRE';

export type ExaminationStatus =
  | 'PRESCRIT'
  | 'PROGRAMME'
  | 'EN_COURS'
  | 'REALISE'
  | 'RESULTAT_DISPONIBLE'
  | 'A_INTERPRETER'
  | 'VALIDE'
  | 'ANNULE';

export interface Examination {
  _id: string;
  _type: 'examination';
  examNumber: string; // EXM-00001
  patientId: string;
  patientName?: string;
  patientNumber?: string;
  prescribingDoctorId: string;
  prescribingDoctorName?: string;
  consultationId?: string;
  prescriptionDate: string;
  type: ExaminationType;
  scheduledDate?: string;
  performedDate?: string;
  operatorName?: string;
  technicalNotes?: string;
  attachedDocumentId?: string;
  attachedFileName?: string;
  resultSummary?: string;
  reportText?: string;
  interpretingDoctorId?: string;
  interpretingDoctorName?: string;
  validatedAt?: string;
  sharedWithPatient?: boolean;
  status: ExaminationStatus;
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExaminationResult {
  _id: string;
  _type: 'examinationResult';
  examinationId: string;
  patientId: string;
  measurements?: Record<string, string | number>;
  conclusion: string;
  reportText: string;
  interpretingDoctorId: string;
  validated: boolean;
  validatedAt?: string;
  sharedWithPatient: boolean;
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type DocumentCategory =
  | 'COMPTE_RENDU'
  | 'RESULTAT_ECG'
  | 'RESULTAT_HOLTER'
  | 'RESULTAT_MAPA'
  | 'RESULTAT_ECHOGRAPHIQUE'
  | 'PRESCRIPTION'
  | 'ORDONNANCE'
  | 'COURRIER_MEDICAL'
  | 'AUTRE';

export interface MedicalDocument {
  _id: string;
  _type: 'medicalDocument';
  title: string;
  category: DocumentCategory;
  patientId: string;
  patientName?: string;
  consultationId?: string;
  examinationId?: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string; // Stored on private server storage, never a public URL
  sharedWithPatient: boolean;
  archived: boolean;
  uploadedById: string;
  uploadedByName?: string;
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type FollowUpType =
  | 'APPEL_TELEPHONIQUE'
  | 'CONTROLE_MEDICAL'
  | 'RESULTAT_EXAMEN'
  | 'EXAMEN_COMPLEMENTAIRE'
  | 'SURVEILLANCE'
  | 'RENDEZ_VOUS_SUIVI'
  | 'RELANCE_ADMINISTRATIVE';

export type FollowUpStatus =
  | 'A_EFFECTUER'
  | 'EN_COURS'
  | 'PATIENT_CONTACTE'
  | 'PATIENT_INJOIGNABLE'
  | 'REPORTE'
  | 'TERMINE'
  | 'ANNULE';

export type PriorityLevel = 'BASSE' | 'NORMALE' | 'HAUTE' | 'CRITIQUE';

export interface FollowUpHistoryEntry {
  at: string;
  byId: string;
  byName: string;
  action: string;
  note?: string;
}

export interface FollowUp {
  _id: string;
  _type: 'followUp';
  patientId: string;
  patientName?: string;
  patientNumber?: string;
  patientPhone?: string;
  consultationId?: string;
  examinationId?: string;
  type: FollowUpType;
  reason: string;
  dueDate: string; // YYYY-MM-DD
  assigneeId: string;
  assigneeName?: string;
  priority: PriorityLevel;
  status: FollowUpStatus;
  contactOutcome?: string;
  notes?: string;
  nextAction?: string;
  closedAt?: string;
  closedById?: string;
  history: FollowUpHistoryEntry[];
  isDemo?: boolean;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export type TaskCategory =
  | 'ACCUEIL'
  | 'ADMINISTRATION'
  | 'CONSULTATION'
  | 'EXAMENS'
  | 'SUIVI'
  | 'DOCUMENTS'
  | 'AUTRES';

export type TaskStatus = 'A_FAIRE' | 'EN_COURS' | 'EN_ATTENTE' | 'TERMINEE' | 'ANNULEE';

export interface Task {
  _id: string;
  _type: 'task';
  title: string;
  description?: string;
  category: TaskCategory;
  patientId?: string;
  patientName?: string;
  assigneeId: string;
  assigneeName?: string;
  dueDate: string;
  priority: PriorityLevel;
  status: TaskStatus;
  history: Array<{ at: string; byName: string; action: string }>;
  isDemo?: boolean;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export type NotificationEventType =
  | 'NOUVEAU_RDV'
  | 'RDV_CONFIRME'
  | 'PATIENT_ARRIVE'
  | 'RESULTAT_DISPONIBLE'
  | 'EXAMEN_A_INTERPRETER'
  | 'SUIVI_A_EFFECTUER'
  | 'TACHE_EN_RETARD'
  | 'CONTROLE_A_PROGRAMMER'
  | 'URGENCE_SIGNALEE';

export interface NotificationItem {
  _id: string;
  _type: 'notification';
  recipientUserId?: string;
  recipientRoles?: RoleCode[];
  eventType: NotificationEventType;
  title: string;
  message: string;
  linkModule?: string;
  relatedEntityId?: string;
  readByUserIds: string[];
  channel: 'INTERNE' | 'SMS' | 'WHATSAPP' | 'EMAIL';
  isDemo?: boolean;
  createdAt: string;
}

export interface MedicalService {
  _id: string;
  _type: 'service';
  code: string;
  name: string;
  category:
    | 'CONSULTATION'
    | 'ECG'
    | 'HOLTER_ECG'
    | 'MAPA'
    | 'ECHOCARDIOGRAPHIE'
    | 'ECHOCARDIOGRAPHIE_TRANS_OESOPHAGIENNE'
    | 'ECHO_DOPPLER'
    | 'EPREUVE_EFFORT'
    | 'POLYGRAPHIE_VENTILATOIRE';
  priceFcfa: number | null; // Null until configured by administrator — never invented
  active: boolean;
  description?: string;
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type PaymentStatus = 'PAYE' | 'PARTIEL' | 'IMPAYE' | 'ANNULE';
export type PaymentMethod = 'ESPECES' | 'MOBILE_MONEY' | 'CARTE' | 'VIREMENT' | 'CHEQUE' | 'ASSURANCE';

export interface Payment {
  _id: string;
  _type: 'payment';
  receiptNumber: string; // REC-00001
  patientId: string;
  patientName?: string;
  patientNumber?: string;
  serviceId?: string;
  serviceName: string;
  totalAmountFcfa: number;
  amountPaidFcfa: number;
  remainingBalanceFcfa: number;
  status: PaymentStatus;
  method: PaymentMethod;
  date: string; // YYYY-MM-DD
  notes?: string;
  recordedById: string;
  recordedByName?: string;
  isDemo?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  _id: string;
  _type: 'auditLog';
  actorUserId?: string;
  actorName: string;
  actorRoles: RoleCode[];
  action: string;
  resourceType: string;
  resourceId?: string;
  severity: 'INFO' | 'WARNING' | 'SECURITY';
  details: string;
  ipAddress?: string;
  createdAt: string; // Append-only
}

export interface EmailDispatchLog {
  _id: string;
  _type: 'emailDispatchLog';
  recipientEmail: string;
  recipientName?: string;
  subject: string;
  category:
    | 'RDV_CONFIRMATION'
    | 'RDV_RAPPEL_J1'
    | 'SUIVI_RELANCE'
    | 'EXAMEN_VALIDE'
    | 'PORTAIL_INVITATION'
    | 'TACHE_RETARD'
    | 'SECURITE'
    | 'TEST';
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  provider: 'RESEND' | 'WHATSAPP_CLOUD_API' | 'WHATSAPP_CALLMEBOT';
  providerMessageId?: string;
  errorMessage?: string;
  relatedEntityId?: string;
  patientId?: string;
  reminderKey?: string;
  createdAt: string;
}

export interface ClinicSettings {
  _id: string;
  _type: 'clinicSettings';
  clinicName: string;
  leadDoctorName: string;
  specialty: string;
  city: string;
  phone: string;
  email: string;
  address: string;
  slogan: string;
  logoStorageKey?: string;
  notificationChannels: {
    smsEnabled: boolean;
    smsProvider?: string;
    whatsappEnabled: boolean;
    whatsappBusinessNumber?: string;
    emailEnabled: boolean;
    senderEmail?: string;
    autoRemindersEnabled?: boolean;
    appointmentReminderHoursBefore?: number;
    neverSendSensitiveMedicalData: boolean;
  };
  archivingPolicyYears: number;
  updatedAt: string;
}

export interface SystemStatusResponse {
  supabaseConfigured: boolean;
  supabaseConnected: boolean;
  supabaseSchemaReady: boolean;
  supabaseError?: string;
  r2Configured: boolean;
  r2Connected: boolean;
  r2BucketName?: string;
  r2Error?: string;
  resendConfigured: boolean;
  resendFromEmail?: string;
  whatsappConfigured?: boolean;
  whatsappProvider?: 'cloud_api' | 'callmebot' | null;
  missingEnvVars: string[];
  sessionSecretConfigured: boolean;
  hasDemoData?: boolean;
  hasAnyUsers?: boolean;
  lastReminderRunAt?: string | null;
}
