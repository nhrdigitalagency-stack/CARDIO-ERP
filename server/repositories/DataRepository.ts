import type {
  Allergy,
  Appointment,
  AuditLog,
  ClinicSettings,
  Consultation,
  DiagnosisItem,
  EmailDispatchLog,
  Examination,
  ExaminationResult,
  FollowUp,
  MedicalDocument,
  MedicalHistoryItem,
  MedicalRecord,
  MedicalService,
  Medication,
  NotificationItem,
  Patient,
  Payment,
  Prescription,
  RoleDefinition,
  Task,
  User,
  VitalSigns,
} from '../../src/shared/types';

export interface PatientFilter {
  search?: string;
  status?: 'ACTIF' | 'ARCHIVE' | 'ALL';
  gender?: 'M' | 'F';
}

export interface AppointmentFilter {
  date?: string;
  startDate?: string;
  endDate?: string;
  doctorId?: string;
  patientId?: string;
  type?: string;
  status?: string;
}

export interface DataRepository {
  // Health & Bootstrap
  testConnection(): Promise<{ ok: boolean; schemaReady?: boolean; error?: string }>;
  hasAnyUsers(): Promise<boolean>;
  hasDemoData(): Promise<boolean>;
  deleteAllDemoData(): Promise<number>;

  // Users & Roles
  findUserByIdentifier(identifier: string): Promise<User | null>;
  findUserById(id: string): Promise<User | null>;
  listUsers(): Promise<User[]>;
  createUser(data: Omit<User, '_id' | '_type'>): Promise<User>;
  updateUser(id: string, patch: Partial<User>): Promise<User>;
  listRoles(): Promise<RoleDefinition[]>;
  upsertRole(role: RoleDefinition): Promise<RoleDefinition>;

  // Clinic Settings
  getClinicSettings(): Promise<ClinicSettings | null>;
  upsertClinicSettings(settings: Partial<ClinicSettings> & { updatedAt: string }): Promise<ClinicSettings>;

  // Patients & Medical Records
  listPatients(filter?: PatientFilter): Promise<Patient[]>;
  findPatientById(id: string): Promise<Patient | null>;
  findDuplicatePatients(lastName: string, birthDate: string, phone: string): Promise<Patient[]>;
  getNextPatientNumber(): Promise<string>;
  createPatient(data: Omit<Patient, '_id' | '_type'>): Promise<Patient>;
  updatePatient(id: string, patch: Partial<Patient>): Promise<Patient>;

  getMedicalRecordByPatient(patientId: string): Promise<MedicalRecord | null>;
  upsertMedicalRecord(patientId: string, data: Partial<MedicalRecord>): Promise<MedicalRecord>;

  listMedicalHistory(patientId: string): Promise<MedicalHistoryItem[]>;
  findMedicalHistoryById(id: string): Promise<MedicalHistoryItem | null>;
  createMedicalHistory(data: Omit<MedicalHistoryItem, '_id' | '_type'>): Promise<MedicalHistoryItem>;
  deleteMedicalHistory(id: string): Promise<void>;

  listAllergies(patientId: string): Promise<Allergy[]>;
  findAllergyById(id: string): Promise<Allergy | null>;
  createAllergy(data: Omit<Allergy, '_id' | '_type'>): Promise<Allergy>;
  deleteAllergy(id: string): Promise<void>;

  listMedications(patientId: string): Promise<Medication[]>;
  findMedicationById(id: string): Promise<Medication | null>;
  createMedication(data: Omit<Medication, '_id' | '_type'>): Promise<Medication>;
  updateMedication(id: string, patch: Partial<Medication>): Promise<Medication>;

  listVitalSigns(patientId: string): Promise<VitalSigns[]>;
  createVitalSigns(data: Omit<VitalSigns, '_id' | '_type'>): Promise<VitalSigns>;

  listDiagnoses(patientId: string): Promise<DiagnosisItem[]>;
  createDiagnosis(data: Omit<DiagnosisItem, '_id' | '_type'>): Promise<DiagnosisItem>;

  listPrescriptions(patientId: string): Promise<Prescription[]>;
  createPrescription(data: Omit<Prescription, '_id' | '_type'>): Promise<Prescription>;

