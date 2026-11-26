import type {
  AppointmentStatus,
  AppointmentType,
  DocumentCategory,
  ExaminationStatus,
  ExaminationType,
  FollowUpStatus,
  FollowUpType,
  Permission,
  PriorityLevel,
  RoleCode,
  TaskCategory,
  TaskStatus,
} from './types';

export const CLINIC_DEFAULTS = {
  clinicName: 'Cabinet Médical de Cardiologie Paris 16',
  appName: 'CARDIO ERP',
  leadDoctorName: 'Dr Annick TCHAM',
  specialty: 'Cardiologie',
  city: 'Bonapriso, Douala, Cameroun',
  phone: '+237 693 44 78 10',
  email: 'cmc.annicktcham@gmail.com',
  address: "Fin rue pavée de l'École publique de Bonapriso, groupe 1",
  slogan: 'La Santé, Notre Priorité – Le Professionnalisme, Notre Obligation',
};

export const ROLE_LABELS: Record<RoleCode, string> = {
  ADMIN: 'Administrateur',
  MEDECIN: 'Médecin / Docteur',
  ACCUEIL: 'Accueil / Secrétariat',
  PATIENT: 'Patient',
};

export const ROLE_PERMISSIONS: Record<RoleCode, Permission[]> = {
  ADMIN: [
    'users:manage',
    'settings:manage',
    'audit:read',
    'services:manage',
    'payments:read',
    'payments:write',
    'patients:read_admin',
    'patients:write_admin',
    'patients:archive',
    'appointments:read',
    'appointments:write',
    'followups:read',
    'followups:write_admin',
    'tasks:read',
    'tasks:write',
    'documents:read_admin',
    'statistics:read_admin',
  ],
  MEDECIN: [
    'patients:read_admin',
    'patients:write_admin',
    'medical:read',
    'medical:write',
    'consultations:read',
    'consultations:write',
    'consultations:validate',
    'examinations:read',
    'examinations:prescribe',
    'examinations:operate',
    'examinations:validate',
    'appointments:read',
    'appointments:write',
    'queue:manage',
    'followups:read',
    'followups:write_admin',
    'followups:write_medical',
    'tasks:read',
    'tasks:write',
    'documents:read_admin',
    'documents:read_medical',
    'documents:write',
    'statistics:read_medical',
  ],
  ACCUEIL: [
    'patients:read_admin',
    'patients:write_admin',
    'appointments:read',
    'appointments:write',
    'queue:manage',
    'followups:read',
    'followups:write_admin',
    'tasks:read',
    'tasks:write',
    'documents:read_admin',
    'documents:write',
    'payments:read',
    'payments:write',
    'examinations:read',
  ],
  PATIENT: ['portal:access'],
};

export const APPOINTMENT_TYPE_LABELS: Record<AppointmentType, string> = {
  PREMIERE_CONSULTATION: 'Première consultation',
  CONSULTATION_SUIVI: 'Consultation de suivi',
  CONSULTATION_CONTROLE: 'Consultation de contrôle',
  CONSULTATION_URGENTE: 'Consultation urgente',
  ECG: 'ECG',
  HOLTER_ECG: 'Holter ECG',
  MAPA: 'MAPA',
  ECHOCARDIOGRAPHIE_DOPPLER: 'Échocardiographie Doppler',
  ECHOGRAPHIE_TRANS_OESOPHAGIENNE: 'Échographie trans-œsophagienne',
  ECHO_DOPPLER_VASCULAIRE: 'Écho-Doppler vasculaire',
  EPREUVE_EFFORT: "Épreuve d'effort",
  POLYGRAPHIE_VENTILATOIRE: 'Polygraphie ventilatoire',
};

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  EN_ATTENTE: 'En attente',
  CONFIRME: 'Confirmé',
  PATIENT_ARRIVE: 'Patient arrivé',
  EN_ATTENTE_CONSULTATION: 'En attente de consultation',
  EN_CONSULTATION: 'En consultation',
  TERMINE: 'Terminé',
  ANNULE: 'Annulé',
  ABSENT: 'Absent',
};

export const EXAMINATION_TYPE_LABELS: Record<ExaminationType, string> = {
  ECG: 'ECG',
  HOLTER_ECG: 'Holter ECG',
  HOLTER_MAPA: 'Holter tensionnel MAPA',
  ECHOCARDIOGRAPHIE_DOPPLER: 'Échocardiographie Doppler',
  ECHOGRAPHIE_TRANS_OESOPHAGIENNE: 'Échographie trans-œsophagienne',
  ECHO_DOPPLER_VASCULAIRE: 'Écho-Doppler vasculaire',
  EPREUVE_EFFORT: "Épreuve d'effort",
  POLYGRAPHIE_VENTILATOIRE: 'Polygraphie ventilatoire',
};

export const EXAMINATION_STATUS_LABELS: Record<ExaminationStatus, string> = {
  PRESCRIT: 'Prescrit',
  PROGRAMME: 'Programmé',
  EN_COURS: 'En cours',
  REALISE: 'Réalisé',
  RESULTAT_DISPONIBLE: 'Résultat disponible',
  A_INTERPRETER: 'À interpréter',
  VALIDE: 'Validé',
  ANNULE: 'Annulé',
};

export const FOLLOWUP_TYPE_LABELS: Record<FollowUpType, string> = {
  APPEL_TELEPHONIQUE: 'Appel téléphonique',
  CONTROLE_MEDICAL: 'Contrôle médical',
  RESULTAT_EXAMEN: "Résultat d'examen",
  EXAMEN_COMPLEMENTAIRE: 'Examen complémentaire',
  SURVEILLANCE: 'Surveillance',
  RENDEZ_VOUS_SUIVI: 'Rendez-vous de suivi',
  RELANCE_ADMINISTRATIVE: 'Relance administrative',
};

export const FOLLOWUP_STATUS_LABELS: Record<FollowUpStatus, string> = {
  A_EFFECTUER: 'À effectuer',
  EN_COURS: 'En cours',
  PATIENT_CONTACTE: 'Patient contacté',
  PATIENT_INJOIGNABLE: 'Patient injoignable',
  REPORTE: 'Reporté',
  TERMINE: 'Terminé',
  ANNULE: 'Annulé',
};

export const TASK_CATEGORY_LABELS: Record<TaskCategory, string> = {
  ACCUEIL: 'Accueil',
  ADMINISTRATION: 'Administration',
  CONSULTATION: 'Consultation',
  EXAMENS: 'Examens',
  SUIVI: 'Suivi',
  DOCUMENTS: 'Documents',
  AUTRES: 'Autres',
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  A_FAIRE: 'À faire',
  EN_COURS: 'En cours',
  EN_ATTENTE: 'En attente',
  TERMINEE: 'Terminée',
  ANNULEE: 'Annulée',
};

export const PRIORITY_LABELS: Record<PriorityLevel, string> = {
  BASSE: 'Basse',
  NORMALE: 'Normale',
  HAUTE: 'Haute',
  CRITIQUE: 'Critique',
};

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  COMPTE_RENDU: 'Compte rendu',
  RESULTAT_ECG: 'Résultat ECG',
  RESULTAT_HOLTER: 'Résultat Holter',
  RESULTAT_MAPA: 'Résultat MAPA',
  RESULTAT_ECHOGRAPHIQUE: 'Résultat échographique',
  PRESCRIPTION: 'Prescription',
  ORDONNANCE: 'Ordonnance',
  COURRIER_MEDICAL: 'Courrier médical',
  AUTRE: 'Autre document',
};
