-- ============================================================================
-- CARDIO ERP — Schéma PostgreSQL relationnel complet + Row Level Security (RLS)
-- Exécuter ce script une seule fois dans Supabase -> SQL Editor
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. TABLES PRINCIPALES & RELATIONS
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.roles (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE CHECK (code IN ('ADMIN', 'MEDECIN', 'ACCUEIL', 'PATIENT')),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  permissions TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.clinic_settings (
  id TEXT PRIMARY KEY DEFAULT 'clinic-settings-main',
  clinic_name TEXT NOT NULL,
  lead_doctor_name TEXT NOT NULL,
  specialty TEXT NOT NULL,
  city TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  address TEXT NOT NULL,
  slogan TEXT NOT NULL DEFAULT '',
  logo_storage_key TEXT,
  notification_channels JSONB NOT NULL DEFAULT '{"smsEnabled":false,"whatsappEnabled":false,"emailEnabled":true,"autoRemindersEnabled":true,"appointmentReminderHoursBefore":24,"neverSendSensitiveMedicalData":true}'::jsonb,
  archiving_policy_years INTEGER NOT NULL DEFAULT 20,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.patients (
  id TEXT PRIMARY KEY,
  patient_number TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('M', 'F')),
  birth_date DATE NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  profession TEXT NOT NULL DEFAULT '',
  emergency_contact_name TEXT NOT NULL DEFAULT '',
  emergency_contact_phone TEXT NOT NULL DEFAULT '',
  blood_group TEXT NOT NULL DEFAULT '',
  medical_alerts TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'ACTIF' CHECK (status IN ('ACTIF', 'ARCHIVE')),
  portal_invited BOOLEAN NOT NULL DEFAULT FALSE,
  portal_activated BOOLEAN NOT NULL DEFAULT FALSE,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  auth_uid UUID UNIQUE, -- Optionnel : lien direct avec Supabase Auth (auth.uid()) pour RLS côté client
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  specialty TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  roles TEXT[] NOT NULL DEFAULT '{ACCUEIL}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  patient_id TEXT REFERENCES public.patients(id) ON DELETE SET NULL,
  password_hash TEXT,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Relier patients.created_by_id -> users.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'patients_created_by_id_fkey'
  ) THEN
    ALTER TABLE public.patients
      ADD CONSTRAINT patients_created_by_id_fkey
      FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.medical_records (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL UNIQUE REFERENCES public.patients(id) ON DELETE CASCADE,
  summary TEXT NOT NULL DEFAULT '',
  risk_factors TEXT[] NOT NULL DEFAULT '{}',
  primary_doctor_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  last_consultation_at TIMESTAMPTZ,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.medical_histories (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('CARDIOVASCULAIRE', 'CHIRURGICAL', 'FAMILIAL', 'AUTRE')),
  title TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  diagnosed_year TEXT NOT NULL DEFAULT '',
  author_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.allergies (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  allergen TEXT NOT NULL,
  reaction TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL CHECK (severity IN ('LEGERE', 'MODEREE', 'SEVERE')),
  author_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.medications (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  dosage TEXT NOT NULL,
  frequency TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  prescribed_by_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.appointments (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  date DATE NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'EN_ATTENTE',
  reason TEXT NOT NULL,
  admin_priority TEXT NOT NULL DEFAULT 'NORMALE',
  urgency_validated_by_health_pro BOOLEAN NOT NULL DEFAULT FALSE,
  urgency_validated_by_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  urgency_validated_at TIMESTAMPTZ,
  queue_number INTEGER,
  arrived_at TIMESTAMPTZ,
  consultation_started_at TIMESTAMPTZ,
  consultation_ended_at TIMESTAMPTZ,
  requested_by_patient BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT NOT NULL DEFAULT '',
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.consultations (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  appointment_id TEXT REFERENCES public.appointments(id) ON DELETE SET NULL,
  date DATE NOT NULL,
  time TEXT NOT NULL,
  reason TEXT NOT NULL,
  illness_history TEXT NOT NULL DEFAULT '',
  symptoms TEXT NOT NULL DEFAULT '',
  relevant_history TEXT NOT NULL DEFAULT '',
  clinical_exam TEXT NOT NULL DEFAULT '',
  vitals JSONB NOT NULL DEFAULT '{}'::jsonb,
  observations TEXT NOT NULL DEFAULT '',
  diagnostic_hypotheses TEXT NOT NULL DEFAULT '',
  confirmed_diagnosis TEXT NOT NULL DEFAULT '',
  prescribed_exams TEXT[] NOT NULL DEFAULT '{}',
  treatments_text TEXT NOT NULL DEFAULT '',
  prescription_lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommendations TEXT NOT NULL DEFAULT '',
  next_control_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'BROUILLON' CHECK (status IN ('BROUILLON', 'VALIDEE')),
  validated_at TIMESTAMPTZ,
  validated_by_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  corrections JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.vital_signs (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  consultation_id TEXT REFERENCES public.consultations(id) ON DELETE SET NULL,
  systolic_bp NUMERIC,
  diastolic_bp NUMERIC,
  heart_rate NUMERIC,
  temperature NUMERIC,
  oxygen_saturation NUMERIC,
  weight NUMERIC,
  height NUMERIC,
  bmi NUMERIC,
  respiratory_rate NUMERIC,
  recorded_by_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.diagnoses (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  consultation_id TEXT NOT NULL REFERENCES public.consultations(id) ON DELETE CASCADE,
  code TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('HYPOTHESE', 'RETENU')),
  author_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.prescriptions (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  consultation_id TEXT REFERENCES public.consultations(id) ON DELETE SET NULL,
  doctor_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  date DATE NOT NULL,
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT NOT NULL DEFAULT '',
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.examinations (
  id TEXT PRIMARY KEY,
  exam_number TEXT NOT NULL UNIQUE,
  patient_id TEXT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  prescribing_doctor_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  consultation_id TEXT REFERENCES public.consultations(id) ON DELETE SET NULL,
  prescription_date DATE NOT NULL,
  type TEXT NOT NULL,
  scheduled_date TEXT NOT NULL DEFAULT '',
  performed_date TEXT NOT NULL DEFAULT '',
  operator_name TEXT NOT NULL DEFAULT '',
  technical_notes TEXT NOT NULL DEFAULT '',
  attached_document_id TEXT,
  result_summary TEXT NOT NULL DEFAULT '',
  report_text TEXT NOT NULL DEFAULT '',
  interpreting_doctor_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  validated_at TIMESTAMPTZ,
  shared_with_patient BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'PRESCRIT',
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.medical_documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  patient_id TEXT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  consultation_id TEXT REFERENCES public.consultations(id) ON DELETE SET NULL,
  examination_id TEXT REFERENCES public.examinations(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  storage_key TEXT NOT NULL, -- Clé objet Cloudflare R2 (ex: documents/pat-.../uuid.pdf)
  shared_with_patient BOOLEAN NOT NULL DEFAULT FALSE,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  uploaded_by_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'examinations_attached_document_id_fkey'
  ) THEN
    ALTER TABLE public.examinations
      ADD CONSTRAINT examinations_attached_document_id_fkey
      FOREIGN KEY (attached_document_id) REFERENCES public.medical_documents(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.examination_results (
  id TEXT PRIMARY KEY,
  examination_id TEXT NOT NULL REFERENCES public.examinations(id) ON DELETE CASCADE,
  patient_id TEXT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  measurements JSONB NOT NULL DEFAULT '{}'::jsonb,
  conclusion TEXT NOT NULL,
  report_text TEXT NOT NULL,
  interpreting_doctor_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  validated BOOLEAN NOT NULL DEFAULT FALSE,
  validated_at TIMESTAMPTZ,
  shared_with_patient BOOLEAN NOT NULL DEFAULT FALSE,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.follow_ups (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  consultation_id TEXT REFERENCES public.consultations(id) ON DELETE SET NULL,
  examination_id TEXT REFERENCES public.examinations(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  reason TEXT NOT NULL,
  due_date DATE NOT NULL,
  assignee_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  priority TEXT NOT NULL DEFAULT 'NORMALE',
  status TEXT NOT NULL DEFAULT 'A_EFFECTUER',
  contact_outcome TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  next_action TEXT NOT NULL DEFAULT '',
  closed_at TIMESTAMPTZ,
  closed_by_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  history JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  patient_id TEXT REFERENCES public.patients(id) ON DELETE SET NULL,
  assignee_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  due_date DATE NOT NULL,
  priority TEXT NOT NULL DEFAULT 'NORMALE',
  status TEXT NOT NULL DEFAULT 'A_FAIRE',
  history JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id TEXT PRIMARY KEY,
  recipient_user_id TEXT REFERENCES public.users(id) ON DELETE CASCADE,
  recipient_roles TEXT[] NOT NULL DEFAULT '{}',
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link_module TEXT NOT NULL DEFAULT '',
  related_entity_id TEXT NOT NULL DEFAULT '',
  read_by_user_ids TEXT[] NOT NULL DEFAULT '{}',
  channel TEXT NOT NULL DEFAULT 'INTERNE',
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.medical_services (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price_fcfa NUMERIC,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  description TEXT NOT NULL DEFAULT '',
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.payments (
  id TEXT PRIMARY KEY,
  receipt_number TEXT NOT NULL UNIQUE,
  patient_id TEXT NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  service_id TEXT REFERENCES public.medical_services(id) ON DELETE SET NULL,
  service_name TEXT NOT NULL,
  total_amount_fcfa NUMERIC NOT NULL,
  amount_paid_fcfa NUMERIC NOT NULL,
  remaining_balance_fcfa NUMERIC NOT NULL,
  status TEXT NOT NULL,
  method TEXT NOT NULL,
  date DATE NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  recorded_by_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  actor_name TEXT NOT NULL,
  actor_roles TEXT[] NOT NULL DEFAULT '{}',
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  severity TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'SECURITY')),
  details TEXT NOT NULL,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.email_dispatch_logs (
  id TEXT PRIMARY KEY,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SENT', 'FAILED', 'SKIPPED')),
  provider TEXT NOT NULL DEFAULT 'RESEND',
  provider_message_id TEXT,
  error_message TEXT,
  related_entity_id TEXT,
  patient_id TEXT REFERENCES public.patients(id) ON DELETE SET NULL,
  reminder_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 2. INDEXES DE PERFORMANCE
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_patients_status ON public.patients(status);
CREATE INDEX IF NOT EXISTS idx_patients_last_name ON public.patients(LOWER(last_name));
CREATE INDEX IF NOT EXISTS idx_appointments_date_doctor ON public.appointments(date, doctor_id);
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON public.appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_consultations_patient ON public.consultations(patient_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_examinations_patient_status ON public.examinations(patient_id, status);
CREATE INDEX IF NOT EXISTS idx_follow_ups_due_status ON public.follow_ups(due_date, status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_status ON public.tasks(due_date, status);
CREATE INDEX IF NOT EXISTS idx_documents_patient ON public.medical_documents(patient_id, archived);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON public.notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_date_patient ON public.payments(date DESC, patient_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_dispatch_reminder_key ON public.email_dispatch_logs(reminder_key) WHERE reminder_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_dispatch_created ON public.email_dispatch_logs(created_at DESC);

-- ----------------------------------------------------------------------------
-- 3. IMMUTABILITÉ DU JOURNAL D'AUDIT (APPEND-ONLY)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_audit_log_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Les entrées du journal d''audit sont immuables (append-only).';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_no_update ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_no_update
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_mutation();

-- ----------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY (RLS) STRICT PAR RÔLE MÉDICAL / ADMINISTRATIF / PATIENT
-- ----------------------------------------------------------------------------

-- Fonctions d'aide RLS basées sur auth.uid() (Supabase Auth JWT) ou claim personnalisé
CREATE OR REPLACE FUNCTION public.cardio_current_user_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.users
  WHERE is_active = TRUE
    AND (auth_uid = auth.uid() OR id = (auth.jwt() ->> 'app_user_id'))
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.cardio_has_role(target_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE is_active = TRUE
      AND (auth_uid = auth.uid() OR id = (auth.jwt() ->> 'app_user_id'))
      AND target_role = ANY(roles)
  );
$$;

CREATE OR REPLACE FUNCTION public.cardio_is_staff()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.cardio_has_role('ADMIN')
      OR public.cardio_has_role('MEDECIN')
      OR public.cardio_has_role('ACCUEIL');
$$;

CREATE OR REPLACE FUNCTION public.cardio_current_patient_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT patient_id FROM public.users
  WHERE is_active = TRUE
    AND (auth_uid = auth.uid() OR id = (auth.jwt() ->> 'app_user_id'))
  LIMIT 1;
$$;

-- Activer RLS sur les 23 tables (refus total par défaut pour anon et utilisateurs non autorisés)
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medical_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medical_histories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allergies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vital_signs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnoses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.examinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.examination_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medical_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medical_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_dispatch_logs ENABLE ROW LEVEL SECURITY;

-- Policies : Roles & Clinic Settings
DROP POLICY IF EXISTS roles_staff_read ON public.roles;
CREATE POLICY roles_staff_read ON public.roles FOR SELECT TO authenticated USING (public.cardio_is_staff());
DROP POLICY IF EXISTS roles_admin_write ON public.roles;
CREATE POLICY roles_admin_write ON public.roles FOR ALL TO authenticated USING (public.cardio_has_role('ADMIN')) WITH CHECK (public.cardio_has_role('ADMIN'));

DROP POLICY IF EXISTS settings_auth_read ON public.clinic_settings;
CREATE POLICY settings_auth_read ON public.clinic_settings FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS settings_admin_write ON public.clinic_settings;
CREATE POLICY settings_admin_write ON public.clinic_settings FOR ALL TO authenticated USING (public.cardio_has_role('ADMIN')) WITH CHECK (public.cardio_has_role('ADMIN'));

-- Policies : Users
DROP POLICY IF EXISTS users_read_self_or_staff ON public.users;
CREATE POLICY users_read_self_or_staff ON public.users FOR SELECT TO authenticated
  USING (id = public.cardio_current_user_id() OR public.cardio_is_staff());
DROP POLICY IF EXISTS users_admin_write ON public.users;
CREATE POLICY users_admin_write ON public.users FOR ALL TO authenticated
  USING (public.cardio_has_role('ADMIN')) WITH CHECK (public.cardio_has_role('ADMIN'));

-- Policies : Patients (Personnel ou dossier du patient connecté uniquement)
DROP POLICY IF EXISTS patients_select_policy ON public.patients;
CREATE POLICY patients_select_policy ON public.patients FOR SELECT TO authenticated
  USING (public.cardio_is_staff() OR id = public.cardio_current_patient_id());
DROP POLICY IF EXISTS patients_staff_insert ON public.patients;
CREATE POLICY patients_staff_insert ON public.patients FOR INSERT TO authenticated
  WITH CHECK (public.cardio_is_staff());
DROP POLICY IF EXISTS patients_update_policy ON public.patients;
CREATE POLICY patients_update_policy ON public.patients FOR UPDATE TO authenticated
  USING (public.cardio_is_staff() OR id = public.cardio_current_patient_id())
  WITH CHECK (public.cardio_is_staff() OR id = public.cardio_current_patient_id());

-- Policies : DONNÉES CLINIQUES STRICTEMENT RÉSERVÉES AU MÉDECIN (Secret médical)
DROP POLICY IF EXISTS medical_records_medecin_only ON public.medical_records;
CREATE POLICY medical_records_medecin_only ON public.medical_records FOR ALL TO authenticated
  USING (public.cardio_has_role('MEDECIN')) WITH CHECK (public.cardio_has_role('MEDECIN'));

DROP POLICY IF EXISTS medical_histories_medecin_only ON public.medical_histories;
CREATE POLICY medical_histories_medecin_only ON public.medical_histories FOR ALL TO authenticated
  USING (public.cardio_has_role('MEDECIN')) WITH CHECK (public.cardio_has_role('MEDECIN'));

DROP POLICY IF EXISTS allergies_medecin_only ON public.allergies;
CREATE POLICY allergies_medecin_only ON public.allergies FOR ALL TO authenticated
  USING (public.cardio_has_role('MEDECIN')) WITH CHECK (public.cardio_has_role('MEDECIN'));

DROP POLICY IF EXISTS medications_medecin_only ON public.medications;
CREATE POLICY medications_medecin_only ON public.medications FOR ALL TO authenticated
  USING (public.cardio_has_role('MEDECIN')) WITH CHECK (public.cardio_has_role('MEDECIN'));

DROP POLICY IF EXISTS consultations_medecin_only ON public.consultations;
CREATE POLICY consultations_medecin_only ON public.consultations FOR ALL TO authenticated
  USING (public.cardio_has_role('MEDECIN')) WITH CHECK (public.cardio_has_role('MEDECIN'));

DROP POLICY IF EXISTS vital_signs_medecin_only ON public.vital_signs;
CREATE POLICY vital_signs_medecin_only ON public.vital_signs FOR ALL TO authenticated
  USING (public.cardio_has_role('MEDECIN')) WITH CHECK (public.cardio_has_role('MEDECIN'));

DROP POLICY IF EXISTS diagnoses_medecin_only ON public.diagnoses;
CREATE POLICY diagnoses_medecin_only ON public.diagnoses FOR ALL TO authenticated
  USING (public.cardio_has_role('MEDECIN')) WITH CHECK (public.cardio_has_role('MEDECIN'));

DROP POLICY IF EXISTS prescriptions_medecin_only ON public.prescriptions;
CREATE POLICY prescriptions_medecin_only ON public.prescriptions FOR ALL TO authenticated
  USING (public.cardio_has_role('MEDECIN')) WITH CHECK (public.cardio_has_role('MEDECIN'));

-- Policies : Rendez-vous
DROP POLICY IF EXISTS appointments_select_policy ON public.appointments;
CREATE POLICY appointments_select_policy ON public.appointments FOR SELECT TO authenticated
  USING (public.cardio_is_staff() OR patient_id = public.cardio_current_patient_id());
DROP POLICY IF EXISTS appointments_insert_policy ON public.appointments;
CREATE POLICY appointments_insert_policy ON public.appointments FOR INSERT TO authenticated
  WITH CHECK (public.cardio_is_staff() OR patient_id = public.cardio_current_patient_id());
DROP POLICY IF EXISTS appointments_staff_modify ON public.appointments;
CREATE POLICY appointments_staff_modify ON public.appointments FOR UPDATE TO authenticated
  USING (public.cardio_is_staff()) WITH CHECK (public.cardio_is_staff());

-- Policies : Examens & Résultats (Patients uniquement si VALIDE + shared_with_patient)
DROP POLICY IF EXISTS examinations_select_policy ON public.examinations;
CREATE POLICY examinations_select_policy ON public.examinations FOR SELECT TO authenticated
  USING (
    public.cardio_is_staff()
    OR (patient_id = public.cardio_current_patient_id() AND status = 'VALIDE' AND shared_with_patient = TRUE)
  );
DROP POLICY IF EXISTS examinations_staff_write ON public.examinations;
CREATE POLICY examinations_staff_write ON public.examinations FOR ALL TO authenticated
  USING (public.cardio_has_role('MEDECIN') OR public.cardio_has_role('ACCUEIL'))
  WITH CHECK (public.cardio_has_role('MEDECIN') OR public.cardio_has_role('ACCUEIL'));

DROP POLICY IF EXISTS exam_results_select_policy ON public.examination_results;
CREATE POLICY exam_results_select_policy ON public.examination_results FOR SELECT TO authenticated
  USING (
    public.cardio_has_role('MEDECIN')
    OR (patient_id = public.cardio_current_patient_id() AND validated = TRUE AND shared_with_patient = TRUE)
  );
DROP POLICY IF EXISTS exam_results_medecin_write ON public.examination_results;
CREATE POLICY exam_results_medecin_write ON public.examination_results FOR ALL TO authenticated
  USING (public.cardio_has_role('MEDECIN')) WITH CHECK (public.cardio_has_role('MEDECIN'));

-- Policies : Documents médicaux (Patients uniquement si shared_with_patient)
DROP POLICY IF EXISTS documents_select_policy ON public.medical_documents;
CREATE POLICY documents_select_policy ON public.medical_documents FOR SELECT TO authenticated
  USING (
    public.cardio_has_role('MEDECIN')
    OR (public.cardio_is_staff() AND (shared_with_patient = TRUE OR category IN ('COURRIER_MEDICAL', 'AUTRE')))
    OR (patient_id = public.cardio_current_patient_id() AND shared_with_patient = TRUE AND archived = FALSE)
  );
DROP POLICY IF EXISTS documents_staff_write ON public.medical_documents;
CREATE POLICY documents_staff_write ON public.medical_documents FOR ALL TO authenticated
  USING (public.cardio_is_staff()) WITH CHECK (public.cardio_is_staff());

-- Policies : Suivis & Tâches
DROP POLICY IF EXISTS follow_ups_select_policy ON public.follow_ups;
CREATE POLICY follow_ups_select_policy ON public.follow_ups FOR SELECT TO authenticated
  USING (
    public.cardio_is_staff()
    OR (patient_id = public.cardio_current_patient_id() AND type IN ('CONTROLE_MEDICAL', 'RENDEZ_VOUS_SUIVI'))
  );
DROP POLICY IF EXISTS follow_ups_staff_write ON public.follow_ups;
CREATE POLICY follow_ups_staff_write ON public.follow_ups FOR ALL TO authenticated
  USING (public.cardio_is_staff()) WITH CHECK (public.cardio_is_staff());

DROP POLICY IF EXISTS tasks_staff_all ON public.tasks;
CREATE POLICY tasks_staff_all ON public.tasks FOR ALL TO authenticated
  USING (public.cardio_is_staff()) WITH CHECK (public.cardio_is_staff());

-- Policies : Notifications
DROP POLICY IF EXISTS notifications_select_policy ON public.notifications;
CREATE POLICY notifications_select_policy ON public.notifications FOR SELECT TO authenticated
  USING (
    recipient_user_id = public.cardio_current_user_id()
    OR EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = public.cardio_current_user_id()
        AND u.roles && recipient_roles
    )
  );
DROP POLICY IF EXISTS notifications_staff_write ON public.notifications;
CREATE POLICY notifications_staff_write ON public.notifications FOR ALL TO authenticated
  USING (public.cardio_is_staff() OR recipient_user_id = public.cardio_current_user_id())
  WITH CHECK (public.cardio_is_staff() OR recipient_user_id = public.cardio_current_user_id());

-- Policies : Prestations & Paiements
DROP POLICY IF EXISTS services_staff_read ON public.medical_services;
CREATE POLICY services_staff_read ON public.medical_services FOR SELECT TO authenticated USING (public.cardio_is_staff());
DROP POLICY IF EXISTS services_admin_write ON public.medical_services;
CREATE POLICY services_admin_write ON public.medical_services FOR ALL TO authenticated
  USING (public.cardio_has_role('ADMIN')) WITH CHECK (public.cardio_has_role('ADMIN'));

DROP POLICY IF EXISTS payments_staff_all ON public.payments;
CREATE POLICY payments_staff_all ON public.payments FOR ALL TO authenticated
  USING (public.cardio_is_staff()) WITH CHECK (public.cardio_is_staff());

-- Policies : Audit Logs (Append-only : lecture ADMIN/MEDECIN, insertion autorisée, aucune modification/suppression)
DROP POLICY IF EXISTS audit_logs_read ON public.audit_logs;
CREATE POLICY audit_logs_read ON public.audit_logs FOR SELECT TO authenticated
  USING (public.cardio_has_role('ADMIN') OR public.cardio_has_role('MEDECIN'));
DROP POLICY IF EXISTS audit_logs_insert ON public.audit_logs;
CREATE POLICY audit_logs_insert ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (TRUE);

-- Policies : Journal d'envois E-mail Resend
DROP POLICY IF EXISTS email_dispatch_staff_read ON public.email_dispatch_logs;
CREATE POLICY email_dispatch_staff_read ON public.email_dispatch_logs FOR SELECT TO authenticated
  USING (public.cardio_is_staff());
DROP POLICY IF EXISTS email_dispatch_staff_insert ON public.email_dispatch_logs;
CREATE POLICY email_dispatch_staff_insert ON public.email_dispatch_logs FOR INSERT TO authenticated
  WITH CHECK (public.cardio_is_staff());
