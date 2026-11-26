import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { getEnvConfig, isSupabaseConfigured } from '../config/env';
import { CLINIC_DEFAULTS } from '../../src/shared/constants';
import type { AppointmentFilter, DataRepository, PatientFilter } from './DataRepository';
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

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function fullPersonName(person: { title?: string; first_name?: string; last_name?: string } | null | undefined, fallback: string): string {
  if (!person) return fallback;
  const parts = [person.title, person.first_name, person.last_name].filter((s) => Boolean(s && s.trim()));
  return parts.length ? parts.join(' ').trim() : fallback;
}

function shortPersonName(person: { first_name?: string; last_name?: string } | null | undefined, fallback: string): string {
  if (!person) return fallback;
  const parts = [person.first_name, person.last_name].filter((s) => Boolean(s && s.trim()));
  return parts.length ? parts.join(' ').trim() : fallback;
}

function mapUser(r: any): User {
  return {
    _id: r.id,
    _type: 'user',
    email: r.email,
    username: r.username,
    firstName: r.first_name,
    lastName: r.last_name,
    title: r.title || '',
    specialty: r.specialty || '',
    phone: r.phone || '',
    roles: r.roles || [],
    isActive: Boolean(r.is_active),
    isDemo: Boolean(r.is_demo),
    patientId: r.patient_id || undefined,
    passwordHash: r.password_hash || undefined,
    lastLoginAt: r.last_login_at || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapRole(r: any): RoleDefinition {
  return {
    _id: r.id,
    _type: 'role',
    code: r.code,
    name: r.name,
    description: r.description || '',
    permissions: r.permissions || [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapSettings(r: any): ClinicSettings {
  const nc = r.notification_channels || {};
  return {
    _id: r.id,
    _type: 'clinicSettings',
    clinicName: r.clinic_name,
    leadDoctorName: r.lead_doctor_name,
    specialty: r.specialty,
    city: r.city,
    phone: r.phone,
    email: r.email,
    address: r.address,
    slogan: r.slogan || '',
    logoStorageKey: r.logo_storage_key || undefined,
    notificationChannels: {
      smsEnabled: Boolean(nc.smsEnabled),
      smsProvider: nc.smsProvider,
      whatsappEnabled: Boolean(nc.whatsappEnabled),
      whatsappBusinessNumber: nc.whatsappBusinessNumber,
      emailEnabled: nc.emailEnabled !== undefined ? Boolean(nc.emailEnabled) : true,
      senderEmail: nc.senderEmail,
      autoRemindersEnabled: nc.autoRemindersEnabled !== undefined ? Boolean(nc.autoRemindersEnabled) : true,
      appointmentReminderHoursBefore: Number(nc.appointmentReminderHoursBefore || 24),
      neverSendSensitiveMedicalData: nc.neverSendSensitiveMedicalData !== false,
    },
    archivingPolicyYears: Number(r.archiving_policy_years || 20),
    updatedAt: r.updated_at,
  };
}

function mapPatient(r: any): Patient {
  return {
    _id: r.id,
    _type: 'patient',
    patientNumber: r.patient_number,
    firstName: r.first_name,
    lastName: r.last_name,
    gender: r.gender,
    birthDate: typeof r.birth_date === 'string' ? r.birth_date.slice(0, 10) : r.birth_date,
    phone: r.phone,
    email: r.email || '',
    address: r.address || '',
    profession: r.profession || '',
    emergencyContactName: r.emergency_contact_name || '',
    emergencyContactPhone: r.emergency_contact_phone || '',
    bloodGroup: r.blood_group || '',
    medicalAlerts: r.medical_alerts || [],
    status: r.status,
    portalInvited: Boolean(r.portal_invited),
    portalActivated: Boolean(r.portal_activated),
    isDemo: Boolean(r.is_demo),
    createdById: r.created_by_id || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapMedicalRecord(r: any): MedicalRecord {
  return {
    _id: r.id,
    _type: 'medicalRecord',
    patientId: r.patient_id,
    summary: r.summary || '',
    riskFactors: r.risk_factors || [],
    primaryDoctorId: r.primary_doctor_id || undefined,
    lastConsultationAt: r.last_consultation_at || undefined,
    isDemo: Boolean(r.is_demo),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapMedicalHistory(r: any): MedicalHistoryItem {
  return {
    _id: r.id,
    _type: 'medicalHistory',
    patientId: r.patient_id,
    category: r.category,
    title: r.title,
    details: r.details || '',
    diagnosedYear: r.diagnosed_year || '',
    authorId: r.author_id || '',
    authorName: shortPersonName(r.author, 'Médecin'),
    isDemo: Boolean(r.is_demo),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapAllergy(r: any): Allergy {
  return {
    _id: r.id,
    _type: 'allergy',
    patientId: r.patient_id,
    allergen: r.allergen,
    reaction: r.reaction || '',
    severity: r.severity,
    authorId: r.author_id || '',
    isDemo: Boolean(r.is_demo),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapMedication(r: any): Medication {
  return {
    _id: r.id,
    _type: 'medication',
    patientId: r.patient_id,
    name: r.name,
    dosage: r.dosage,
    frequency: r.frequency,
    startDate: r.start_date || undefined,
    endDate: r.end_date || undefined,
    active: Boolean(r.active),
    prescribedById: r.prescribed_by_id || undefined,
    notes: r.notes || '',
    isDemo: Boolean(r.is_demo),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapVitalSigns(r: any): VitalSigns {
  return {
    _id: r.id,
    _type: 'vitalSigns',
    patientId: r.patient_id,
    consultationId: r.consultation_id || undefined,
    systolicBP: r.systolic_bp !== null && r.systolic_bp !== undefined ? Number(r.systolic_bp) : undefined,
    diastolicBP: r.diastolic_bp !== null && r.diastolic_bp !== undefined ? Number(r.diastolic_bp) : undefined,
    heartRate: r.heart_rate !== null && r.heart_rate !== undefined ? Number(r.heart_rate) : undefined,
    temperature: r.temperature !== null && r.temperature !== undefined ? Number(r.temperature) : undefined,
    oxygenSaturation: r.oxygen_saturation !== null && r.oxygen_saturation !== undefined ? Number(r.oxygen_saturation) : undefined,
    weight: r.weight !== null && r.weight !== undefined ? Number(r.weight) : undefined,
    height: r.height !== null && r.height !== undefined ? Number(r.height) : undefined,
    bmi: r.bmi !== null && r.bmi !== undefined ? Number(r.bmi) : undefined,
    respiratoryRate: r.respiratory_rate !== null && r.respiratory_rate !== undefined ? Number(r.respiratory_rate) : undefined,
    recordedById: r.recorded_by_id || '',
    recordedAt: r.recorded_at,
    isDemo: Boolean(r.is_demo),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapDiagnosis(r: any): DiagnosisItem {
  return {
    _id: r.id,
    _type: 'diagnosis',
    patientId: r.patient_id,
    consultationId: r.consultation_id,
    code: r.code || '',
    label: r.label,
    type: r.type,
    authorId: r.author_id || '',
    isDemo: Boolean(r.is_demo),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapPrescription(r: any): Prescription {
  return {
    _id: r.id,
    _type: 'prescription',
    patientId: r.patient_id,
    consultationId: r.consultation_id || undefined,
    doctorId: r.doctor_id,
    doctorName: fullPersonName(r.doctor, 'Médecin'),
    date: typeof r.date === 'string' ? r.date.slice(0, 10) : r.date,
    lines: Array.isArray(r.lines) ? r.lines : [],
    notes: r.notes || '',
    isDemo: Boolean(r.is_demo),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapAppointment(r: any): Appointment {
  return {
    _id: r.id,
    _type: 'appointment',
    patientId: r.patient_id,
    patientName: shortPersonName(r.patient, 'Patient'),
    patientNumber: r.patient?.patient_number || undefined,
    doctorId: r.doctor_id,
    doctorName: fullPersonName(r.doctor, 'Médecin'),
    date: typeof r.date === 'string' ? r.date.slice(0, 10) : r.date,
    startTime: r.start_time,
    endTime: r.end_time,
    type: r.type,
    status: r.status,
    reason: r.reason,
    adminPriority: r.admin_priority,
    urgencyValidatedByHealthPro: Boolean(r.urgency_validated_by_health_pro),
    urgencyValidatedById: r.urgency_validated_by_id || undefined,
    urgencyValidatedAt: r.urgency_validated_at || undefined,
    queueNumber: r.queue_number ?? undefined,
    arrivedAt: r.arrived_at || undefined,
    consultationStartedAt: r.consultation_started_at || undefined,
    consultationEndedAt: r.consultation_ended_at || undefined,
    requestedByPatient: Boolean(r.requested_by_patient),
    notes: r.notes || '',
    isDemo: Boolean(r.is_demo),
    createdById: r.created_by_id || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapConsultation(r: any): Consultation {
  return {
    _id: r.id,
    _type: 'consultation',
    patientId: r.patient_id,
    patientName: shortPersonName(r.patient, 'Patient'),
    patientNumber: r.patient?.patient_number || undefined,
    doctorId: r.doctor_id,
    doctorName: fullPersonName(r.doctor, 'Médecin'),
    appointmentId: r.appointment_id || undefined,
    date: typeof r.date === 'string' ? r.date.slice(0, 10) : r.date,
    time: r.time,
    reason: r.reason,
    illnessHistory: r.illness_history || '',
    symptoms: r.symptoms || '',
    relevantHistory: r.relevant_history || '',
    clinicalExam: r.clinical_exam || '',
    vitals: r.vitals || {},
    observations: r.observations || '',
    diagnosticHypotheses: r.diagnostic_hypotheses || '',
    confirmedDiagnosis: r.confirmed_diagnosis || '',
    prescribedExams: r.prescribed_exams || [],
    treatmentsText: r.treatments_text || '',
    prescriptionLines: Array.isArray(r.prescription_lines) ? r.prescription_lines : [],
    recommendations: r.recommendations || '',
    nextControlDate: r.next_control_date || '',
    status: r.status,
    validatedAt: r.validated_at || undefined,
    validatedById: r.validated_by_id || undefined,
    corrections: Array.isArray(r.corrections) ? r.corrections : [],
    isDemo: Boolean(r.is_demo),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapExamination(r: any): Examination {
  return {
    _id: r.id,
    _type: 'examination',
    examNumber: r.exam_number,
    patientId: r.patient_id,
    patientName: shortPersonName(r.patient, 'Patient'),
    patientNumber: r.patient?.patient_number || undefined,
    prescribingDoctorId: r.prescribing_doctor_id,
    prescribingDoctorName: fullPersonName(r.prescribing_doctor, 'Médecin'),
    consultationId: r.consultation_id || undefined,
    prescriptionDate: typeof r.prescription_date === 'string' ? r.prescription_date.slice(0, 10) : r.prescription_date,
    type: r.type,
    scheduledDate: r.scheduled_date || '',
    performedDate: r.performed_date || '',
    operatorName: r.operator_name || '',
    technicalNotes: r.technical_notes || '',
    attachedDocumentId: r.attached_document_id || undefined,
    attachedFileName: r.attached_document?.original_name || undefined,
    resultSummary: r.result_summary || '',
    reportText: r.report_text || '',
    interpretingDoctorId: r.interpreting_doctor_id || undefined,
    interpretingDoctorName: r.interpreting_doctor ? fullPersonName(r.interpreting_doctor, '') : '',
    validatedAt: r.validated_at || undefined,
    sharedWithPatient: Boolean(r.shared_with_patient),
    status: r.status,
    isDemo: Boolean(r.is_demo),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapExaminationResult(r: any): ExaminationResult {
  return {
    _id: r.id,
    _type: 'examinationResult',
    examinationId: r.examination_id,
    patientId: r.patient_id,
    measurements: r.measurements || {},
    conclusion: r.conclusion,
    reportText: r.report_text,
    interpretingDoctorId: r.interpreting_doctor_id,
    validated: Boolean(r.validated),
    validatedAt: r.validated_at || undefined,
    sharedWithPatient: Boolean(r.shared_with_patient),
    isDemo: Boolean(r.is_demo),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapFollowUp(r: any): FollowUp {
  return {
    _id: r.id,
    _type: 'followUp',
    patientId: r.patient_id,
    patientName: shortPersonName(r.patient, 'Patient'),
    patientNumber: r.patient?.patient_number || undefined,
    patientPhone: r.patient?.phone || undefined,
    consultationId: r.consultation_id || undefined,
    examinationId: r.examination_id || undefined,
    type: r.type,
    reason: r.reason,
    dueDate: typeof r.due_date === 'string' ? r.due_date.slice(0, 10) : r.due_date,
    assigneeId: r.assignee_id,
    assigneeName: shortPersonName(r.assignee, 'Non assigné'),
    priority: r.priority,
    status: r.status,
    contactOutcome: r.contact_outcome || '',
    notes: r.notes || '',
    nextAction: r.next_action || '',
    closedAt: r.closed_at || undefined,
    closedById: r.closed_by_id || undefined,
    history: Array.isArray(r.history) ? r.history : [],
    isDemo: Boolean(r.is_demo),
    createdById: r.created_by_id || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapTask(r: any): Task {
  return {
    _id: r.id,
    _type: 'task',
    title: r.title,
    description: r.description || '',
    category: r.category,
    patientId: r.patient_id || undefined,
    patientName: r.patient ? shortPersonName(r.patient, '') : '',
    assigneeId: r.assignee_id,
    assigneeName: shortPersonName(r.assignee, 'Non assigné'),
    dueDate: typeof r.due_date === 'string' ? r.due_date.slice(0, 10) : r.due_date,
    priority: r.priority,
    status: r.status,
    history: Array.isArray(r.history) ? r.history : [],
    isDemo: Boolean(r.is_demo),
    createdById: r.created_by_id || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapDocument(r: any): MedicalDocument {
  return {
    _id: r.id,
    _type: 'medicalDocument',
    title: r.title,
    category: r.category,
    patientId: r.patient_id,
    patientName: shortPersonName(r.patient, 'Patient'),
    consultationId: r.consultation_id || undefined,
    examinationId: r.examination_id || undefined,
    fileName: r.file_name,
    originalName: r.original_name,
    mimeType: r.mime_type,
    sizeBytes: Number(r.size_bytes || 0),
    storageKey: r.storage_key,
    sharedWithPatient: Boolean(r.shared_with_patient),
    archived: Boolean(r.archived),
    uploadedById: r.uploaded_by_id || '',
    uploadedByName: shortPersonName(r.uploaded_by, 'Personnel'),
    isDemo: Boolean(r.is_demo),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapNotification(r: any): NotificationItem {
  return {
    _id: r.id,
    _type: 'notification',
    recipientUserId: r.recipient_user_id || undefined,
    recipientRoles: r.recipient_roles || [],
    eventType: r.event_type,
    title: r.title,
    message: r.message,
    linkModule: r.link_module || '',
    relatedEntityId: r.related_entity_id || '',
    readByUserIds: r.read_by_user_ids || [],
    channel: r.channel || 'INTERNE',
    isDemo: Boolean(r.is_demo),
    createdAt: r.created_at,
  };
}

function mapEmailDispatch(r: any): EmailDispatchLog {
  return {
    _id: r.id,
    _type: 'emailDispatchLog',
    recipientEmail: r.recipient_email,
    recipientName: r.recipient_name || '',
    subject: r.subject,
    category: r.category,
    status: r.status,
    provider: 'RESEND',
    providerMessageId: r.provider_message_id || undefined,
    errorMessage: r.error_message || undefined,
    relatedEntityId: r.related_entity_id || undefined,
    patientId: r.patient_id || undefined,
    reminderKey: r.reminder_key || undefined,
    createdAt: r.created_at,
  };
}

function mapService(r: any): MedicalService {
  return {
    _id: r.id,
    _type: 'service',
    code: r.code,
    name: r.name,
    category: r.category,
    priceFcfa: r.price_fcfa !== null && r.price_fcfa !== undefined ? Number(r.price_fcfa) : null,
    active: Boolean(r.active),
    description: r.description || '',
    isDemo: Boolean(r.is_demo),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapPayment(r: any): Payment {
  return {
    _id: r.id,
    _type: 'payment',
    receiptNumber: r.receipt_number,
    patientId: r.patient_id,
    patientName: shortPersonName(r.patient, 'Patient'),
    patientNumber: r.patient?.patient_number || undefined,
    serviceId: r.service_id || undefined,
    serviceName: r.service_name,
    totalAmountFcfa: Number(r.total_amount_fcfa || 0),
    amountPaidFcfa: Number(r.amount_paid_fcfa || 0),
    remainingBalanceFcfa: Number(r.remaining_balance_fcfa || 0),
    status: r.status,
    method: r.method,
    date: typeof r.date === 'string' ? r.date.slice(0, 10) : r.date,
    notes: r.notes || '',
    recordedById: r.recorded_by_id || '',
    recordedByName: shortPersonName(r.recorded_by, 'Accueil'),
    isDemo: Boolean(r.is_demo),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapAuditLog(r: any): AuditLog {
  return {
    _id: r.id,
    _type: 'auditLog',
    actorUserId: r.actor_user_id || undefined,
    actorName: r.actor_name,
    actorRoles: r.actor_roles || [],
    action: r.action,
    resourceType: r.resource_type,
    resourceId: r.resource_id || undefined,
    severity: r.severity,
    details: r.details,
    ipAddress: r.ip_address || undefined,
    createdAt: r.created_at,
  };
}

function throwIfError(error: any, context: string): void {
  if (!error) return;
  console.error(`[SUPABASE_ERROR:${context}]`, error);
  throw new Error(error.message || `Erreur Supabase (${context}).`);
}

export class SupabaseRepository implements DataRepository {
  private cachedClient: SupabaseClient | null = null;
  private cachedKey = '';

  private getClient(): SupabaseClient {
    const cfg = getEnvConfig();
    if (!isSupabaseConfigured()) {
      throw new Error('SUPABASE_NOT_CONFIGURED');
    }
    const key = `${cfg.supabaseUrl}|${cfg.supabaseServiceRoleKey}`;
    if (!this.cachedClient || this.cachedKey !== key) {
      this.cachedClient = createClient(cfg.supabaseUrl, cfg.supabaseServiceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });
      this.cachedKey = key;
    }
    return this.cachedClient;
  }

  async testConnection(): Promise<{ ok: boolean; schemaReady?: boolean; error?: string }> {
    if (!isSupabaseConfigured()) {
      return {
        ok: false,
        schemaReady: false,
        error: 'Variables Supabase manquantes (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).',
      };
    }
    try {
      const sb = this.getClient();
      const { error } = await sb.from('users').select('id', { count: 'exact', head: true });
      if (error) {
        const msg = error.message || '';
        if (error.code === '42P01' || msg.includes('Could not find the table') || msg.includes('does not exist')) {
          return {
            ok: false,
            schemaReady: false,
            error:
              'Connexion Supabase active, mais les tables SQL ne sont pas encore créées. Exécutez le script /supabase/schema.sql dans Supabase -> SQL Editor.',
          };
        }
        return { ok: false, schemaReady: false, error: msg || 'Erreur de connexion Supabase.' };
      }
      return { ok: true, schemaReady: true };
    } catch (err: any) {
      return {
        ok: false,
        schemaReady: false,
        error: err?.message || 'Impossible de contacter Supabase.',
      };
    }
  }

  async hasAnyUsers(): Promise<boolean> {
    const sb = this.getClient();
    const { count, error } = await sb.from('users').select('id', { count: 'exact', head: true });
    throwIfError(error, 'hasAnyUsers');
    return (count || 0) > 0;
  }

  async hasDemoData(): Promise<boolean> {
    const sb = this.getClient();
    const { count, error } = await sb.from('patients').select('id', { count: 'exact', head: true }).eq('is_demo', true);
    throwIfError(error, 'hasDemoData');
    return (count || 0) > 0;
  }

  async deleteAllDemoData(): Promise<number> {
    const sb = this.getClient();
    // Delete child tables first respecting foreign key constraints; NEVER touch audit_logs (append-only)
    const tablesInOrder = [
      'notifications',
      'payments',
      'tasks',
      'follow_ups',
      'examination_results',
      'medical_documents',
      'examinations',
      'prescriptions',
      'diagnoses',
      'vital_signs',
      'consultations',
      'appointments',
      'medications',
      'allergies',
      'medical_histories',
      'medical_records',
      'medical_services',
      'users',
      'patients',
    ];

    let total = 0;
    for (const table of tablesInOrder) {
      // Unlink attached_document_id before deleting medical_documents
      if (table === 'medical_documents') {
        await sb.from('examinations').update({ attached_document_id: null }).eq('is_demo', true);
      }
      // Unlink patients.created_by_id before deleting demo users
      if (table === 'users') {
        await sb.from('patients').update({ created_by_id: null }).eq('is_demo', true);
      }
      const { data, error } = await sb.from(table).delete().eq('is_demo', true).select('id');
      if (!error && data) {
        total += data.length;
      }
    }
    return total;
  }

  // ---------------- USERS & ROLES ----------------

  async findUserByIdentifier(identifier: string): Promise<User | null> {
    const sb = this.getClient();
    const clean = identifier.trim().toLowerCase();
    const { data, error } = await sb
      .from('users')
      .select('*')
      .or(`email.eq.${clean},username.eq.${clean}`)
      .limit(1)
      .maybeSingle();
    throwIfError(error, 'findUserByIdentifier');
    return data ? mapUser(data) : null;
  }

  async findUserById(id: string): Promise<User | null> {
    const sb = this.getClient();
    const { data, error } = await sb.from('users').select('*').eq('id', id).maybeSingle();
    throwIfError(error, 'findUserById');
    return data ? mapUser(data) : null;
  }

  async listUsers(): Promise<User[]> {
    const sb = this.getClient();
    const { data, error } = await sb.from('users').select('*').order('created_at', { ascending: false });
    throwIfError(error, 'listUsers');
    return (data || []).map(mapUser);
  }

  async createUser(data: Omit<User, '_id' | '_type'>): Promise<User> {
    const sb = this.getClient();
    const id = makeId('user');
    const row = {
      id,
      email: data.email.toLowerCase(),
      username: data.username.toLowerCase(),
      first_name: data.firstName,
      last_name: data.lastName,
      title: data.title || '',
      specialty: data.specialty || '',
      phone: data.phone || '',
      roles: data.roles,
      is_active: data.isActive,
      is_demo: Boolean(data.isDemo),
      patient_id: data.patientId || null,
      password_hash: data.passwordHash || null,
      last_login_at: data.lastLoginAt || null,
      created_at: data.createdAt,
      updated_at: data.updatedAt,
    };
    const { data: inserted, error } = await sb.from('users').insert(row).select('*').single();
    throwIfError(error, 'createUser');
    return mapUser(inserted);
  }

  async updateUser(id: string, patch: Partial<User>): Promise<User> {
    const sb = this.getClient();
    const row: Record<string, any> = {};
    if (patch.email !== undefined) row.email = patch.email.toLowerCase();
    if (patch.username !== undefined) row.username = patch.username.toLowerCase();
    if (patch.firstName !== undefined) row.first_name = patch.firstName;
    if (patch.lastName !== undefined) row.last_name = patch.lastName;
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.specialty !== undefined) row.specialty = patch.specialty;
    if (patch.phone !== undefined) row.phone = patch.phone;
    if (patch.roles !== undefined) row.roles = patch.roles;
    if (patch.isActive !== undefined) row.is_active = patch.isActive;
    if (patch.patientId !== undefined) row.patient_id = patch.patientId || null;
    if (patch.passwordHash !== undefined) row.password_hash = patch.passwordHash;
    if (patch.lastLoginAt !== undefined) row.last_login_at = patch.lastLoginAt;
    if (patch.updatedAt !== undefined) row.updated_at = patch.updatedAt;

    const { data: updated, error } = await sb.from('users').update(row).eq('id', id).select('*').single();
    throwIfError(error, 'updateUser');
    return mapUser(updated);
  }

  async listRoles(): Promise<RoleDefinition[]> {
    const sb = this.getClient();
    const { data, error } = await sb.from('roles').select('*').order('code', { ascending: true });
    throwIfError(error, 'listRoles');
    return (data || []).map(mapRole);
  }

  async upsertRole(role: RoleDefinition): Promise<RoleDefinition> {
    const sb = this.getClient();
    const row = {
      id: role._id,
      code: role.code,
      name: role.name,
      description: role.description,
      permissions: role.permissions,
      created_at: role.createdAt,
      updated_at: role.updatedAt,
    };
    const { data, error } = await sb.from('roles').upsert(row, { onConflict: 'code' }).select('*').single();
    throwIfError(error, 'upsertRole');
    return mapRole(data);
  }

  // ---------------- CLINIC SETTINGS ----------------

  async getClinicSettings(): Promise<ClinicSettings | null> {
    const sb = this.getClient();
    const { data, error } = await sb
      .from('clinic_settings')
      .select('*')
      .eq('id', 'clinic-settings-main')
      .maybeSingle();
    throwIfError(error, 'getClinicSettings');
    return data ? mapSettings(data) : null;
  }

  async upsertClinicSettings(settings: Partial<ClinicSettings> & { updatedAt: string }): Promise<ClinicSettings> {
    const sb = this.getClient();
    const existing = await this.getClinicSettings();
    const merged: ClinicSettings = {
      _id: 'clinic-settings-main',
      _type: 'clinicSettings',
      clinicName: settings.clinicName ?? existing?.clinicName ?? CLINIC_DEFAULTS.clinicName,
      leadDoctorName: settings.leadDoctorName ?? existing?.leadDoctorName ?? CLINIC_DEFAULTS.leadDoctorName,
      specialty: settings.specialty ?? existing?.specialty ?? CLINIC_DEFAULTS.specialty,
      city: settings.city ?? existing?.city ?? CLINIC_DEFAULTS.city,
      phone: settings.phone ?? existing?.phone ?? CLINIC_DEFAULTS.phone,
      email: settings.email ?? existing?.email ?? CLINIC_DEFAULTS.email,
      address: settings.address ?? existing?.address ?? CLINIC_DEFAULTS.address,
      slogan: settings.slogan ?? existing?.slogan ?? CLINIC_DEFAULTS.slogan,
      logoStorageKey: settings.logoStorageKey ?? existing?.logoStorageKey,
      notificationChannels: settings.notificationChannels ?? existing?.notificationChannels ?? {
        smsEnabled: false,
        whatsappEnabled: false,
        emailEnabled: true,
        autoRemindersEnabled: true,
        appointmentReminderHoursBefore: 24,
        neverSendSensitiveMedicalData: true,
      },
      archivingPolicyYears: settings.archivingPolicyYears ?? existing?.archivingPolicyYears ?? 20,
      updatedAt: settings.updatedAt,
    };

    const row = {
      id: merged._id,
      clinic_name: merged.clinicName,
      lead_doctor_name: merged.leadDoctorName,
      specialty: merged.specialty,
      city: merged.city,
      phone: merged.phone,
      email: merged.email,
      address: merged.address,
      slogan: merged.slogan,
      logo_storage_key: merged.logoStorageKey || null,
      notification_channels: merged.notificationChannels,
      archiving_policy_years: merged.archivingPolicyYears,
      updated_at: merged.updatedAt,
    };

    const { data, error } = await sb.from('clinic_settings').upsert(row, { onConflict: 'id' }).select('*').single();
    throwIfError(error, 'upsertClinicSettings');
    return mapSettings(data);
  }

  // ---------------- PATIENTS & MEDICAL RECORDS ----------------

  async listPatients(filter?: PatientFilter): Promise<Patient[]> {
    const sb = this.getClient();
    let query = sb.from('patients').select('*').order('created_at', { ascending: false });

    if (filter?.status && filter.status !== 'ALL') {
      query = query.eq('status', filter.status);
    }
    if (filter?.gender) {
      query = query.eq('gender', filter.gender);
    }
    const { data, error } = await query;
    throwIfError(error, 'listPatients');
    let list = (data || []).map(mapPatient);

    if (filter?.search && filter.search.trim()) {
      const q = filter.search.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.firstName.toLowerCase().includes(q) ||
          p.lastName.toLowerCase().includes(q) ||
          p.patientNumber.toLowerCase().includes(q) ||
          p.phone.toLowerCase().includes(q) ||
          (p.email || '').toLowerCase().includes(q)
      );
    }
    return list;
  }

  async findPatientById(id: string): Promise<Patient | null> {
    const sb = this.getClient();
    const clean = id.trim();
    const { data, error } = await sb
      .from('patients')
      .select('*')
      .or(`id.eq.${clean},patient_number.eq.${clean.toUpperCase()}`)
      .limit(1)
      .maybeSingle();
    throwIfError(error, 'findPatientById');
    return data ? mapPatient(data) : null;
  }

  async findDuplicatePatients(lastName: string, birthDate: string, phone: string): Promise<Patient[]> {
    const all = await this.listPatients({ status: 'ALL' });
    const cleanLast = lastName.trim().toLowerCase();
    const cleanPhone = phone.replace(/\s+/g, '');
    return all.filter((p) => {
      const sameIdentity = p.lastName.trim().toLowerCase() === cleanLast && birthDate && p.birthDate === birthDate;
      const samePhone = cleanPhone && p.phone.replace(/\s+/g, '') === cleanPhone;
      return Boolean(sameIdentity || samePhone);
    });
  }

  async getNextPatientNumber(): Promise<string> {
    const sb = this.getClient();
    const { data, error } = await sb.from('patients').select('patient_number');
    throwIfError(error, 'getNextPatientNumber');
    let max = 0;
    for (const row of data || []) {
      const m = /^PAT-(\d+)$/.exec(row.patient_number || '');
      if (m) {
        const val = parseInt(m[1], 10);
        if (val > max) max = val;
      }
    }
    return `PAT-${String(max + 1).padStart(5, '0')}`;
  }

  async createPatient(data: Omit<Patient, '_id' | '_type'>): Promise<Patient> {
    const sb = this.getClient();
    const id = makeId('pat');
    const row = {
      id,
      patient_number: data.patientNumber,
      first_name: data.firstName,
      last_name: data.lastName,
      gender: data.gender,
      birth_date: data.birthDate,
      phone: data.phone,
      email: data.email || '',
      address: data.address || '',
      profession: data.profession || '',
      emergency_contact_name: data.emergencyContactName || '',
      emergency_contact_phone: data.emergencyContactPhone || '',
      blood_group: data.bloodGroup || '',
      medical_alerts: data.medicalAlerts || [],
      status: data.status || 'ACTIF',
      portal_invited: Boolean(data.portalInvited),
      portal_activated: Boolean(data.portalActivated),
      is_demo: Boolean(data.isDemo),
      created_by_id: data.createdById || null,
      created_at: data.createdAt,
      updated_at: data.updatedAt,
    };
    const { data: inserted, error } = await sb.from('patients').insert(row).select('*').single();
    throwIfError(error, 'createPatient');
    return mapPatient(inserted);
  }

  async updatePatient(id: string, patch: Partial<Patient>): Promise<Patient> {
    const sb = this.getClient();
    const row: Record<string, any> = {};
    if (patch.firstName !== undefined) row.first_name = patch.firstName;
    if (patch.lastName !== undefined) row.last_name = patch.lastName;
    if (patch.gender !== undefined) row.gender = patch.gender;
    if (patch.birthDate !== undefined) row.birth_date = patch.birthDate;
    if (patch.phone !== undefined) row.phone = patch.phone;
    if (patch.email !== undefined) row.email = patch.email;
    if (patch.address !== undefined) row.address = patch.address;
    if (patch.profession !== undefined) row.profession = patch.profession;
    if (patch.emergencyContactName !== undefined) row.emergency_contact_name = patch.emergencyContactName;
    if (patch.emergencyContactPhone !== undefined) row.emergency_contact_phone = patch.emergencyContactPhone;
    if (patch.bloodGroup !== undefined) row.blood_group = patch.bloodGroup;
    if (patch.medicalAlerts !== undefined) row.medical_alerts = patch.medicalAlerts;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.portalInvited !== undefined) row.portal_invited = patch.portalInvited;
    if (patch.portalActivated !== undefined) row.portal_activated = patch.portalActivated;
    if (patch.updatedAt !== undefined) row.updated_at = patch.updatedAt;

    const { data: updated, error } = await sb.from('patients').update(row).eq('id', id).select('*').single();
    throwIfError(error, 'updatePatient');
    return mapPatient(updated);
  }

  async getMedicalRecordByPatient(patientId: string): Promise<MedicalRecord | null> {
    const sb = this.getClient();
    const { data, error } = await sb.from('medical_records').select('*').eq('patient_id', patientId).maybeSingle();
    throwIfError(error, 'getMedicalRecordByPatient');
    return data ? mapMedicalRecord(data) : null;
  }

  async upsertMedicalRecord(patientId: string, data: Partial<MedicalRecord>): Promise<MedicalRecord> {
    const sb = this.getClient();
    const existing = await this.getMedicalRecordByPatient(patientId);
    const now = new Date().toISOString();
    if (existing) {
      const row: Record<string, any> = { updated_at: now };
      if (data.summary !== undefined) row.summary = data.summary;
      if (data.riskFactors !== undefined) row.risk_factors = data.riskFactors;
      if (data.lastConsultationAt !== undefined) row.last_consultation_at = data.lastConsultationAt;
      if (data.primaryDoctorId !== undefined) row.primary_doctor_id = data.primaryDoctorId || null;
      const { data: updated, error } = await sb
        .from('medical_records')
        .update(row)
        .eq('id', existing._id)
        .select('*')
        .single();
      throwIfError(error, 'updateMedicalRecord');
      return mapMedicalRecord(updated);
    }

    const row = {
      id: makeId('mrec'),
      patient_id: patientId,
      summary: data.summary || '',
      risk_factors: data.riskFactors || [],
      primary_doctor_id: data.primaryDoctorId || null,
      last_consultation_at: data.lastConsultationAt || null,
      is_demo: Boolean(data.isDemo),
      created_at: now,
      updated_at: now,
    };
    const { data: inserted, error } = await sb.from('medical_records').insert(row).select('*').single();
    throwIfError(error, 'createMedicalRecord');
    return mapMedicalRecord(inserted);
  }

  async listMedicalHistory(patientId: string): Promise<MedicalHistoryItem[]> {
    const sb = this.getClient();
    const { data, error } = await sb
      .from('medical_histories')
      .select('*, author:users!medical_histories_author_id_fkey(first_name, last_name)')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false });
    throwIfError(error, 'listMedicalHistory');
    return (data || []).map(mapMedicalHistory);
  }

  async findMedicalHistoryById(id: string): Promise<MedicalHistoryItem | null> {
    const sb = this.getClient();
    const { data, error } = await sb
      .from('medical_histories')
      .select('*, author:users!medical_histories_author_id_fkey(first_name, last_name)')
      .eq('id', id)
      .maybeSingle();
    throwIfError(error, 'findMedicalHistoryById');
    return data ? mapMedicalHistory(data) : null;
  }

  async createMedicalHistory(data: Omit<MedicalHistoryItem, '_id' | '_type'>): Promise<MedicalHistoryItem> {
    const sb = this.getClient();
    const row = {
      id: makeId('hist'),
      patient_id: data.patientId,
      category: data.category,
      title: data.title,
      details: data.details || '',
      diagnosed_year: data.diagnosedYear || '',
      author_id: data.authorId || null,
      is_demo: Boolean(data.isDemo),
      created_at: data.createdAt,
      updated_at: data.updatedAt,
    };
    const { data: inserted, error } = await sb.from('medical_histories').insert(row).select('*').single();
    throwIfError(error, 'createMedicalHistory');
    return mapMedicalHistory(inserted);
  }

  async deleteMedicalHistory(id: string): Promise<void> {
    const sb = this.getClient();
    const { error } = await sb.from('medical_histories').delete().eq('id', id);
    throwIfError(error, 'deleteMedicalHistory');
  }

  async listAllergies(patientId: string): Promise<Allergy[]> {
    const sb = this.getClient();
    const { data, error } = await sb
      .from('allergies')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false });
    throwIfError(error, 'listAllergies');
    return (data || []).map(mapAllergy);
  }

  async findAllergyById(id: string): Promise<Allergy | null> {
    const sb = this.getClient();
    const { data, error } = await sb.from('allergies').select('*').eq('id', id).maybeSingle();
    throwIfError(error, 'findAllergyById');
    return data ? mapAllergy(data) : null;
  }

  async createAllergy(data: Omit<Allergy, '_id' | '_type'>): Promise<Allergy> {
    const sb = this.getClient();
    const row = {
      id: makeId('allg'),
      patient_id: data.patientId,
      allergen: data.allergen,
      reaction: data.reaction || '',
      severity: data.severity,
      author_id: data.authorId || null,
      is_demo: Boolean(data.isDemo),
      created_at: data.createdAt,
      updated_at: data.updatedAt,
    };
    const { data: inserted, error } = await sb.from('allergies').insert(row).select('*').single();
    throwIfError(error, 'createAllergy');
    return mapAllergy(inserted);
  }

  async deleteAllergy(id: string): Promise<void> {
    const sb = this.getClient();
    const { error } = await sb.from('allergies').delete().eq('id', id);
    throwIfError(error, 'deleteAllergy');
  }

  async listMedications(patientId: string): Promise<Medication[]> {
    const sb = this.getClient();
    const { data, error } = await sb
      .from('medications')
      .select('*')
      .eq('patient_id', patientId)
      .order('active', { ascending: false })
      .order('created_at', { ascending: false });
    throwIfError(error, 'listMedications');
    return (data || []).map(mapMedication);
  }

  async findMedicationById(id: string): Promise<Medication | null> {
    const sb = this.getClient();
    const { data, error } = await sb.from('medications').select('*').eq('id', id).maybeSingle();
    throwIfError(error, 'findMedicationById');
    return data ? mapMedication(data) : null;
  }

  async createMedication(data: Omit<Medication, '_id' | '_type'>): Promise<Medication> {
    const sb = this.getClient();
    const row = {
      id: makeId('med'),
      patient_id: data.patientId,
      name: data.name,
      dosage: data.dosage,
      frequency: data.frequency,
      start_date: data.startDate || null,
      end_date: data.endDate || null,
      active: data.active,
      prescribed_by_id: data.prescribedById || null,
      notes: data.notes || '',
      is_demo: Boolean(data.isDemo),
      created_at: data.createdAt,
      updated_at: data.updatedAt,
    };
    const { data: inserted, error } = await sb.from('medications').insert(row).select('*').single();
    throwIfError(error, 'createMedication');
    return mapMedication(inserted);
  }

  async updateMedication(id: string, patch: Partial<Medication>): Promise<Medication> {
    const sb = this.getClient();
    const row: Record<string, any> = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.dosage !== undefined) row.dosage = patch.dosage;
    if (patch.frequency !== undefined) row.frequency = patch.frequency;
    if (patch.startDate !== undefined) row.start_date = patch.startDate;
    if (patch.endDate !== undefined) row.end_date = patch.endDate;
    if (patch.active !== undefined) row.active = patch.active;
    if (patch.notes !== undefined) row.notes = patch.notes;
    if (patch.updatedAt !== undefined) row.updated_at = patch.updatedAt;
    const { data: updated, error } = await sb.from('medications').update(row).eq('id', id).select('*').single();
    throwIfError(error, 'updateMedication');
    return mapMedication(updated);
  }

  async listVitalSigns(patientId: string): Promise<VitalSigns[]> {
    const sb = this.getClient();
    const { data, error } = await sb
      .from('vital_signs')
      .select('*')
      .eq('patient_id', patientId)
      .order('recorded_at', { ascending: false });
    throwIfError(error, 'listVitalSigns');
    return (data || []).map(mapVitalSigns);
  }

  async createVitalSigns(data: Omit<VitalSigns, '_id' | '_type'>): Promise<VitalSigns> {
    const sb = this.getClient();
    const row = {
      id: makeId('vit'),
      patient_id: data.patientId,
      consultation_id: data.consultationId || null,
      systolic_bp: data.systolicBP ?? null,
      diastolic_bp: data.diastolicBP ?? null,
      heart_rate: data.heartRate ?? null,
      temperature: data.temperature ?? null,
      oxygen_saturation: data.oxygenSaturation ?? null,
      weight: data.weight ?? null,
      height: data.height ?? null,
      bmi: data.bmi ?? null,
      respiratory_rate: data.respiratoryRate ?? null,
      recorded_by_id: data.recordedById || null,
      recorded_at: data.recordedAt,
      is_demo: Boolean(data.isDemo),
      created_at: data.createdAt,
      updated_at: data.updatedAt,
    };
    const { data: inserted, error } = await sb.from('vital_signs').insert(row).select('*').single();
    throwIfError(error, 'createVitalSigns');
    return mapVitalSigns(inserted);
  }

  async listDiagnoses(patientId: string): Promise<DiagnosisItem[]> {
    const sb = this.getClient();
    const { data, error } = await sb
      .from('diagnoses')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false });
    throwIfError(error, 'listDiagnoses');
    return (data || []).map(mapDiagnosis);
  }

  async createDiagnosis(data: Omit<DiagnosisItem, '_id' | '_type'>): Promise<DiagnosisItem> {
    const sb = this.getClient();
    const row = {
      id: makeId('diag'),
      patient_id: data.patientId,
      consultation_id: data.consultationId,
      code: data.code || '',
      label: data.label,
      type: data.type,
      author_id: data.authorId || null,
      is_demo: Boolean(data.isDemo),
      created_at: data.createdAt,
      updated_at: data.updatedAt,
    };
    const { data: inserted, error } = await sb.from('diagnoses').insert(row).select('*').single();
    throwIfError(error, 'createDiagnosis');
    return mapDiagnosis(inserted);
  }

  async listPrescriptions(patientId: string): Promise<Prescription[]> {
    const sb = this.getClient();
    const { data, error } = await sb
      .from('prescriptions')
      .select('*, doctor:users!prescriptions_doctor_id_fkey(title, first_name, last_name)')
      .eq('patient_id', patientId)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });
    throwIfError(error, 'listPrescriptions');
    return (data || []).map(mapPrescription);
  }

  async createPrescription(data: Omit<Prescription, '_id' | '_type'>): Promise<Prescription> {
    const sb = this.getClient();
    const row = {
      id: makeId('presc'),
      patient_id: data.patientId,
      consultation_id: data.consultationId || null,
      doctor_id: data.doctorId,
      date: data.date,
      lines: data.lines,
      notes: data.notes || '',
      is_demo: Boolean(data.isDemo),
      created_at: data.createdAt,
      updated_at: data.updatedAt,
    };
    const { data: inserted, error } = await sb
      .from('prescriptions')
      .insert(row)
      .select('*, doctor:users!prescriptions_doctor_id_fkey(title, first_name, last_name)')
      .single();
    throwIfError(error, 'createPrescription');
    return mapPrescription(inserted);
  }

  // ---------------- APPOINTMENTS & QUEUE ----------------

  private readonly APPOINTMENT_SELECT =
    '*, patient:patients!appointments_patient_id_fkey(first_name, last_name, patient_number), doctor:users!appointments_doctor_id_fkey(title, first_name, last_name)';

  async listAppointments(filter?: AppointmentFilter): Promise<Appointment[]> {
    const sb = this.getClient();
    let query = sb
      .from('appointments')
      .select(this.APPOINTMENT_SELECT)
      .order('date', { ascending: true })
      .order('start_time', { ascending: true });

    if (filter?.date) query = query.eq('date', filter.date);
    if (filter?.startDate) query = query.gte('date', filter.startDate);
    if (filter?.endDate) query = query.lte('date', filter.endDate);
    if (filter?.doctorId) query = query.eq('doctor_id', filter.doctorId);
    if (filter?.patientId) query = query.eq('patient_id', filter.patientId);
    if (filter?.type) query = query.eq('type', filter.type);
    if (filter?.status) query = query.eq('status', filter.status);

    const { data, error } = await query;
    throwIfError(error, 'listAppointments');
    return (data || []).map(mapAppointment);
  }

  async findAppointmentById(id: string): Promise<Appointment | null> {
    const sb = this.getClient();
    const { data, error } = await sb
      .from('appointments')
      .select(this.APPOINTMENT_SELECT)
      .eq('id', id)
      .maybeSingle();
    throwIfError(error, 'findAppointmentById');
    return data ? mapAppointment(data) : null;
  }

  async checkDoctorAvailability(
    doctorId: string,
    date: string,
    startTime: string,
    endTime: string,
    excludeId?: string
  ): Promise<boolean> {
    const existing = await this.listAppointments({ doctorId, date });
    const active = existing.filter(
      (a) => a._id !== excludeId && a.status !== 'ANNULE' && a.status !== 'ABSENT'
    );
    for (const appt of active) {
      if (startTime < appt.endTime && endTime > appt.startTime) {
        return false;
      }
    }
    return true;
  }

  async getNextQueueNumber(date: string): Promise<number> {
    const sb = this.getClient();
    const { data, error } = await sb
      .from('appointments')
      .select('queue_number')
      .eq('date', date)
      .not('queue_number', 'is', null);
    throwIfError(error, 'getNextQueueNumber');
    const max = (data || []).reduce<number>((acc, r) => (r.queue_number && r.queue_number > acc ? r.queue_number : acc), 0);
    return max + 1;
  }

  async createAppointment(data: Omit<Appointment, '_id' | '_type'>): Promise<Appointment> {
    const sb = this.getClient();
    const id = makeId('appt');
    const row = {
      id,
      patient_id: data.patientId,
      doctor_id: data.doctorId,
      date: data.date,
      start_time: data.startTime,
      end_time: data.endTime,
      type: data.type,
      status: data.status,
      reason: data.reason,
      admin_priority: data.adminPriority,
      urgency_validated_by_health_pro: Boolean(data.urgencyValidatedByHealthPro),
      urgency_validated_by_id: data.urgencyValidatedById || null,
      urgency_validated_at: data.urgencyValidatedAt || null,
      queue_number: data.queueNumber ?? null,
      arrived_at: data.arrivedAt || null,
      consultation_started_at: data.consultationStartedAt || null,
      consultation_ended_at: data.consultationEndedAt || null,
      requested_by_patient: Boolean(data.requestedByPatient),
      notes: data.notes || '',
      is_demo: Boolean(data.isDemo),
      created_by_id: data.createdById || null,
      created_at: data.createdAt,
      updated_at: data.updatedAt,
    };
    const { data: inserted, error } = await sb
      .from('appointments')
      .insert(row)
      .select(this.APPOINTMENT_SELECT)
      .single();
    throwIfError(error, 'createAppointment');
    return mapAppointment(inserted);
  }

  async updateAppointment(id: string, patch: Partial<Appointment>): Promise<Appointment> {
    const sb = this.getClient();
    const row: Record<string, any> = {};
    if (patch.patientId !== undefined) row.patient_id = patch.patientId;
    if (patch.doctorId !== undefined) row.doctor_id = patch.doctorId;
    if (patch.date !== undefined) row.date = patch.date;
    if (patch.startTime !== undefined) row.start_time = patch.startTime;
    if (patch.endTime !== undefined) row.end_time = patch.endTime;
    if (patch.type !== undefined) row.type = patch.type;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.reason !== undefined) row.reason = patch.reason;
    if (patch.adminPriority !== undefined) row.admin_priority = patch.adminPriority;
    if (patch.urgencyValidatedByHealthPro !== undefined) row.urgency_validated_by_health_pro = patch.urgencyValidatedByHealthPro;
    if (patch.urgencyValidatedById !== undefined) row.urgency_validated_by_id = patch.urgencyValidatedById || null;
    if (patch.urgencyValidatedAt !== undefined) row.urgency_validated_at = patch.urgencyValidatedAt || null;
    if (patch.queueNumber !== undefined) row.queue_number = patch.queueNumber;
    if (patch.arrivedAt !== undefined) row.arrived_at = patch.arrivedAt;
    if (patch.consultationStartedAt !== undefined) row.consultation_started_at = patch.consultationStartedAt;
    if (patch.consultationEndedAt !== undefined) row.consultation_ended_at = patch.consultationEndedAt;
    if (patch.notes !== undefined) row.notes = patch.notes;
    if (patch.updatedAt !== undefined) row.updated_at = patch.updatedAt;

    const { data: updated, error } = await sb
      .from('appointments')
      .update(row)
      .eq('id', id)
      .select(this.APPOINTMENT_SELECT)
      .single();
    throwIfError(error, 'updateAppointment');
    return mapAppointment(updated);
  }

  async deleteAppointment(id: string): Promise<void> {
    const sb = this.getClient();
    const { error } = await sb.from('appointments').delete().eq('id', id);
    throwIfError(error, 'deleteAppointment');
  }

  // ---------------- CONSULTATIONS ----------------

  private readonly CONSULTATION_SELECT =
    '*, patient:patients!consultations_patient_id_fkey(first_name, last_name, patient_number), doctor:users!consultations_doctor_id_fkey(title, first_name, last_name)';

  async listConsultations(filter?: { patientId?: string; doctorId?: string }): Promise<Consultation[]> {
    const sb = this.getClient();
    let query = sb
      .from('consultations')
      .select(this.CONSULTATION_SELECT)
      .order('date', { ascending: false })
      .order('time', { ascending: false });
    if (filter?.patientId) query = query.eq('patient_id', filter.patientId);
    if (filter?.doctorId) query = query.eq('doctor_id', filter.doctorId);

    const { data, error } = await query;
    throwIfError(error, 'listConsultations');
    return (data || []).map(mapConsultation);
  }

  async findConsultationById(id: string): Promise<Consultation | null> {
    const sb = this.getClient();
    const { data, error } = await sb
      .from('consultations')
      .select(this.CONSULTATION_SELECT)
      .eq('id', id)
      .maybeSingle();
    throwIfError(error, 'findConsultationById');
    return data ? mapConsultation(data) : null;
  }

  async createConsultation(data: Omit<Consultation, '_id' | '_type'>): Promise<Consultation> {
    const sb = this.getClient();
    const row = {
      id: makeId('cons'),
      patient_id: data.patientId,
      doctor_id: data.doctorId,
      appointment_id: data.appointmentId || null,
      date: data.date,
      time: data.time,
      reason: data.reason,
      illness_history: data.illnessHistory || '',
      symptoms: data.symptoms || '',
      relevant_history: data.relevantHistory || '',
      clinical_exam: data.clinicalExam || '',
      vitals: data.vitals || {},
      observations: data.observations || '',
      diagnostic_hypotheses: data.diagnosticHypotheses || '',
      confirmed_diagnosis: data.confirmedDiagnosis || '',
      prescribed_exams: data.prescribedExams || [],
      treatments_text: data.treatmentsText || '',
      prescription_lines: data.prescriptionLines || [],
      recommendations: data.recommendations || '',
      next_control_date: data.nextControlDate || '',
      status: data.status || 'BROUILLON',
      validated_at: data.validatedAt || null,
      validated_by_id: data.validatedById || null,
      corrections: data.corrections || [],
      is_demo: Boolean(data.isDemo),
      created_at: data.createdAt,
      updated_at: data.updatedAt,
    };
    const { data: inserted, error } = await sb
      .from('consultations')
      .insert(row)
      .select(this.CONSULTATION_SELECT)
      .single();
    throwIfError(error, 'createConsultation');
    return mapConsultation(inserted);
  }

  async updateConsultation(id: string, patch: Partial<Consultation>): Promise<Consultation> {
    const sb = this.getClient();
    const row: Record<string, any> = {};
    if (patch.date !== undefined) row.date = patch.date;
    if (patch.time !== undefined) row.time = patch.time;
    if (patch.reason !== undefined) row.reason = patch.reason;
    if (patch.illnessHistory !== undefined) row.illness_history = patch.illnessHistory;
    if (patch.symptoms !== undefined) row.symptoms = patch.symptoms;
    if (patch.relevantHistory !== undefined) row.relevant_history = patch.relevantHistory;
    if (patch.clinicalExam !== undefined) row.clinical_exam = patch.clinicalExam;
    if (patch.vitals !== undefined) row.vitals = patch.vitals;
    if (patch.observations !== undefined) row.observations = patch.observations;
    if (patch.diagnosticHypotheses !== undefined) row.diagnostic_hypotheses = patch.diagnosticHypotheses;
    if (patch.confirmedDiagnosis !== undefined) row.confirmed_diagnosis = patch.confirmedDiagnosis;
    if (patch.prescribedExams !== undefined) row.prescribed_exams = patch.prescribedExams;
    if (patch.treatmentsText !== undefined) row.treatments_text = patch.treatmentsText;
    if (patch.prescriptionLines !== undefined) row.prescription_lines = patch.prescriptionLines;
    if (patch.recommendations !== undefined) row.recommendations = patch.recommendations;
    if (patch.nextControlDate !== undefined) row.next_control_date = patch.nextControlDate;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.validatedAt !== undefined) row.validated_at = patch.validatedAt;
    if (patch.validatedById !== undefined) row.validated_by_id = patch.validatedById;
    if (patch.corrections !== undefined) row.corrections = patch.corrections;
    if (patch.updatedAt !== undefined) row.updated_at = patch.updatedAt;

    const { data: updated, error } = await sb
      .from('consultations')
      .update(row)
      .eq('id', id)
      .select(this.CONSULTATION_SELECT)
      .single();
    throwIfError(error, 'updateConsultation');
    return mapConsultation(updated);
  }

  // ---------------- EXAMINATIONS & RESULTS ----------------

  private readonly EXAM_SELECT =
    '*, patient:patients!examinations_patient_id_fkey(first_name, last_name, patient_number), prescribing_doctor:users!examinations_prescribing_doctor_id_fkey(title, first_name, last_name), interpreting_doctor:users!examinations_interpreting_doctor_id_fkey(title, first_name, last_name), attached_document:medical_documents!examinations_attached_document_id_fkey(original_name)';

  async listExaminations(filter?: { patientId?: string; status?: string; type?: string }): Promise<Examination[]> {
    const sb = this.getClient();
    let query = sb
      .from('examinations')
      .select(this.EXAM_SELECT)
      .order('prescription_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (filter?.patientId) query = query.eq('patient_id', filter.patientId);
    if (filter?.status) query = query.eq('status', filter.status);
    if (filter?.type) query = query.eq('type', filter.type);

    const { data, error } = await query;
    throwIfError(error, 'listExaminations');
    return (data || []).map(mapExamination);
  }

  async findExaminationById(id: string): Promise<Examination | null> {
    const sb = this.getClient();
    const { data, error } = await sb
      .from('examinations')
      .select(this.EXAM_SELECT)
      .eq('id', id)
      .maybeSingle();
    throwIfError(error, 'findExaminationById');
    return data ? mapExamination(data) : null;
  }

  async getNextExamNumber(): Promise<string> {
    const sb = this.getClient();
    const { data, error } = await sb.from('examinations').select('exam_number');
    throwIfError(error, 'getNextExamNumber');
    let max = 0;
    for (const row of data || []) {
      const m = /^EXM-(\d+)$/.exec(row.exam_number || '');
      if (m) {
        const val = parseInt(m[1], 10);
        if (val > max) max = val;
      }
    }
    return `EXM-${String(max + 1).padStart(5, '0')}`;
  }

  async createExamination(data: Omit<Examination, '_id' | '_type'>): Promise<Examination> {
    const sb = this.getClient();
    const row = {
      id: makeId('exm'),
      exam_number: data.examNumber,
      patient_id: data.patientId,
      prescribing_doctor_id: data.prescribingDoctorId,
      consultation_id: data.consultationId || null,
      prescription_date: data.prescriptionDate,
      type: data.type,
      scheduled_date: data.scheduledDate || '',
      performed_date: data.performedDate || '',
      operator_name: data.operatorName || '',
      technical_notes: data.technicalNotes || '',
      attached_document_id: data.attachedDocumentId || null,
      result_summary: data.resultSummary || '',
      report_text: data.reportText || '',
      interpreting_doctor_id: data.interpretingDoctorId || null,
      validated_at: data.validatedAt || null,
      shared_with_patient: Boolean(data.sharedWithPatient),
      status: data.status,
      is_demo: Boolean(data.isDemo),
      created_at: data.createdAt,
      updated_at: data.updatedAt,
    };
    const { data: inserted, error } = await sb.from('examinations').insert(row).select(this.EXAM_SELECT).single();
    throwIfError(error, 'createExamination');
    return mapExamination(inserted);
  }

  async updateExamination(id: string, patch: Partial<Examination>): Promise<Examination> {
    const sb = this.getClient();
    const row: Record<string, any> = {};
    if (patch.scheduledDate !== undefined) row.scheduled_date = patch.scheduledDate;
    if (patch.performedDate !== undefined) row.performed_date = patch.performedDate;
    if (patch.operatorName !== undefined) row.operator_name = patch.operatorName;
    if (patch.technicalNotes !== undefined) row.technical_notes = patch.technicalNotes;
    if (patch.attachedDocumentId !== undefined) row.attached_document_id = patch.attachedDocumentId || null;
    if (patch.resultSummary !== undefined) row.result_summary = patch.resultSummary;
    if (patch.reportText !== undefined) row.report_text = patch.reportText;
    if (patch.interpretingDoctorId !== undefined) row.interpreting_doctor_id = patch.interpretingDoctorId || null;
    if (patch.validatedAt !== undefined) row.validated_at = patch.validatedAt;
    if (patch.sharedWithPatient !== undefined) row.shared_with_patient = patch.sharedWithPatient;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.updatedAt !== undefined) row.updated_at = patch.updatedAt;

    const { data: updated, error } = await sb
      .from('examinations')
      .update(row)
      .eq('id', id)
      .select(this.EXAM_SELECT)
      .single();
    throwIfError(error, 'updateExamination');
    return mapExamination(updated);
  }

  async createExaminationResult(data: Omit<ExaminationResult, '_id' | '_type'>): Promise<ExaminationResult> {
    const sb = this.getClient();
    const row = {
      id: makeId('exres'),
      examination_id: data.examinationId,
      patient_id: data.patientId,
      measurements: data.measurements || {},
      conclusion: data.conclusion,
      report_text: data.reportText,
      interpreting_doctor_id: data.interpretingDoctorId,
      validated: data.validated,
      validated_at: data.validatedAt || null,
      shared_with_patient: data.sharedWithPatient,
      is_demo: Boolean(data.isDemo),
      created_at: data.createdAt,
      updated_at: data.updatedAt,
    };
    const { data: inserted, error } = await sb.from('examination_results').insert(row).select('*').single();
    throwIfError(error, 'createExaminationResult');
    return mapExaminationResult(inserted);
  }

  async listExaminationResults(patientId?: string): Promise<ExaminationResult[]> {
    const sb = this.getClient();
    let query = sb.from('examination_results').select('*').order('created_at', { ascending: false });
    if (patientId) query = query.eq('patient_id', patientId);
    const { data, error } = await query;
    throwIfError(error, 'listExaminationResults');
    return (data || []).map(mapExaminationResult);
  }

  // ---------------- FOLLOW-UPS ----------------

  private readonly FOLLOWUP_SELECT =
    '*, patient:patients!follow_ups_patient_id_fkey(first_name, last_name, patient_number, phone), assignee:users!follow_ups_assignee_id_fkey(first_name, last_name)';

  async listFollowUps(filter?: { patientId?: string; assigneeId?: string; status?: string }): Promise<FollowUp[]> {
    const sb = this.getClient();
    let query = sb
      .from('follow_ups')
      .select(this.FOLLOWUP_SELECT)
      .order('due_date', { ascending: true })
      .order('created_at', { ascending: false });
    if (filter?.patientId) query = query.eq('patient_id', filter.patientId);
    if (filter?.assigneeId) query = query.eq('assignee_id', filter.assigneeId);
    if (filter?.status) query = query.eq('status', filter.status);

    const { data, error } = await query;
    throwIfError(error, 'listFollowUps');
    return (data || []).map(mapFollowUp);
  }

  async findFollowUpById(id: string): Promise<FollowUp | null> {
    const sb = this.getClient();
    const { data, error } = await sb
      .from('follow_ups')
      .select(this.FOLLOWUP_SELECT)
      .eq('id', id)
      .maybeSingle();
    throwIfError(error, 'findFollowUpById');
    return data ? mapFollowUp(data) : null;
  }

  async createFollowUp(data: Omit<FollowUp, '_id' | '_type'>): Promise<FollowUp> {
    const sb = this.getClient();
    const row = {
      id: makeId('fup'),
      patient_id: data.patientId,
      consultation_id: data.consultationId || null,
      examination_id: data.examinationId || null,
      type: data.type,
      reason: data.reason,
      due_date: data.dueDate,
      assignee_id: data.assigneeId,
      priority: data.priority,
      status: data.status,
      contact_outcome: data.contactOutcome || '',
      notes: data.notes || '',
      next_action: data.nextAction || '',
      closed_at: data.closedAt || null,
      closed_by_id: data.closedById || null,
      history: data.history || [],
      is_demo: Boolean(data.isDemo),
      created_by_id: data.createdById || null,
      created_at: data.createdAt,
      updated_at: data.updatedAt,
    };
    const { data: inserted, error } = await sb
      .from('follow_ups')
      .insert(row)
      .select(this.FOLLOWUP_SELECT)
      .single();
    throwIfError(error, 'createFollowUp');
    return mapFollowUp(inserted);
  }

  async updateFollowUp(id: string, patch: Partial<FollowUp>): Promise<FollowUp> {
    const sb = this.getClient();
    const row: Record<string, any> = {};
    if (patch.dueDate !== undefined) row.due_date = patch.dueDate;
    if (patch.assigneeId !== undefined) row.assignee_id = patch.assigneeId;
    if (patch.priority !== undefined) row.priority = patch.priority;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.contactOutcome !== undefined) row.contact_outcome = patch.contactOutcome;
    if (patch.notes !== undefined) row.notes = patch.notes;
    if (patch.nextAction !== undefined) row.next_action = patch.nextAction;
    if (patch.closedAt !== undefined) row.closed_at = patch.closedAt;
    if (patch.closedById !== undefined) row.closed_by_id = patch.closedById;
    if (patch.history !== undefined) row.history = patch.history;
    if (patch.updatedAt !== undefined) row.updated_at = patch.updatedAt;

    const { data: updated, error } = await sb
      .from('follow_ups')
      .update(row)
      .eq('id', id)
      .select(this.FOLLOWUP_SELECT)
      .single();
    throwIfError(error, 'updateFollowUp');
    return mapFollowUp(updated);
  }

  // ---------------- TASKS ----------------

  private readonly TASK_SELECT =
    '*, patient:patients!tasks_patient_id_fkey(first_name, last_name), assignee:users!tasks_assignee_id_fkey(first_name, last_name)';

  async listTasks(filter?: { assigneeId?: string; status?: string; category?: string }): Promise<Task[]> {
    const sb = this.getClient();
    let query = sb
      .from('tasks')
      .select(this.TASK_SELECT)
      .order('due_date', { ascending: true })
      .order('created_at', { ascending: false });
    if (filter?.assigneeId) query = query.eq('assignee_id', filter.assigneeId);
    if (filter?.status) query = query.eq('status', filter.status);
    if (filter?.category) query = query.eq('category', filter.category);

    const { data, error } = await query;
    throwIfError(error, 'listTasks');
    return (data || []).map(mapTask);
  }

  async findTaskById(id: string): Promise<Task | null> {
    const sb = this.getClient();
    const { data, error } = await sb.from('tasks').select(this.TASK_SELECT).eq('id', id).maybeSingle();
    throwIfError(error, 'findTaskById');
    return data ? mapTask(data) : null;
  }

  async createTask(data: Omit<Task, '_id' | '_type'>): Promise<Task> {
    const sb = this.getClient();
    const row = {
      id: makeId('task'),
      title: data.title,
      description: data.description || '',
      category: data.category,
      patient_id: data.patientId || null,
      assignee_id: data.assigneeId,
      due_date: data.dueDate,
      priority: data.priority,
      status: data.status,
      history: data.history || [],
      is_demo: Boolean(data.isDemo),
      created_by_id: data.createdById || null,
      created_at: data.createdAt,
      updated_at: data.updatedAt,
    };
    const { data: inserted, error } = await sb.from('tasks').insert(row).select(this.TASK_SELECT).single();
    throwIfError(error, 'createTask');
    return mapTask(inserted);
  }

  async updateTask(id: string, patch: Partial<Task>): Promise<Task> {
    const sb = this.getClient();
    const row: Record<string, any> = {};
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.description !== undefined) row.description = patch.description;
    if (patch.category !== undefined) row.category = patch.category;
    if (patch.assigneeId !== undefined) row.assignee_id = patch.assigneeId;
    if (patch.dueDate !== undefined) row.due_date = patch.dueDate;
    if (patch.priority !== undefined) row.priority = patch.priority;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.history !== undefined) row.history = patch.history;
    if (patch.updatedAt !== undefined) row.updated_at = patch.updatedAt;

    const { data: updated, error } = await sb
      .from('tasks')
      .update(row)
      .eq('id', id)
      .select(this.TASK_SELECT)
      .single();
    throwIfError(error, 'updateTask');
    return mapTask(updated);
  }

  // ---------------- DOCUMENTS ----------------

  private readonly DOC_SELECT =
    '*, patient:patients!medical_documents_patient_id_fkey(first_name, last_name), uploaded_by:users!medical_documents_uploaded_by_id_fkey(first_name, last_name)';

  async listDocuments(filter?: { patientId?: string; category?: string; includeArchived?: boolean }): Promise<MedicalDocument[]> {
    const sb = this.getClient();
    let query = sb
      .from('medical_documents')
      .select(this.DOC_SELECT)
      .order('created_at', { ascending: false });
    if (filter?.patientId) query = query.eq('patient_id', filter.patientId);
    if (filter?.category) query = query.eq('category', filter.category);
    if (!filter?.includeArchived) query = query.eq('archived', false);

    const { data, error } = await query;
    throwIfError(error, 'listDocuments');
    return (data || []).map(mapDocument);
  }

  async findDocumentById(id: string): Promise<MedicalDocument | null> {
    const sb = this.getClient();
    const { data, error } = await sb.from('medical_documents').select(this.DOC_SELECT).eq('id', id).maybeSingle();
    throwIfError(error, 'findDocumentById');
    return data ? mapDocument(data) : null;
  }

  async createDocument(data: Omit<MedicalDocument, '_id' | '_type'>): Promise<MedicalDocument> {
    const sb = this.getClient();
    const row = {
      id: makeId('doc'),
      title: data.title,
      category: data.category,
      patient_id: data.patientId,
      consultation_id: data.consultationId || null,
      examination_id: data.examinationId || null,
      file_name: data.fileName,
      original_name: data.originalName,
      mime_type: data.mimeType,
      size_bytes: data.sizeBytes,
      storage_key: data.storageKey,
      shared_with_patient: Boolean(data.sharedWithPatient),
      archived: Boolean(data.archived),
      uploaded_by_id: data.uploadedById || null,
      is_demo: Boolean(data.isDemo),
      created_at: data.createdAt,
      updated_at: data.updatedAt,
    };
    const { data: inserted, error } = await sb
      .from('medical_documents')
      .insert(row)
      .select(this.DOC_SELECT)
      .single();
    throwIfError(error, 'createDocument');
    return mapDocument(inserted);
  }

  async updateDocument(id: string, patch: Partial<MedicalDocument>): Promise<MedicalDocument> {
    const sb = this.getClient();
    const row: Record<string, any> = {};
    if (patch.sharedWithPatient !== undefined) row.shared_with_patient = patch.sharedWithPatient;
    if (patch.archived !== undefined) row.archived = patch.archived;
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.updatedAt !== undefined) row.updated_at = patch.updatedAt;

    const { data: updated, error } = await sb
      .from('medical_documents')
      .update(row)
      .eq('id', id)
      .select(this.DOC_SELECT)
      .single();
    throwIfError(error, 'updateDocument');
    return mapDocument(updated);
  }

  // ---------------- NOTIFICATIONS ----------------

  async listNotifications(userId: string, roles: string[]): Promise<NotificationItem[]> {
    const sb = this.getClient();
    const { data, error } = await sb
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(150);
    throwIfError(error, 'listNotifications');

    const roleSet = new Set(roles);
    return (data || [])
      .map(mapNotification)
      .filter(
        (n) =>
          n.recipientUserId === userId ||
          (n.recipientRoles || []).some((r) => roleSet.has(r))
      )
      .slice(0, 50);
  }

  async createNotification(data: Omit<NotificationItem, '_id' | '_type'>): Promise<NotificationItem> {
    const sb = this.getClient();
    const row = {
      id: makeId('notif'),
      recipient_user_id: data.recipientUserId || null,
      recipient_roles: data.recipientRoles || [],
      event_type: data.eventType,
      title: data.title,
      message: data.message,
      link_module: data.linkModule || '',
      related_entity_id: data.relatedEntityId || '',
      read_by_user_ids: data.readByUserIds || [],
      channel: data.channel || 'INTERNE',
      is_demo: Boolean(data.isDemo),
      created_at: data.createdAt,
    };
    const { data: inserted, error } = await sb.from('notifications').insert(row).select('*').single();
    throwIfError(error, 'createNotification');
    return mapNotification(inserted);
  }

  async markNotificationRead(id: string, userId: string): Promise<void> {
    const sb = this.getClient();
    const { data: existing, error: fetchErr } = await sb
      .from('notifications')
      .select('read_by_user_ids')
      .eq('id', id)
      .maybeSingle();
    throwIfError(fetchErr, 'markNotificationRead:fetch');
    const nextList = Array.from(new Set([...(existing?.read_by_user_ids || []), userId]));
    const { error } = await sb.from('notifications').update({ read_by_user_ids: nextList }).eq('id', id);
    throwIfError(error, 'markNotificationRead:update');
  }

  async markAllNotificationsRead(userId: string, roles: string[]): Promise<void> {
    const notifs = await this.listNotifications(userId, roles);
    const unread = notifs.filter((n) => !n.readByUserIds.includes(userId));
    const sb = this.getClient();
    await Promise.all(
      unread.map((n) =>
        sb
          .from('notifications')
          .update({ read_by_user_ids: Array.from(new Set([...n.readByUserIds, userId])) })
          .eq('id', n._id)
      )
    );
  }

  // ---------------- EMAIL DISPATCH LOGS (RESEND) ----------------

  async listEmailDispatches(limit = 100): Promise<EmailDispatchLog[]> {
    const sb = this.getClient();
    const { data, error } = await sb
      .from('email_dispatch_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    throwIfError(error, 'listEmailDispatches');
    return (data || []).map(mapEmailDispatch);
  }

  async createEmailDispatch(data: Omit<EmailDispatchLog, '_id' | '_type'>): Promise<EmailDispatchLog> {
    const sb = this.getClient();
    const row = {
      id: makeId('mail'),
      recipient_email: data.recipientEmail,
      recipient_name: data.recipientName || '',
      subject: data.subject,
      category: data.category,
      status: data.status,
      provider: 'RESEND',
      provider_message_id: data.providerMessageId || null,
      error_message: data.errorMessage || null,
      related_entity_id: data.relatedEntityId || null,
      patient_id: data.patientId || null,
      reminder_key: data.reminderKey || null,
      created_at: data.createdAt,
    };
    const { data: inserted, error } = await sb.from('email_dispatch_logs').insert(row).select('*').single();
    throwIfError(error, 'createEmailDispatch');
    return mapEmailDispatch(inserted);
  }

  async hasReminderBeenSent(reminderKey: string): Promise<boolean> {
    const sb = this.getClient();
    const { count, error } = await sb
      .from('email_dispatch_logs')
      .select('id', { count: 'exact', head: true })
      .eq('reminder_key', reminderKey)
      .eq('status', 'SENT');
    if (error) return false;
    return (count || 0) > 0;
  }

  // ---------------- SERVICES & PAYMENTS ----------------

  async listServices(): Promise<MedicalService[]> {
    const sb = this.getClient();
    const { data, error } = await sb.from('medical_services').select('*').order('name', { ascending: true });
    throwIfError(error, 'listServices');
    return (data || []).map(mapService);
  }

  async findServiceById(id: string): Promise<MedicalService | null> {
    const sb = this.getClient();
    const { data, error } = await sb.from('medical_services').select('*').eq('id', id).maybeSingle();
    throwIfError(error, 'findServiceById');
    return data ? mapService(data) : null;
  }

  async createService(data: Omit<MedicalService, '_id' | '_type'>): Promise<MedicalService> {
    const sb = this.getClient();
    const row = {
      id: makeId('srv'),
      code: data.code,
      name: data.name,
      category: data.category,
      price_fcfa: data.priceFcfa,
      active: data.active,
      description: data.description || '',
      is_demo: Boolean(data.isDemo),
      created_at: data.createdAt,
      updated_at: data.updatedAt,
    };
    const { data: inserted, error } = await sb.from('medical_services').insert(row).select('*').single();
    throwIfError(error, 'createService');
    return mapService(inserted);
  }

  async updateService(id: string, patch: Partial<MedicalService>): Promise<MedicalService> {
    const sb = this.getClient();
    const row: Record<string, any> = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.category !== undefined) row.category = patch.category;
    if (patch.priceFcfa !== undefined) row.price_fcfa = patch.priceFcfa;
    if (patch.active !== undefined) row.active = patch.active;
    if (patch.description !== undefined) row.description = patch.description;
    if (patch.updatedAt !== undefined) row.updated_at = patch.updatedAt;

    const { data: updated, error } = await sb.from('medical_services').update(row).eq('id', id).select('*').single();
    throwIfError(error, 'updateService');
    return mapService(updated);
  }

  private readonly PAYMENT_SELECT =
    '*, patient:patients!payments_patient_id_fkey(first_name, last_name, patient_number), recorded_by:users!payments_recorded_by_id_fkey(first_name, last_name)';

  async listPayments(filter?: { startDate?: string; endDate?: string; patientId?: string }): Promise<Payment[]> {
    const sb = this.getClient();
    let query = sb
      .from('payments')
      .select(this.PAYMENT_SELECT)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });
    if (filter?.patientId) query = query.eq('patient_id', filter.patientId);
    if (filter?.startDate) query = query.gte('date', filter.startDate);
    if (filter?.endDate) query = query.lte('date', filter.endDate);

    const { data, error } = await query;
    throwIfError(error, 'listPayments');
    return (data || []).map(mapPayment);
  }

  async findPaymentById(id: string): Promise<Payment | null> {
    const sb = this.getClient();
    const { data, error } = await sb.from('payments').select(this.PAYMENT_SELECT).eq('id', id).maybeSingle();
    throwIfError(error, 'findPaymentById');
    return data ? mapPayment(data) : null;
  }

  async getNextReceiptNumber(): Promise<string> {
    const sb = this.getClient();
    const { data, error } = await sb.from('payments').select('receipt_number');
    throwIfError(error, 'getNextReceiptNumber');
    let max = 0;
    for (const row of data || []) {
      const m = /^REC-(\d+)$/.exec(row.receipt_number || '');
      if (m) {
        const val = parseInt(m[1], 10);
        if (val > max) max = val;
      }
    }
    return `REC-${String(max + 1).padStart(5, '0')}`;
  }

  async createPayment(data: Omit<Payment, '_id' | '_type'>): Promise<Payment> {
    const sb = this.getClient();
    const row = {
      id: makeId('pay'),
      receipt_number: data.receiptNumber,
      patient_id: data.patientId,
      service_id: data.serviceId || null,
      service_name: data.serviceName,
      total_amount_fcfa: data.totalAmountFcfa,
      amount_paid_fcfa: data.amountPaidFcfa,
      remaining_balance_fcfa: data.remainingBalanceFcfa,
      status: data.status,
      method: data.method,
      date: data.date,
      notes: data.notes || '',
      recorded_by_id: data.recordedById || null,
      is_demo: Boolean(data.isDemo),
      created_at: data.createdAt,
      updated_at: data.updatedAt,
    };
    const { data: inserted, error } = await sb.from('payments').insert(row).select(this.PAYMENT_SELECT).single();
    throwIfError(error, 'createPayment');
    return mapPayment(inserted);
  }

  async updatePayment(id: string, patch: Partial<Payment>): Promise<Payment> {
    const sb = this.getClient();
    const row: Record<string, any> = {};
    if (patch.amountPaidFcfa !== undefined) row.amount_paid_fcfa = patch.amountPaidFcfa;
    if (patch.remainingBalanceFcfa !== undefined) row.remaining_balance_fcfa = patch.remainingBalanceFcfa;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.method !== undefined) row.method = patch.method;
    if (patch.notes !== undefined) row.notes = patch.notes;
    if (patch.updatedAt !== undefined) row.updated_at = patch.updatedAt;

    const { data: updated, error } = await sb
      .from('payments')
      .update(row)
      .eq('id', id)
      .select(this.PAYMENT_SELECT)
      .single();
    throwIfError(error, 'updatePayment');
    return mapPayment(updated);
  }

  // ---------------- AUDIT LOGS (APPEND-ONLY) ----------------

  async listAuditLogs(limit = 200): Promise<AuditLog[]> {
    const sb = this.getClient();
    const { data, error } = await sb
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    throwIfError(error, 'listAuditLogs');
    return (data || []).map(mapAuditLog);
  }

  async listAllAuditLogs(severity?: string): Promise<AuditLog[]> {
    const sb = this.getClient();
    let query = sb.from('audit_logs').select('*').order('created_at', { ascending: false });
    if (severity && severity !== 'ALL') {
      query = query.eq('severity', severity);
    }
    const { data, error } = await query;
    throwIfError(error, 'listAllAuditLogs');
    return (data || []).map(mapAuditLog);
  }

  async appendAuditLog(data: Omit<AuditLog, '_id' | '_type'>): Promise<AuditLog> {
    const sb = this.getClient();
    const row = {
      id: makeId('audit'),
      actor_user_id: data.actorUserId || null,
      actor_name: data.actorName,
      actor_roles: data.actorRoles || [],
      action: data.action,
      resource_type: data.resourceType,
      resource_id: data.resourceId || null,
      severity: data.severity,
      details: data.details,
      ip_address: data.ipAddress || null,
      created_at: data.createdAt,
    };
    const { data: inserted, error } = await sb.from('audit_logs').insert(row).select('*').single();
    throwIfError(error, 'appendAuditLog');
    return mapAuditLog(inserted);
  }
}

export const repository: DataRepository = new SupabaseRepository();