  // Appointments & Queue
  listAppointments(filter?: AppointmentFilter): Promise<Appointment[]>;
  findAppointmentById(id: string): Promise<Appointment | null>;
  checkDoctorAvailability(doctorId: string, date: string, startTime: string, endTime: string, excludeId?: string): Promise<boolean>;
  getNextQueueNumber(date: string): Promise<number>;
  createAppointment(data: Omit<Appointment, '_id' | '_type'>): Promise<Appointment>;
  updateAppointment(id: string, patch: Partial<Appointment>): Promise<Appointment>;
  deleteAppointment(id: string): Promise<void>;

  // Consultations
  listConsultations(filter?: { patientId?: string; doctorId?: string }): Promise<Consultation[]>;
  findConsultationById(id: string): Promise<Consultation | null>;
  createConsultation(data: Omit<Consultation, '_id' | '_type'>): Promise<Consultation>;
  updateConsultation(id: string, patch: Partial<Consultation>): Promise<Consultation>;

  // Examinations & Results
  listExaminations(filter?: { patientId?: string; status?: string; type?: string }): Promise<Examination[]>;
  findExaminationById(id: string): Promise<Examination | null>;
  getNextExamNumber(): Promise<string>;
  createExamination(data: Omit<Examination, '_id' | '_type'>): Promise<Examination>;
  updateExamination(id: string, patch: Partial<Examination>): Promise<Examination>;
  createExaminationResult(data: Omit<ExaminationResult, '_id' | '_type'>): Promise<ExaminationResult>;
  listExaminationResults(patientId?: string): Promise<ExaminationResult[]>;

  // Follow-ups
  listFollowUps(filter?: { patientId?: string; assigneeId?: string; status?: string }): Promise<FollowUp[]>;
  findFollowUpById(id: string): Promise<FollowUp | null>;
  createFollowUp(data: Omit<FollowUp, '_id' | '_type'>): Promise<FollowUp>;
  updateFollowUp(id: string, patch: Partial<FollowUp>): Promise<FollowUp>;

  // Tasks
  listTasks(filter?: { assigneeId?: string; status?: string; category?: string }): Promise<Task[]>;
  findTaskById(id: string): Promise<Task | null>;
  createTask(data: Omit<Task, '_id' | '_type'>): Promise<Task>;
  updateTask(id: string, patch: Partial<Task>): Promise<Task>;

  // Documents
  listDocuments(filter?: { patientId?: string; category?: string; includeArchived?: boolean }): Promise<MedicalDocument[]>;
  findDocumentById(id: string): Promise<MedicalDocument | null>;
  createDocument(data: Omit<MedicalDocument, '_id' | '_type'>): Promise<MedicalDocument>;
  updateDocument(id: string, patch: Partial<MedicalDocument>): Promise<MedicalDocument>;

  // Notifications
  listNotifications(userId: string, roles: string[]): Promise<NotificationItem[]>;
  createNotification(data: Omit<NotificationItem, '_id' | '_type'>): Promise<NotificationItem>;
  markNotificationRead(id: string, userId: string): Promise<void>;
  markAllNotificationsRead(userId: string, roles: string[]): Promise<void>;

  // Email Dispatch Logs (Resend + Automated Reminders)
  listEmailDispatches(limit?: number): Promise<EmailDispatchLog[]>;
  createEmailDispatch(data: Omit<EmailDispatchLog, '_id' | '_type'>): Promise<EmailDispatchLog>;
  hasReminderBeenSent(reminderKey: string): Promise<boolean>;

  // Services & Payments
  listServices(): Promise<MedicalService[]>;
  findServiceById(id: string): Promise<MedicalService | null>;
  createService(data: Omit<MedicalService, '_id' | '_type'>): Promise<MedicalService>;
  updateService(id: string, patch: Partial<MedicalService>): Promise<MedicalService>;

  listPayments(filter?: { startDate?: string; endDate?: string; patientId?: string }): Promise<Payment[]>;
  findPaymentById(id: string): Promise<Payment | null>;
  getNextReceiptNumber(): Promise<string>;
  createPayment(data: Omit<Payment, '_id' | '_type'>): Promise<Payment>;
  updatePayment(id: string, patch: Partial<Payment>): Promise<Payment>;

  // Audit Logs (Append-Only)
  listAuditLogs(limit?: number): Promise<AuditLog[]>;
  listAllAuditLogs(severity?: string): Promise<AuditLog[]>;
  appendAuditLog(data: Omit<AuditLog, '_id' | '_type'>): Promise<AuditLog>;
}
