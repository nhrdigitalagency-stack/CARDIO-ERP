import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowLeft,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  CreditCard,
  Download,
  Edit3,
  FileText,
  FileUp,
  HeartPulse,
  PhoneCall,
  Plus,
  Search,
  Share2,
  Stethoscope,
  Trash2,
  UserPlus,
} from 'lucide-react';
import {
  ConfirmModal,
  EmptyState,
  Modal,
  StatusBadge,
  TableSkeleton,
} from '../components/UIPrimitives';
import type {
  Allergy,
  Appointment,
  AuditLog,
  Consultation,
  DiagnosisItem,
  DocumentCategory,
  Examination,
  FollowUp,
  FollowUpStatus,
  FollowUpType,
  MedicalDocument,
  MedicalHistoryItem,
  MedicalRecord,
  Medication,
  Patient,
  Payment,
  Prescription,
  PriorityLevel,
  PublicUser,
  VitalSigns,
} from '../shared/types';
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_TYPE_LABELS,
  DOCUMENT_CATEGORY_LABELS,
  EXAMINATION_STATUS_LABELS,
  EXAMINATION_TYPE_LABELS,
  FOLLOWUP_STATUS_LABELS,
  FOLLOWUP_TYPE_LABELS,
  PRIORITY_LABELS,
} from '../shared/constants';
import { apiFetch, calculateAge, downloadProtectedFile, formatDateFr, formatDateTimeFr, formatFcfa, hasPerm } from '../lib/api';
import {
  downloadConsultationPdf,
  downloadPatientSummaryPdf,
  downloadPaymentReceiptPdf,
  downloadPrescriptionPdf,
} from '../lib/pdfGenerator';
import {
  navigate,
  PATIENT_SLUG_TO_TAB,
  PATIENT_TAB_TO_SLUG,
  type PatientTabKey,
  useAppRoute,
} from '../lib/router';
import { useLiveSync } from '../lib/useLiveSync';

interface PatientDetailPayload {
  patient: Patient;
  accessLevel: 'MEDICAL' | 'ADMINISTRATIVE' | 'PATIENT_SELF';
  medicalRecord?: MedicalRecord | null;
  histories?: MedicalHistoryItem[];
  allergies?: Allergy[];
  medications?: Medication[];
  consultations?: Consultation[];
  vitals?: VitalSigns[];
  diagnoses?: DiagnosisItem[];
  prescriptions?: Prescription[];
  examinations: Examination[];
  appointments: Appointment[];
  followUps: FollowUp[];
  documents: MedicalDocument[];
  payments?: Payment[];
  auditLogs?: AuditLog[];
}

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const MEDICAL_FOLLOWUP_TYPES: FollowUpType[] = [
  'CONTROLE_MEDICAL',
  'RESULTAT_EXAMEN',
  'EXAMEN_COMPLEMENTAIRE',
  'SURVEILLANCE',
];

const ALL_TABS: Array<{
  id: PatientTabKey;
  label: string;
  medicalOnly?: boolean;
  perm?: 'payments:read';
}> = [
  { id: 'overview', label: "Vue d'ensemble" },
  { id: 'personal', label: 'Infos personnelles' },
  { id: 'histories', label: 'Antécédents', medicalOnly: true },
  { id: 'allergies', label: 'Allergies', medicalOnly: true },
  { id: 'medications', label: 'Traitements', medicalOnly: true },
  { id: 'consultations', label: 'Consultations', medicalOnly: true },
  { id: 'vitals', label: 'Constantes', medicalOnly: true },
  { id: 'examinations', label: 'Examens' },
  { id: 'results', label: 'Résultats', medicalOnly: true },
  { id: 'prescriptions', label: 'Prescriptions', medicalOnly: true },
  { id: 'appointments', label: 'Rendez-vous' },
  { id: 'followups', label: 'Suivis' },
  { id: 'documents', label: 'Documents' },
  { id: 'payments', label: 'Paiements', perm: 'payments:read' },
  { id: 'audit', label: 'Historique' },
];

export const PatientsPage: React.FC<{
  user: PublicUser;
  initialPatientId?: string | null;
  onClearInitialPatient?: () => void;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
}> = ({ user, initialPatientId, onClearInitialPatient, notify }) => {
  const route = useAppRoute();

  // Derive path state cleanly from URL
  const seg1 = route.segments[1] || '';
  const seg2 = route.segments[2] || '';
  const seg3 = route.segments[3] || '';

  const isCreateUrl = route.segments[0] === 'patients' && seg1 === 'nouveau';
  const urlPatientKey =
    route.segments[0] === 'patients' && seg1 && seg1 !== 'nouveau' ? seg1 : null;
  const selectedId = urlPatientKey || initialPatientId || null;

  const isEditUrl = Boolean(urlPatientKey && seg2 === 'modifier');
  const isArchiveUrl = Boolean(urlPatientKey && seg2 === 'archiver');
  const isMedRecordEditUrl = Boolean(urlPatientKey && seg2 === 'dossier-medical' && seg3 === 'modifier');
  const isDocImportUrl = Boolean(urlPatientKey && seg2 === 'documents' && seg3 === 'importer');
  const isTabAddUrl = Boolean(urlPatientKey && PATIENT_SLUG_TO_TAB[seg2] && seg3 === 'ajouter');

  const resolvedTab: PatientTabKey = PATIENT_SLUG_TO_TAB[seg2] || 'overview';

  const [patients, setPatients] = useState<Patient[]>([]);
  const [staff, setStaff] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(() => route.query.get('search') || '');
  const [statusFilter, setStatusFilter] = useState<'ACTIF' | 'ARCHIVE' | 'ALL'>(
    () => (route.query.get('statut') as 'ACTIF' | 'ARCHIVE' | 'ALL') || 'ACTIF'
  );
  const [genderFilter, setGenderFilter] = useState<'ALL' | 'M' | 'F'>(
    () => (route.query.get('sexe') as 'ALL' | 'M' | 'F') || 'ALL'
  );

  const [detail, setDetail] = useState<PatientDetailPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Create/Edit Patient Modal state
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
  const [duplicates, setDuplicates] = useState<Patient[]>([]);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    gender: 'M' as 'M' | 'F',
    birthDate: '1980-01-01',
    phone: '',
    email: '',
    address: '',
    profession: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    bloodGroup: '',
    portalInvited: false,
  });

  // Archive confirm state
  const [archiving, setArchiving] = useState(false);

  // Medical Record Synthesis / Risk Factors / Alerts Modal state
  const [medRecordForm, setMedRecordForm] = useState({
    summary: '',
    riskFactorsText: '',
    medicalAlertsText: '',
  });
  const [savingMedRecord, setSavingMedRecord] = useState(false);

  // Clinical sub-forms (Doctor only)
  const [histForm, setHistForm] = useState({
    category: 'CARDIOVASCULAIRE',
    title: '',
    details: '',
    diagnosedYear: '',
  });
  const [allergyForm, setAllergyForm] = useState({
    allergen: '',
    reaction: '',
    severity: 'MODEREE',
  });
  const [medForm, setMedForm] = useState({
    name: '',
    dosage: '',
    frequency: '',
    startDate: new Date().toISOString().slice(0, 10),
    notes: '',
  });
  const [vitalForm, setVitalForm] = useState({
    systolicBP: '',
    diastolicBP: '',
    heartRate: '',
    respiratoryRate: '',
    weight: '',
    height: '',
    oxygenSaturation: '',
    temperature: '',
  });

  // Inline Document upload modal state
  const [docForm, setDocForm] = useState({
    title: '',
    category: 'COMPTE_RENDU' as DocumentCategory,
    sharedWithPatient: false,
    file: null as File | null,
  });
  const [uploadingDoc, setUploadingDoc] = useState(false);

  // Inline Follow-Up create / relance / complete modals
  const [followUpForm, setFollowUpForm] = useState({
    type: 'APPEL_TELEPHONIQUE' as FollowUpType,
    reason: '',
    dueDate: new Date().toISOString().slice(0, 10),
    assigneeId: user._id,
    priority: 'NORMALE' as PriorityLevel,
    notes: '',
  });
  const [relanceTarget, setRelanceTarget] = useState<FollowUp | null>(null);
  const [relanceForm, setRelanceForm] = useState({
    status: 'PATIENT_CONTACTE' as FollowUpStatus,
    dueDate: '',
    assigneeId: '',
    contactOutcome: '',
    relanceNote: '',
  });
  const [completeTarget, setCompleteTarget] = useState<FollowUp | null>(null);
  const [completeForm, setCompleteForm] = useState({ contactOutcome: '', nextAction: '' });
  const [savingFollowUp, setSavingFollowUp] = useState(false);

  const patientSlug = detail?.patient?.patientNumber || selectedId || '';
  const patientBasePath = `/patients/${encodeURIComponent(patientSlug)}`;

  const loadList = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (search.trim()) qs.set('search', search.trim());
      qs.set('status', statusFilter);
      if (genderFilter !== 'ALL') qs.set('gender', genderFilter);
      const res = await apiFetch<{ patients: Patient[] }>(`/api/patients?${qs.toString()}`);
      setPatients(res.patients);
    } catch (err: any) {
      if (!silent) notify('error', err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadDetail = async (id: string, silent = false) => {
    if (!silent) setDetailLoading(true);
    try {
      const res = await apiFetch<PatientDetailPayload>(`/api/patients/${encodeURIComponent(id)}`);
      setDetail(res);
      // Canonicalize URL to patientNumber (PAT-XXXXX) while keeping sub-route
      if (
        res.patient.patientNumber &&
        urlPatientKey &&
        urlPatientKey !== res.patient.patientNumber
      ) {
        const tail = route.segments.slice(2).map(encodeURIComponent).join('/');
        navigate(
          `/patients/${encodeURIComponent(res.patient.patientNumber)}${tail ? `/${tail}` : ''}${route.search}`,
          { replace: true }
        );
      }
    } catch (err: any) {
      if (!silent) {
        notify('error', err.message);
        navigate('/patients', { replace: true });
      }
    } finally {
      if (!silent) setDetailLoading(false);
    }
  };

  useEffect(() => {
    loadList();
  }, [statusFilter, genderFilter]);

  useEffect(() => {
    if (selectedId && hasPerm(user, 'followups:read') && staff.length === 0) {
      apiFetch<{ staff: PublicUser[] }>('/api/users/staff')
        .then((r) => setStaff(r.staff))
        .catch(() => {});
    }
  }, [selectedId]);

  useEffect(() => {
    if (selectedId) {
      loadDetail(selectedId);
    } else {
      setDetail(null);
    }
  }, [selectedId]);

  // Populate edit patient form whenever /modifier is visited
  useEffect(() => {
    if (isEditUrl && detail?.patient) {
      if (!hasPerm(user, 'patients:write_admin')) {
        navigate(patientBasePath, { replace: true });
        return;
      }
      const p = detail.patient;
      setEditingPatient(p);
      setDuplicates([]);
      setConfirmDuplicate(false);
      setForm({
        firstName: p.firstName,
        lastName: p.lastName,
        gender: p.gender,
        birthDate: p.birthDate,
        phone: p.phone,
        email: p.email || '',
        address: p.address || '',
        profession: p.profession || '',
        emergencyContactName: p.emergencyContactName || '',
        emergencyContactPhone: p.emergencyContactPhone || '',
        bloodGroup: p.bloodGroup || '',
        portalInvited: Boolean(p.portalInvited),
      });
    } else if (isCreateUrl) {
      if (!hasPerm(user, 'patients:write_admin')) {
        navigate('/patients', { replace: true });
        return;
      }
      setEditingPatient(null);
      setDuplicates([]);
      setConfirmDuplicate(false);
      setForm({
        firstName: '',
        lastName: '',
        gender: 'M',
        birthDate: '1980-01-01',
        phone: '',
        email: '',
        address: '',
        profession: '',
        emergencyContactName: '',
        emergencyContactPhone: '',
        bloodGroup: '',
        portalInvited: false,
      });
    }
  }, [isEditUrl, isCreateUrl, detail?.patient?._id]);

  // Populate medical record modal whenever /dossier-medical/modifier is visited
  useEffect(() => {
    if (isMedRecordEditUrl && detail?.patient) {
      if (!hasPerm(user, 'medical:write')) {
        navigate(patientBasePath, { replace: true });
        return;
      }
      setMedRecordForm({
        summary: detail.medicalRecord?.summary || '',
        riskFactorsText: (detail.medicalRecord?.riskFactors || []).join(', '),
        medicalAlertsText: (detail.patient.medicalAlerts || []).join(', '),
      });
    }
  }, [isMedRecordEditUrl, detail?.patient?._id]);

  useLiveSync(
    ['patient', 'consultation', 'examination', 'followup', 'document', 'appointment', 'payment'],
    () => {
      loadList(true);
      if (selectedId) loadDetail(selectedId, true);
    }
  );

  const openPatientDossier = (p: Patient, tabKey: PatientTabKey = 'overview') => {
    const key = p.patientNumber || p._id;
    const slug = PATIENT_TAB_TO_SLUG[tabKey];
    navigate(tabKey === 'overview' ? `/patients/${encodeURIComponent(key)}` : `/patients/${encodeURIComponent(key)}/${slug}`);
  };

  const openTab = (tabKey: PatientTabKey) => {
    if (!patientSlug) return;
    if (tabKey === 'overview') {
      navigate(patientBasePath);
    } else {
      navigate(`${patientBasePath}/${PATIENT_TAB_TO_SLUG[tabKey]}`);
    }
  };

  const openCreate = () => {
    navigate('/patients/nouveau');
  };

  const openEdit = (p: Patient) => {
    navigate(`/patients/${encodeURIComponent(p.patientNumber || p._id)}/modifier`);
  };

  const closeCreateOrEditModal = () => {
    if (isEditUrl && patientSlug) {
      navigate(patientBasePath);
    } else {
      navigate('/patients');
    }
  };

  const handleSavePatient = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingPatient) {
        await apiFetch(`/api/patients/${editingPatient._id}`, {
          method: 'PATCH',
          body: JSON.stringify(form),
        });
        notify('success', 'Dossier patient mis à jour.');
        await loadList();
        await loadDetail(editingPatient.patientNumber || editingPatient._id);
        navigate(`/patients/${encodeURIComponent(editingPatient.patientNumber || editingPatient._id)}`);
      } else {
        const res = await apiFetch<{ patient: Patient }>('/api/patients', {
          method: 'POST',
          body: JSON.stringify({ ...form, confirmDuplicateIgnore: confirmDuplicate }),
        });
        notify('success', `Patient ${res.patient.patientNumber} enregistré.`);
        await loadList();
        navigate(`/patients/${encodeURIComponent(res.patient.patientNumber || res.patient._id)}`);
      }
    } catch (err: any) {
      if (err.code === 'POTENTIAL_DUPLICATE' && err.data?.duplicates) {
        setDuplicates(err.data.duplicates);
        notify('info', 'Doublon potentiel détecté : vérifiez les fiches existantes ci-dessous.');
      } else {
        notify('error', err.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!detail?.patient) return;
    const target = detail.patient;
    setArchiving(true);
    try {
      await apiFetch(`/api/patients/${target._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: target.status === 'ACTIF' ? 'ARCHIVE' : 'ACTIF' }),
      });
      notify(
        'success',
        target.status === 'ACTIF' ? 'Dossier archivé conformément aux règles.' : 'Dossier réactivé.'
      );
      await loadList();
      await loadDetail(target.patientNumber || target._id);
      navigate(`/patients/${encodeURIComponent(target.patientNumber || target._id)}`);
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setArchiving(false);
    }
  };

  const handleSaveMedRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    setSavingMedRecord(true);
    try {
      const riskFactors = medRecordForm.riskFactorsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const medicalAlerts = medRecordForm.medicalAlertsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      await apiFetch(`/api/patients/${detail.patient._id}/medical-record`, {
        method: 'PATCH',
        body: JSON.stringify({
          summary: medRecordForm.summary,
          riskFactors,
          medicalAlerts,
        }),
      });
      notify('success', 'Synthèse médicale et alertes enregistrées.');
      await loadDetail(detail.patient.patientNumber || detail.patient._id);
      navigate(patientBasePath);
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setSavingMedRecord(false);
    }
  };

  // Medical additions & edits inside patient record
  const addHistory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    try {
      await apiFetch(`/api/patients/${detail.patient._id}/history`, {
        method: 'POST',
        body: JSON.stringify(histForm),
      });
      notify('success', 'Antécédent ajouté.');
      setHistForm({ category: 'CARDIOVASCULAIRE', title: '', details: '', diagnosedYear: '' });
      await loadDetail(detail.patient.patientNumber || detail.patient._id);
      if (isTabAddUrl) navigate(`${patientBasePath}/${PATIENT_TAB_TO_SLUG.histories}`);
    } catch (err: any) {
      notify('error', err.message);
    }
  };

  const deleteHistory = async (itemId: string) => {
    if (!detail) return;
    try {
      await apiFetch(`/api/patients/${detail.patient._id}/history/${itemId}`, { method: 'DELETE' });
      notify('success', 'Antécédent supprimé.');
      await loadDetail(detail.patient.patientNumber || detail.patient._id);
    } catch (err: any) {
      notify('error', err.message);
    }
  };

  const addAllergy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    try {
      await apiFetch(`/api/patients/${detail.patient._id}/allergies`, {
        method: 'POST',
        body: JSON.stringify(allergyForm),
      });
      notify('success', 'Allergie enregistrée.');
      setAllergyForm({ allergen: '', reaction: '', severity: 'MODEREE' });
      await loadDetail(detail.patient.patientNumber || detail.patient._id);
      if (isTabAddUrl) navigate(`${patientBasePath}/${PATIENT_TAB_TO_SLUG.allergies}`);
    } catch (err: any) {
      notify('error', err.message);
    }
  };

  const deleteAllergy = async (itemId: string) => {
    if (!detail) return;
    try {
      await apiFetch(`/api/patients/${detail.patient._id}/allergies/${itemId}`, { method: 'DELETE' });
      notify('success', 'Allergie supprimée.');
      await loadDetail(detail.patient.patientNumber || detail.patient._id);
    } catch (err: any) {
      notify('error', err.message);
    }
  };

  const addMedication = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    try {
      await apiFetch(`/api/patients/${detail.patient._id}/medications`, {
        method: 'POST',
        body: JSON.stringify({ ...medForm, active: true }),
      });
      notify('success', 'Traitement ajouté.');
      setMedForm({
        name: '',
        dosage: '',
        frequency: '',
        startDate: new Date().toISOString().slice(0, 10),
        notes: '',
      });
      await loadDetail(detail.patient.patientNumber || detail.patient._id);
      if (isTabAddUrl) navigate(`${patientBasePath}/${PATIENT_TAB_TO_SLUG.medications}`);
    } catch (err: any) {
      notify('error', err.message);
    }
  };

  const toggleMedicationStatus = async (med: Medication) => {
    if (!detail) return;
    try {
      const nextActive = !med.active;
      await apiFetch(`/api/patients/${detail.patient._id}/medications/${med._id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          active: nextActive,
          endDate: nextActive ? '' : new Date().toISOString().slice(0, 10),
        }),
      });
      notify('success', nextActive ? `Traitement "${med.name}" repris.` : `Traitement "${med.name}" arrêté.`);
      await loadDetail(detail.patient.patientNumber || detail.patient._id);
    } catch (err: any) {
      notify('error', err.message);
    }
  };

  const addVitals = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    try {
      await apiFetch(`/api/patients/${detail.patient._id}/vitals`, {
        method: 'POST',
        body: JSON.stringify({
          systolicBP: vitalForm.systolicBP ? Number(vitalForm.systolicBP) : undefined,
          diastolicBP: vitalForm.diastolicBP ? Number(vitalForm.diastolicBP) : undefined,
          heartRate: vitalForm.heartRate ? Number(vitalForm.heartRate) : undefined,
          respiratoryRate: vitalForm.respiratoryRate ? Number(vitalForm.respiratoryRate) : undefined,
          weight: vitalForm.weight ? Number(vitalForm.weight) : undefined,
          height: vitalForm.height ? Number(vitalForm.height) : undefined,
          oxygenSaturation: vitalForm.oxygenSaturation ? Number(vitalForm.oxygenSaturation) : undefined,
          temperature: vitalForm.temperature ? Number(vitalForm.temperature) : undefined,
        }),
      });
      notify('success', 'Constantes enregistrées.');
      setVitalForm({
        systolicBP: '',
        diastolicBP: '',
        heartRate: '',
        respiratoryRate: '',
        weight: '',
        height: '',
        oxygenSaturation: '',
        temperature: '',
      });
      await loadDetail(detail.patient.patientNumber || detail.patient._id);
      if (isTabAddUrl) navigate(`${patientBasePath}/${PATIENT_TAB_TO_SLUG.vitals}`);
    } catch (err: any) {
      notify('error', err.message);
    }
  };

  // Document actions inside patient dossier
  const handleUploadDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || !docForm.file) {
      notify('error', 'Veuillez sélectionner un fichier PDF ou image.');
      return;
    }
    setUploadingDoc(true);
    try {
      const fd = new FormData();
      fd.append('file', docForm.file);
      fd.append('title', docForm.title);
      fd.append('category', docForm.category);
      fd.append('patientId', detail.patient._id);
      fd.append('sharedWithPatient', String(docForm.sharedWithPatient));

      await apiFetch('/api/documents/upload', { method: 'POST', body: fd });
      notify('success', 'Document enregistré dans le dossier patient.');
      setDocForm({ title: '', category: 'COMPTE_RENDU', sharedWithPatient: false, file: null });
      await loadDetail(detail.patient.patientNumber || detail.patient._id);
      navigate(`${patientBasePath}/${PATIENT_TAB_TO_SLUG.documents}`);
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setUploadingDoc(false);
    }
  };

  const toggleDocShare = async (d: MedicalDocument) => {
    if (!detail) return;
    try {
      await apiFetch(`/api/documents/${d._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ sharedWithPatient: !d.sharedWithPatient }),
      });
      notify('success', d.sharedWithPatient ? 'Document masqué du portail patient.' : 'Document partagé avec le patient.');
      await loadDetail(detail.patient.patientNumber || detail.patient._id);
    } catch (err: any) {
      notify('error', err.message);
    }
  };

  const archiveDoc = async (d: MedicalDocument) => {
    if (!detail) return;
    try {
      await apiFetch(`/api/documents/${d._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ archived: true }),
      });
      notify('success', 'Document archivé.');
      await loadDetail(detail.patient.patientNumber || detail.patient._id);
    } catch (err: any) {
      notify('error', err.message);
    }
  };

  // Follow-Up actions inside patient dossier
  const handleCreateFollowUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    setSavingFollowUp(true);
    try {
      await apiFetch('/api/follow-ups', {
        method: 'POST',
        body: JSON.stringify({
          patientId: detail.patient._id,
          ...followUpForm,
        }),
      });
      notify('success', 'Suivi programmé et historisé.');
      setFollowUpForm({
        type: 'APPEL_TELEPHONIQUE',
        reason: '',
        dueDate: new Date().toISOString().slice(0, 10),
        assigneeId: user._id,
        priority: 'NORMALE',
        notes: '',
      });
      await loadDetail(detail.patient.patientNumber || detail.patient._id);
      navigate(`${patientBasePath}/${PATIENT_TAB_TO_SLUG.followups}`);
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setSavingFollowUp(false);
    }
  };

  const handleRelanceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || !relanceTarget) return;
    setSavingFollowUp(true);
    try {
      await apiFetch(`/api/follow-ups/${relanceTarget._id}`, {
        method: 'PATCH',
        body: JSON.stringify(relanceForm),
      });
      notify('success', 'Relance enregistrée.');
      setRelanceTarget(null);
      await loadDetail(detail.patient.patientNumber || detail.patient._id);
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setSavingFollowUp(false);
    }
  };

  const handleCompleteFollowUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || !completeTarget) return;
    setSavingFollowUp(true);
    try {
      await apiFetch(`/api/follow-ups/${completeTarget._id}/complete`, {
        method: 'POST',
        body: JSON.stringify(completeForm),
      });
      notify('success', 'Suivi clôturé.');
      setCompleteTarget(null);
      setCompleteForm({ contactOutcome: '', nextAction: '' });
      await loadDetail(detail.patient.patientNumber || detail.patient._id);
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setSavingFollowUp(false);
    }
  };

  // Shared Create/Edit Patient Modal element (used in both directory & detail view)
  const renderPatientFormModal = () => (
    <Modal
      open={isCreateUrl || isEditUrl}
      onClose={closeCreateOrEditModal}
      title={editingPatient ? `Modifier ${editingPatient.patientNumber}` : 'Nouveau dossier patient'}
      subtitle="Les identifiants PAT-XXXXX sont générés automatiquement."
    >
      <form onSubmit={handleSavePatient} className="space-y-4">
        {duplicates.length > 0 && (
          <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 space-y-2 text-xs">
            <div className="flex items-center gap-2 font-semibold text-amber-900 dark:text-amber-200">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Contrôle des doublons : {duplicates.length} fiche(s) similaire(s) trouvée(s)
            </div>
            <ul className="space-y-1 text-amber-800 dark:text-amber-300">
              {duplicates.map((d) => (
                <li key={d._id}>
                  • <strong>{d.patientNumber}</strong> — {d.firstName} {d.lastName} ({formatDateFr(d.birthDate)} · {d.phone})
                </li>
              ))}
            </ul>
            <label className="flex items-center gap-2 pt-1 font-medium text-amber-900 dark:text-amber-100">
              <input
                type="checkbox"
                checked={confirmDuplicate}
                onChange={(e) => setConfirmDuplicate(e.target.checked)}
              />
              Je confirme qu'il s'agit d'un patient distinct et souhaite créer un nouveau dossier.
            </label>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium mb-1">Nom *</label>
            <input
              type="text"
              required
              value={form.lastName}
              onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Prénom *</label>
            <input
              type="text"
              required
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Sexe *</label>
            <select
              value={form.gender}
              onChange={(e) => setForm({ ...form, gender: e.target.value as 'M' | 'F' })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            >
              <option value="M">Masculin</option>
              <option value="F">Féminin</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Date de naissance *</label>
            <input
              type="date"
              required
              value={form.birthDate}
              onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Téléphone *</label>
            <input
              type="text"
              required
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="+237 6..."
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">E-mail</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Adresse</label>
            <input
              type="text"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Profession (facultatif)</label>
            <input
              type="text"
              value={form.profession}
              onChange={(e) => setForm({ ...form, profession: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Groupe sanguin</label>
            <select
              value={form.bloodGroup}
              onChange={(e) => setForm({ ...form, bloodGroup: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            >
              <option value="">Non renseigné</option>
              {BLOOD_GROUPS.map((bg) => (
                <option key={bg} value={bg}>
                  {bg}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Personne à contacter en urgence</label>
            <input
              type="text"
              value={form.emergencyContactName}
              onChange={(e) => setForm({ ...form, emergencyContactName: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium mb-1">Téléphone du contact d'urgence</label>
            <input
              type="text"
              value={form.emergencyContactPhone}
              onChange={(e) => setForm({ ...form, emergencyContactPhone: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={form.portalInvited}
            onChange={(e) => setForm({ ...form, portalInvited: e.target.checked })}
          />
          Autoriser ce patient à activer son espace personnel (invitation portail)
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={closeCreateOrEditModal}
            className="px-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-[#073B70] text-white font-medium disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            {saving ? 'Enregistrement...' : editingPatient ? 'Enregistrer' : 'Créer le dossier'}
          </button>
        </div>
      </form>
    </Modal>
  );

  // ---------------- PATIENT DETAIL VIEW (15 TABS + ACTION SUB-ROUTES) ----------------
  if (selectedId) {
    if (detailLoading || !detail) {
      return (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => {
              onClearInitialPatient?.();
              navigate('/patients');
            }}
            className="inline-flex items-center gap-1.5 text-sm text-[#073B70] dark:text-sky-300 font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            Retour à la liste des patients
          </button>
          <TableSkeleton rows={6} />
        </div>
      );
    }

    const p = detail.patient;
    const isMed = detail.accessLevel === 'MEDICAL';
    const canWriteMed = isMed && hasPerm(user, 'medical:write');
    const visibleTabs = ALL_TABS.filter((t) => {
      if (t.medicalOnly && !isMed) return false;
      if (t.perm && !hasPerm(user, t.perm)) return false;
      return true;
    });

    const activeTab: PatientTabKey = visibleTabs.some((t) => t.id === resolvedTab)
      ? resolvedTab
      : 'overview';

    const lastConsult = detail.consultations?.[0];
    const nextAppt = detail.appointments.find(
      (a) => a.date >= new Date().toISOString().slice(0, 10) && a.status !== 'ANNULE' && a.status !== 'TERMINE'
    );
    const patientPayments = detail.payments || [];
    const totalBilled = patientPayments.filter((pay) => pay.status !== 'ANNULE').reduce((a, b) => a + b.totalAmountFcfa, 0);
    const totalPaid = patientPayments.filter((pay) => pay.status !== 'ANNULE').reduce((a, b) => a + b.amountPaidFcfa, 0);
    const totalRemaining = patientPayments.filter((pay) => pay.status !== 'ANNULE').reduce((a, b) => a + b.remainingBalanceFcfa, 0);

    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              onClearInitialPatient?.();
              navigate('/patients');
            }}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#073B70] dark:text-sky-300 hover:underline"
          >
            <ArrowLeft className="w-4 h-4" />
            Retour à l'annuaire patients
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => downloadPatientSummaryPdf(p)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Download className="w-3.5 h-3.5" />
              Fiche PDF
            </button>
            {hasPerm(user, 'appointments:write') && (
              <button
                type="button"
                onClick={() => navigate(`/rendez-vous/nouveau?patientId=${encodeURIComponent(p._id)}`)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-[#EAF4FC]/60 dark:hover:bg-slate-800"
              >
                <CalendarPlus className="w-3.5 h-3.5 text-[#1265A3]" />
                Nouveau RDV
              </button>
            )}
            {hasPerm(user, 'consultations:write') && (
              <button
                type="button"
                onClick={() => navigate(`/consultations/nouvelle?patientId=${encodeURIComponent(p._id)}`)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#073B70] hover:bg-[#1265A3] text-white text-xs font-medium"
              >
                <Stethoscope className="w-3.5 h-3.5" />
                Nouvelle consultation
              </button>
            )}
            {hasPerm(user, 'examinations:prescribe') && (
              <button
                type="button"
                onClick={() => navigate(`/examens/prescrire?patientId=${encodeURIComponent(p._id)}`)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-[#EAF4FC]/60 dark:hover:bg-slate-800"
              >
                <HeartPulse className="w-3.5 h-3.5 text-[#D71920]" />
                Prescrire examen
              </button>
            )}
            {hasPerm(user, 'patients:write_admin') && (
              <button
                type="button"
                onClick={() => openEdit(p)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Edit3 className="w-3.5 h-3.5" />
                Modifier
              </button>
            )}
            {(hasPerm(user, 'patients:archive') || hasPerm(user, 'medical:write')) && (
              <button
                type="button"
                onClick={() => navigate(`${patientBasePath}/archiver`)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-red-50 hover:text-[#D71920]"
              >
                <Archive className="w-3.5 h-3.5" />
                {p.status === 'ACTIF' ? 'Archiver' : 'Réactiver'}
              </button>
            )}
          </div>
        </div>

        {/* Sticky Clinical Header Banner */}
        <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-[#EAF4FC] text-[#073B70] dark:bg-[#073B70]/50 dark:text-sky-200">
                  {p.patientNumber}
                </span>
                <h1 className="text-xl font-bold text-[#172B45] dark:text-white">
                  {p.firstName} {p.lastName}
                </h1>
                <StatusBadge label={p.status === 'ACTIF' ? 'Dossier actif' : 'Archivé'} tone={p.status === 'ACTIF' ? 'success' : 'neutral'} />
                {p.bloodGroup && (
                  <StatusBadge label={`Groupe ${p.bloodGroup}`} tone="danger" />
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#708197] dark:text-slate-400 tabular-nums">
                <span>{p.gender === 'M' ? 'Masculin' : 'Féminin'} · {calculateAge(p.birthDate)} ({formatDateFr(p.birthDate)})</span>
                <span className="font-mono">{p.phone}</span>
                {lastConsult && <span>Dernière consultation : {formatDateFr(lastConsult.date)}</span>}
                {nextAppt && (
                  <span className="text-[#073B70] dark:text-sky-300 font-medium">
                    Prochain RDV : {formatDateFr(nextAppt.date)} à {nextAppt.startTime}
                  </span>
                )}
              </div>
            </div>

            {isMed && ((p.medicalAlerts && p.medicalAlerts.length > 0) || (detail.allergies && detail.allergies.length > 0)) && (
              <div className="flex flex-wrap items-center gap-2">
                {p.medicalAlerts?.map((al) => (
                  <StatusBadge key={al} label={`Alerte : ${al}`} tone="danger" />
                ))}
                {detail.allergies?.map((a) => (
                  <StatusBadge key={a._id} label={`Allergie : ${a.allergen}`} tone="warning" />
                ))}
              </div>
            )}
          </div>

          {!isMed && (
            <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-[#708197] dark:text-slate-400">
              Accès administratif uniquement : les diagnostics, prescriptions et observations médicales confidentielles sont réservés au médecin.
            </div>
          )}
        </div>

        {/* Multi-Tab Navigation */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 border-b border-slate-200 dark:border-slate-800">
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => openTab(t.id)}
              className={`px-3.5 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap shrink-0 transition-colors border-b-2 ${
                activeTab === t.id
                  ? 'border-[#073B70] text-[#073B70] dark:border-sky-400 dark:text-sky-300 bg-white dark:bg-[#131E30]'
                  : 'border-transparent text-[#708197] hover:text-[#172B45] dark:hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl p-6">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <h2 className="text-sm font-semibold">Synthèse administrative</h2>
                  <dl className="text-sm space-y-2">
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                      <dt className="text-[#708197]">Téléphone</dt>
                      <dd className="font-mono">{p.phone}</dd>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                      <dt className="text-[#708197]">E-mail</dt>
                      <dd>{p.email || '—'}</dd>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                      <dt className="text-[#708197]">Adresse</dt>
                      <dd>{p.address || '—'}</dd>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                      <dt className="text-[#708197]">Groupe sanguin</dt>
                      <dd className="font-semibold">{p.bloodGroup || '—'}</dd>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100 dark:border-slate-800">
                      <dt className="text-[#708197]">Contact urgence</dt>
                      <dd>{p.emergencyContactName ? `${p.emergencyContactName} (${p.emergencyContactPhone})` : '—'}</dd>
                    </div>
                  </dl>
                </div>
                <div className="space-y-3">
                  <h2 className="text-sm font-semibold">Activité du dossier</h2>
                  <div className="grid grid-cols-2 gap-2.5 text-xs">
                    <button type="button" onClick={() => openTab('appointments')} className="text-left p-3 rounded-lg bg-[#F4F7FB] dark:bg-slate-900/50 hover:bg-[#EAF4FC] dark:hover:bg-slate-800">
                      <div className="text-[#708197]">Rendez-vous</div>
                      <div className="text-base font-bold text-[#073B70] dark:text-sky-300 tabular-nums mt-0.5">{detail.appointments.length}</div>
                    </button>
                    <button type="button" onClick={() => openTab('examinations')} className="text-left p-3 rounded-lg bg-[#F4F7FB] dark:bg-slate-900/50 hover:bg-[#EAF4FC] dark:hover:bg-slate-800">
                      <div className="text-[#708197]">Examens</div>
                      <div className="text-base font-bold text-[#073B70] dark:text-sky-300 tabular-nums mt-0.5">{detail.examinations.length}</div>
                    </button>
                    <button type="button" onClick={() => openTab('followups')} className="text-left p-3 rounded-lg bg-[#F4F7FB] dark:bg-slate-900/50 hover:bg-[#EAF4FC] dark:hover:bg-slate-800">
                      <div className="text-[#708197]">Suivis patients</div>
                      <div className="text-base font-bold text-[#073B70] dark:text-sky-300 tabular-nums mt-0.5">{detail.followUps.length}</div>
                    </button>
                    <button type="button" onClick={() => openTab('documents')} className="text-left p-3 rounded-lg bg-[#F4F7FB] dark:bg-slate-900/50 hover:bg-[#EAF4FC] dark:hover:bg-slate-800">
                      <div className="text-[#708197]">Documents</div>
                      <div className="text-base font-bold text-[#073B70] dark:text-sky-300 tabular-nums mt-0.5">{detail.documents.length}</div>
                    </button>
                    {isMed && (
                      <button type="button" onClick={() => openTab('consultations')} className="text-left p-3 rounded-lg bg-[#F4F7FB] dark:bg-slate-900/50 hover:bg-[#EAF4FC] dark:hover:bg-slate-800">
                        <div className="text-[#708197]">Consultations</div>
                        <div className="text-base font-bold text-[#073B70] dark:text-sky-300 tabular-nums mt-0.5">{detail.consultations?.length || 0}</div>
                      </button>
                    )}
                    {hasPerm(user, 'payments:read') && (
                      <button type="button" onClick={() => openTab('payments')} className="text-left p-3 rounded-lg bg-[#F4F7FB] dark:bg-slate-900/50 hover:bg-[#EAF4FC] dark:hover:bg-slate-800">
                        <div className="text-[#708197]">Solde restant</div>
                        <div className="text-base font-bold text-[#073B70] dark:text-sky-300 tabular-nums mt-0.5">{formatFcfa(totalRemaining)}</div>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {isMed && (
                <div className="p-4 rounded-xl bg-[#F8FBFE] dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-[#073B70] dark:text-sky-300">
                      Synthèse cardiologique, facteurs de risque & alertes cliniques
                    </h2>
                    {canWriteMed && (
                      <button
                        type="button"
                        onClick={() => navigate(`${patientBasePath}/dossier-medical/modifier`)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        Éditer synthèse & alertes
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-[#172B45] dark:text-slate-200 whitespace-pre-line">
                    {detail.medicalRecord?.summary?.trim() || 'Aucune synthèse médicale renseignée pour le moment.'}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-medium text-[#708197]">Facteurs de risque :</span>
                    {(detail.medicalRecord?.riskFactors || []).length === 0 ? (
                      <span className="text-[11px] text-[#708197]">Aucun renseigné</span>
                    ) : (
                      detail.medicalRecord?.riskFactors?.map((rf) => (
                        <StatusBadge key={rf} label={rf} tone="info" />
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'personal' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
              {[
                ['Numéro patient', p.patientNumber],
                ['Nom complet', `${p.firstName} ${p.lastName}`],
                ['Sexe', p.gender === 'M' ? 'Masculin' : 'Féminin'],
                ['Date de naissance', `${formatDateFr(p.birthDate)} (${calculateAge(p.birthDate)})`],
                ['Téléphone', p.phone],
                ['E-mail', p.email || '—'],
                ['Adresse', p.address || '—'],
                ['Profession', p.profession || '—'],
                ['Groupe sanguin', p.bloodGroup || '—'],
                ['Contact urgence', p.emergencyContactName || '—'],
                ['Téléphone urgence', p.emergencyContactPhone || '—'],
                ['Portail patient', p.portalActivated ? 'Activé' : p.portalInvited ? 'Invité' : 'Non activé'],
              ].map(([k, v]) => (
                <div key={k} className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800">
                  <div className="text-xs text-[#708197]">{k}</div>
                  <div className="font-medium mt-0.5">{v}</div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'histories' && isMed && (
            <div className="space-y-6">
              {canWriteMed && (
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Antécédents médicaux & familiaux</h2>
                  {!isTabAddUrl && (
                    <button
                      type="button"
                      onClick={() => navigate(`${patientBasePath}/${PATIENT_TAB_TO_SLUG.histories}/ajouter`)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#073B70] text-white text-xs font-medium"
                    >
                      <Plus className="w-3.5 h-3.5" /> Nouvel antécédent
                    </button>
                  )}
                </div>
              )}
              {canWriteMed && (
                <form
                  onSubmit={addHistory}
                  className={`grid grid-cols-1 sm:grid-cols-5 gap-3 p-4 rounded-lg border ${
                    isTabAddUrl
                      ? 'bg-[#EAF4FC]/60 dark:bg-[#073B70]/25 border-[#1265A3]'
                      : 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <select
                    value={histForm.category}
                    onChange={(e) => setHistForm({ ...histForm, category: e.target.value })}
                    className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                  >
                    <option value="CARDIOVASCULAIRE">Cardiovasculaire</option>
                    <option value="CHIRURGICAL">Chirurgical</option>
                    <option value="FAMILIAL">Familial</option>
                    <option value="AUTRE">Autre</option>
                  </select>
                  <input
                    type="text"
                    required
                    placeholder="Intitulé (ex. HTA)"
                    value={histForm.title}
                    onChange={(e) => setHistForm({ ...histForm, title: e.target.value })}
                    className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                  />
                  <input
                    type="text"
                    placeholder="Année (ex. 2019)"
                    value={histForm.diagnosedYear}
                    onChange={(e) => setHistForm({ ...histForm, diagnosedYear: e.target.value })}
                    className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
                  />
                  <input
                    type="text"
                    placeholder="Précisions / Détails"
                    value={histForm.details}
                    onChange={(e) => setHistForm({ ...histForm, details: e.target.value })}
                    className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                  />
                  <div className="flex gap-2">
                    <button type="submit" className="flex-1 px-3 py-2 rounded-lg bg-[#073B70] text-white text-xs font-medium">
                      Ajouter
                    </button>
                    {isTabAddUrl && (
                      <button
                        type="button"
                        onClick={() => openTab('histories')}
                        className="px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs"
                      >
                        Fermer
                      </button>
                    )}
                  </div>
                </form>
              )}
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {(detail.histories || []).length === 0 ? (
                  <div className="text-xs text-[#708197] py-4">Aucun antécédent saisi.</div>
                ) : (
                  detail.histories?.map((h) => (
                    <div key={h._id} className="py-3 flex items-center justify-between gap-4">
                      <div>
                        <div className="text-sm font-semibold">{h.title}</div>
                        <div className="text-xs text-[#708197]">
                          {h.category} {h.diagnosedYear ? `· ${h.diagnosedYear}` : ''} {h.details ? `— ${h.details}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-xs text-[#708197]">{formatDateFr(h.createdAt)}</span>
                        {canWriteMed && (
                          <button
                            type="button"
                            onClick={() => deleteHistory(h._id)}
                            className="p-1.5 rounded text-slate-400 hover:text-[#D71920] hover:bg-red-50 dark:hover:bg-red-950/30"
                            aria-label="Supprimer cet antécédent"
                          >
                            <span title="Supprimer">
                              <Trash2 className="w-3.5 h-3.5" />
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'allergies' && isMed && (
            <div className="space-y-6">
              {canWriteMed && (
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Allergies & Intolérances déclarées</h2>
                  {!isTabAddUrl && (
                    <button
                      type="button"
                      onClick={() => navigate(`${patientBasePath}/${PATIENT_TAB_TO_SLUG.allergies}/ajouter`)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#D71920] text-white text-xs font-medium"
                    >
                      <Plus className="w-3.5 h-3.5" /> Nouvelle allergie
                    </button>
                  )}
                </div>
              )}
              {canWriteMed && (
                <form
                  onSubmit={addAllergy}
                  className={`grid grid-cols-1 sm:grid-cols-4 gap-3 p-4 rounded-lg border ${
                    isTabAddUrl
                      ? 'bg-red-50/70 dark:bg-red-950/25 border-[#D71920]'
                      : 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <input
                    type="text"
                    required
                    placeholder="Allergène"
                    value={allergyForm.allergen}
                    onChange={(e) => setAllergyForm({ ...allergyForm, allergen: e.target.value })}
                    className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                  />
                  <input
                    type="text"
                    placeholder="Réaction observée"
                    value={allergyForm.reaction}
                    onChange={(e) => setAllergyForm({ ...allergyForm, reaction: e.target.value })}
                    className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                  />
                  <select
                    value={allergyForm.severity}
                    onChange={(e) => setAllergyForm({ ...allergyForm, severity: e.target.value })}
                    className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                  >
                    <option value="LEGERE">Légère</option>
                    <option value="MODEREE">Modérée</option>
                    <option value="SEVERE">Sévère</option>
                  </select>
                  <div className="flex gap-2">
                    <button type="submit" className="flex-1 px-3 py-2 rounded-lg bg-[#D71920] text-white text-xs font-medium">
                      Enregistrer
                    </button>
                    {isTabAddUrl && (
                      <button
                        type="button"
                        onClick={() => openTab('allergies')}
                        className="px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs"
                      >
                        Fermer
                      </button>
                    )}
                  </div>
                </form>
              )}
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {(detail.allergies || []).length === 0 ? (
                  <div className="text-xs text-[#708197] py-4">Aucune allergie connue déclarée.</div>
                ) : (
                  detail.allergies?.map((a) => (
                    <div key={a._id} className="py-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">{a.allergen}</div>
                        <div className="text-xs text-[#708197]">{a.reaction || 'Réaction non précisée'}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <StatusBadge label={a.severity} tone={a.severity === 'SEVERE' ? 'danger' : 'warning'} />
                        {canWriteMed && (
                          <button
                            type="button"
                            onClick={() => deleteAllergy(a._id)}
                            className="p-1.5 rounded text-slate-400 hover:text-[#D71920] hover:bg-red-50 dark:hover:bg-red-950/30"
                            aria-label="Supprimer cette allergie"
                          >
                            <span title="Supprimer">
                              <Trash2 className="w-3.5 h-3.5" />
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'medications' && isMed && (
            <div className="space-y-6">
              {canWriteMed && (
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Traitements de fond & Prescriptions actives</h2>
                  {!isTabAddUrl && (
                    <button
                      type="button"
                      onClick={() => navigate(`${patientBasePath}/${PATIENT_TAB_TO_SLUG.medications}/ajouter`)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#073B70] text-white text-xs font-medium"
                    >
                      <Plus className="w-3.5 h-3.5" /> Nouveau traitement
                    </button>
                  )}
                </div>
              )}
              {canWriteMed && (
                <form
                  onSubmit={addMedication}
                  className={`grid grid-cols-1 sm:grid-cols-6 gap-2.5 p-4 rounded-lg border ${
                    isTabAddUrl
                      ? 'bg-[#EAF4FC]/60 dark:bg-[#073B70]/25 border-[#1265A3]'
                      : 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <input
                    type="text"
                    required
                    placeholder="Médicament"
                    value={medForm.name}
                    onChange={(e) => setMedForm({ ...medForm, name: e.target.value })}
                    className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                  />
                  <input
                    type="text"
                    required
                    placeholder="Dosage"
                    value={medForm.dosage}
                    onChange={(e) => setMedForm({ ...medForm, dosage: e.target.value })}
                    className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                  />
                  <input
                    type="text"
                    required
                    placeholder="Posologie"
                    value={medForm.frequency}
                    onChange={(e) => setMedForm({ ...medForm, frequency: e.target.value })}
                    className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                  />
                  <input
                    type="date"
                    value={medForm.startDate}
                    onChange={(e) => setMedForm({ ...medForm, startDate: e.target.value })}
                    aria-label="Date de début"
                    className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
                  />
                  <input
                    type="text"
                    placeholder="Notes"
                    value={medForm.notes}
                    onChange={(e) => setMedForm({ ...medForm, notes: e.target.value })}
                    className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                  />
                  <div className="flex gap-2">
                    <button type="submit" className="flex-1 px-3 py-2 rounded-lg bg-[#073B70] text-white text-xs font-medium">
                      Ajouter
                    </button>
                    {isTabAddUrl && (
                      <button
                        type="button"
                        onClick={() => openTab('medications')}
                        className="px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs"
                      >
                        Fermer
                      </button>
                    )}
                  </div>
                </form>
              )}
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {(detail.medications || []).length === 0 ? (
                  <div className="text-xs text-[#708197] py-4">Aucun traitement enregistré.</div>
                ) : (
                  detail.medications?.map((m) => (
                    <div key={m._id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">{m.name} — {m.dosage}</div>
                        <div className="text-xs text-[#708197]">
                          {m.frequency}
                          {m.startDate ? ` · Début ${formatDateFr(m.startDate)}` : ''}
                          {!m.active && m.endDate ? ` · Arrêté le ${formatDateFr(m.endDate)}` : ''}
                          {m.notes ? ` · ${m.notes}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge label={m.active ? 'En cours' : 'Arrêté'} tone={m.active ? 'success' : 'neutral'} />
                        {canWriteMed && (
                          <button
                            type="button"
                            onClick={() => toggleMedicationStatus(m)}
                            className={`px-2.5 py-1 rounded-lg border text-xs font-medium ${
                              m.active
                                ? 'border-red-200 text-[#D71920] hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/30'
                                : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:text-emerald-300'
                            }`}
                          >
                            {m.active ? 'Arrêter' : 'Reprendre'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'consultations' && isMed && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Consultations cardiologiques</h2>
                {hasPerm(user, 'consultations:write') && (
                  <button
                    type="button"
                    onClick={() => navigate(`/consultations/nouvelle?patientId=${encodeURIComponent(p._id)}`)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#073B70] text-white text-xs font-medium"
                  >
                    <Stethoscope className="w-3.5 h-3.5" /> Nouvelle consultation
                  </button>
                )}
              </div>
              {(detail.consultations || []).length === 0 ? (
                <div className="text-xs text-[#708197]">Aucune consultation enregistrée pour ce patient.</div>
              ) : (
                detail.consultations?.map((c) => (
                  <div key={c._id} className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-sm font-semibold">{c.reason}</span>
                        <span className="text-xs text-[#708197] ml-2 font-mono">{formatDateFr(c.date)} {c.time}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge label={c.status === 'VALIDEE' ? 'Validée' : 'Brouillon'} tone={c.status === 'VALIDEE' ? 'success' : 'warning'} />
                        <button
                          type="button"
                          onClick={() => navigate(`/consultations/${encodeURIComponent(c._id)}`)}
                          className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs hover:bg-slate-50 dark:hover:bg-slate-800"
                        >
                          Ouvrir
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadConsultationPdf(c, p)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs hover:bg-slate-50 dark:hover:bg-slate-800"
                        >
                          <Download className="w-3 h-3" /> PDF
                        </button>
                      </div>
                    </div>
                    {c.confirmedDiagnosis && (
                      <div className="text-xs"><strong>Diagnostic retenu :</strong> {c.confirmedDiagnosis}</div>
                    )}
                    {c.observations && <p className="text-xs text-[#708197]">{c.observations}</p>}
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'vitals' && isMed && (
            <div className="space-y-6">
              {canWriteMed && (
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Relevés de constantes cliniques</h2>
                  {!isTabAddUrl && (
                    <button
                      type="button"
                      onClick={() => navigate(`${patientBasePath}/${PATIENT_TAB_TO_SLUG.vitals}/ajouter`)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#073B70] text-white text-xs font-medium"
                    >
                      <Plus className="w-3.5 h-3.5" /> Saisir des constantes
                    </button>
                  )}
                </div>
              )}
              {canWriteMed && (
                <form
                  onSubmit={addVitals}
                  className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-9 gap-2.5 p-4 rounded-lg border ${
                    isTabAddUrl
                      ? 'bg-[#EAF4FC]/60 dark:bg-[#073B70]/25 border-[#1265A3]'
                      : 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <input type="number" placeholder="TA Sys" value={vitalForm.systolicBP} onChange={(e) => setVitalForm({ ...vitalForm, systolicBP: e.target.value })} className="px-2.5 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs tabular-nums" />
                  <input type="number" placeholder="TA Dia" value={vitalForm.diastolicBP} onChange={(e) => setVitalForm({ ...vitalForm, diastolicBP: e.target.value })} className="px-2.5 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs tabular-nums" />
                  <input type="number" placeholder="FC bpm" value={vitalForm.heartRate} onChange={(e) => setVitalForm({ ...vitalForm, heartRate: e.target.value })} className="px-2.5 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs tabular-nums" />
                  <input type="number" placeholder="FR /min" value={vitalForm.respiratoryRate} onChange={(e) => setVitalForm({ ...vitalForm, respiratoryRate: e.target.value })} className="px-2.5 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs tabular-nums" />
                  <input type="number" step="0.1" placeholder="Poids kg" value={vitalForm.weight} onChange={(e) => setVitalForm({ ...vitalForm, weight: e.target.value })} className="px-2.5 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs tabular-nums" />
                  <input type="number" placeholder="Taille cm" value={vitalForm.height} onChange={(e) => setVitalForm({ ...vitalForm, height: e.target.value })} className="px-2.5 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs tabular-nums" />
                  <input type="number" placeholder="SpO2 %" value={vitalForm.oxygenSaturation} onChange={(e) => setVitalForm({ ...vitalForm, oxygenSaturation: e.target.value })} className="px-2.5 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs tabular-nums" />
                  <input type="number" step="0.1" placeholder="Temp °C" value={vitalForm.temperature} onChange={(e) => setVitalForm({ ...vitalForm, temperature: e.target.value })} className="px-2.5 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs tabular-nums" />
                  <button type="submit" className="px-3 py-2 rounded-lg bg-[#073B70] text-white text-xs font-medium">Enregistrer</button>
                </form>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="text-[#708197] border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-2 pr-3">Date</th>
                      <th className="py-2 pr-3">TA (mmHg)</th>
                      <th className="py-2 pr-3">FC (bpm)</th>
                      <th className="py-2 pr-3">FR (/min)</th>
                      <th className="py-2 pr-3">SpO2</th>
                      <th className="py-2 pr-3">Temp</th>
                      <th className="py-2 pr-3">Poids / Taille</th>
                      <th className="py-2">IMC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono tabular-nums">
                    {(detail.vitals || []).map((v) => (
                      <tr key={v._id}>
                        <td className="py-2.5 pr-3 font-sans">{formatDateTimeFr(v.recordedAt)}</td>
                        <td className="py-2.5 pr-3">{v.systolicBP && v.diastolicBP ? `${v.systolicBP}/${v.diastolicBP}` : '—'}</td>
                        <td className="py-2.5 pr-3">{v.heartRate ?? '—'}</td>
                        <td className="py-2.5 pr-3">{v.respiratoryRate ?? '—'}</td>
                        <td className="py-2.5 pr-3">{v.oxygenSaturation ? `${v.oxygenSaturation}%` : '—'}</td>
                        <td className="py-2.5 pr-3">{v.temperature ? `${v.temperature}°C` : '—'}</td>
                        <td className="py-2.5 pr-3">{v.weight ?? '—'} kg / {v.height ?? '—'} cm</td>
                        <td className="py-2.5">{v.bmi ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'examinations' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Examens cardiologiques</h2>
                {hasPerm(user, 'examinations:prescribe') && (
                  <button
                    type="button"
                    onClick={() => navigate(`/examens/prescrire?patientId=${encodeURIComponent(p._id)}`)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#073B70] text-white text-xs font-medium"
                  >
                    <HeartPulse className="w-3.5 h-3.5" /> Prescrire un examen
                  </button>
                )}
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {detail.examinations.length === 0 ? (
                  <div className="text-xs text-[#708197]">Aucun examen prescrit.</div>
                ) : (
                  detail.examinations.map((ex) => (
                    <div key={ex._id} className="py-3 flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <div className="text-sm font-semibold">
                          {EXAMINATION_TYPE_LABELS[ex.type]}{' '}
                          <span className="font-mono text-xs text-[#708197]">({ex.examNumber})</span>
                        </div>
                        <div className="text-xs text-[#708197]">
                          Prescrit le {formatDateFr(ex.prescriptionDate)}{' '}
                          {ex.scheduledDate ? `· Prévu le ${formatDateFr(ex.scheduledDate)}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge label={EXAMINATION_STATUS_LABELS[ex.status]} tone={ex.status === 'VALIDE' ? 'success' : 'info'} />
                        {ex.status !== 'VALIDE' && ex.status !== 'ANNULE' && hasPerm(user, 'examinations:operate') && (
                          <button
                            type="button"
                            onClick={() => navigate(`/examens/${encodeURIComponent(ex._id)}/operer`)}
                            className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                          >
                            Saisir / Tracé
                          </button>
                        )}
                        {ex.status !== 'VALIDE' && ex.status !== 'ANNULE' && isMed && (
                          <button
                            type="button"
                            onClick={() => navigate(`/examens/${encodeURIComponent(ex._id)}/valider`)}
                            className="px-2.5 py-1 rounded bg-[#073B70] text-white text-xs font-medium hover:bg-[#1265A3]"
                          >
                            Valider
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'results' && isMed && (
            <div className="space-y-4">
              {detail.examinations.filter((e) => e.resultSummary || e.reportText || e.attachedDocumentId).length === 0 ? (
                <div className="text-xs text-[#708197]">Aucun résultat saisi pour ce patient.</div>
              ) : (
                detail.examinations
                  .filter((e) => e.resultSummary || e.reportText || e.attachedDocumentId)
                  .map((ex) => (
                    <div key={ex._id} className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{EXAMINATION_TYPE_LABELS[ex.type]} ({ex.examNumber})</span>
                        <div className="flex items-center gap-2">
                          <StatusBadge label={EXAMINATION_STATUS_LABELS[ex.status]} tone={ex.status === 'VALIDE' ? 'success' : 'warning'} />
                          {ex.attachedDocumentId && (
                            <button
                              type="button"
                              onClick={() =>
                                downloadProtectedFile(
                                  `/api/documents/${ex.attachedDocumentId}/download`,
                                  `${ex.examNumber}.pdf`
                                ).catch((err: any) => notify('error', err.message || 'Téléchargement impossible.'))
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs hover:bg-slate-50 dark:hover:bg-slate-800"
                            >
                              <Download className="w-3 h-3" /> Tracé
                            </button>
                          )}
                        </div>
                      </div>
                      {ex.resultSummary && <p className="text-xs">{ex.resultSummary}</p>}
                      {ex.reportText && <p className="text-xs text-[#708197] whitespace-pre-line">{ex.reportText}</p>}
                    </div>
                  ))
              )}
            </div>
          )}

          {activeTab === 'prescriptions' && isMed && (
            <div className="space-y-4">
              {(detail.prescriptions || []).length === 0 ? (
                <div className="text-xs text-[#708197]">Aucune ordonnance enregistrée.</div>
              ) : (
                detail.prescriptions?.map((pr) => (
                  <div key={pr._id} className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#708197]">
                      <span>Ordonnance du {formatDateFr(pr.date)} · {pr.doctorName || 'Cardiologue'}</span>
                      <button
                        type="button"
                        onClick={() => downloadPrescriptionPdf(pr, p)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-[#073B70] dark:text-sky-300 font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <Download className="w-3 h-3" /> Ordonnance PDF
                      </button>
                    </div>
                    <ul className="space-y-1 text-xs">
                      {pr.lines.map((l, i) => (
                        <li key={i}>• <strong>{l.medication}</strong> {l.dosage} — {l.frequency} ({l.duration})</li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'appointments' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Rendez-vous du patient ({detail.appointments.length})</h2>
                {hasPerm(user, 'appointments:write') && (
                  <button
                    type="button"
                    onClick={() => navigate(`/rendez-vous/nouveau?patientId=${encodeURIComponent(p._id)}`)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#073B70] text-white text-xs font-medium"
                  >
                    <CalendarPlus className="w-3.5 h-3.5" /> Planifier un rendez-vous
                  </button>
                )}
              </div>
              {detail.appointments.length === 0 ? (
                <div className="text-xs text-[#708197]">Aucun rendez-vous enregistré pour ce patient.</div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {detail.appointments.map((a) => (
                    <div key={a._id} className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div>
                        <div className="font-semibold text-sm">{APPOINTMENT_TYPE_LABELS[a.type]}</div>
                        <div className="text-[#708197] mt-0.5">
                          <span className="font-mono">{formatDateFr(a.date)} · {a.startTime}-{a.endTime}</span>
                          {a.doctorName ? ` · ${a.doctorName}` : ''}
                          {a.reason ? ` · ${a.reason}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge
                          label={APPOINTMENT_STATUS_LABELS[a.status]}
                          tone={a.status === 'CONFIRME' || a.status === 'TERMINE' ? 'success' : a.status === 'ANNULE' || a.status === 'ABSENT' ? 'danger' : 'info'}
                        />
                        {hasPerm(user, 'appointments:write') && a.status !== 'TERMINE' && a.status !== 'ANNULE' && (
                          <button
                            type="button"
                            onClick={() => navigate(`/rendez-vous/${encodeURIComponent(a._id)}/modifier`)}
                            className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
                          >
                            Modifier
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'followups' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Suivis & Relances du patient</h2>
                {(hasPerm(user, 'followups:write_admin') || hasPerm(user, 'followups:write_medical')) && (
                  <button
                    type="button"
                    onClick={() => navigate(`${patientBasePath}/${PATIENT_TAB_TO_SLUG.followups}/ajouter`)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#073B70] text-white text-xs font-medium"
                  >
                    <Plus className="w-3.5 h-3.5" /> Programmer un suivi
                  </button>
                )}
              </div>
              {detail.followUps.length === 0 ? (
                <div className="text-xs text-[#708197]">Aucun suivi enregistré.</div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {detail.followUps.map((f) => {
                    const isClosed = f.status === 'TERMINE' || f.status === 'ANNULE';
                    const isMedicalFollowUp = MEDICAL_FOLLOWUP_TYPES.includes(f.type);
                    const canClose = !isMedicalFollowUp || hasPerm(user, 'followups:write_medical');
                    return (
                      <div key={f._id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">{FOLLOWUP_TYPE_LABELS[f.type]}</div>
                          <div className="text-xs text-[#708197]">
                            {f.reason} · Échéance {formatDateFr(f.dueDate)} · {f.assigneeName}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge label={FOLLOWUP_STATUS_LABELS[f.status]} tone={f.status === 'TERMINE' ? 'success' : 'warning'} />
                          {!isClosed && (hasPerm(user, 'followups:write_admin') || hasPerm(user, 'followups:write_medical')) && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setRelanceTarget(f);
                                  setRelanceForm({
                                    status: f.status === 'A_EFFECTUER' ? 'PATIENT_CONTACTE' : f.status,
                                    dueDate: f.dueDate,
                                    assigneeId: f.assigneeId,
                                    contactOutcome: f.contactOutcome || '',
                                    relanceNote: '',
                                  });
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                              >
                                <PhoneCall className="w-3 h-3 text-[#1265A3]" /> Relancer
                              </button>
                              {canClose && (
                                <button
                                  type="button"
                                  onClick={() => setCompleteTarget(f)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 text-white text-xs font-medium"
                                >
                                  <CheckCircle2 className="w-3 h-3" /> Clôturer
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'documents' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Documents médicaux & administratifs</h2>
                {hasPerm(user, 'documents:write') && (
                  <button
                    type="button"
                    onClick={() => navigate(`${patientBasePath}/documents/importer`)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#073B70] text-white text-xs font-medium"
                  >
                    <FileUp className="w-3.5 h-3.5" /> Importer un document
                  </button>
                )}
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {detail.documents.length === 0 ? (
                  <div className="text-xs text-[#708197]">Aucun document disponible.</div>
                ) : (
                  detail.documents.map((d) => (
                    <div key={d._id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <FileText className="w-4 h-4 text-[#1265A3]" />
                        <div>
                          <div className="text-sm font-medium">{d.title}</div>
                          <div className="text-xs text-[#708197]">
                            {DOCUMENT_CATEGORY_LABELS[d.category]} · {formatDateFr(d.createdAt)} ·{' '}
                            {d.sharedWithPatient ? 'Partagé portail' : 'Interne'}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            downloadProtectedFile(
                              `/api/documents/${d._id}/download`,
                              d.originalName || d.title
                            ).catch((err: any) => notify('error', err.message || 'Téléchargement impossible.'))
                          }
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                        >
                          <Download className="w-3.5 h-3.5" /> Ouvrir
                        </button>
                        {canWriteMed && (
                          <button
                            type="button"
                            onClick={() => toggleDocShare(d)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                            {d.sharedWithPatient ? 'Masquer portail' : 'Partager portail'}
                          </button>
                        )}
                        {hasPerm(user, 'documents:write') && (
                          <button
                            type="button"
                            onClick={() => archiveDoc(d)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-[#D71920]"
                            aria-label="Archiver le document"
                          >
                            <span title="Archiver le document">
                              <Archive className="w-3.5 h-3.5" />
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'payments' && hasPerm(user, 'payments:read') && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <span>Facturé : <strong className="font-mono">{formatFcfa(totalBilled)}</strong></span>
                  <span>Réglé : <strong className="font-mono text-emerald-700 dark:text-emerald-400">{formatFcfa(totalPaid)}</strong></span>
                  <span>Solde restant : <strong className="font-mono text-[#D71920]">{formatFcfa(totalRemaining)}</strong></span>
                </div>
                {hasPerm(user, 'payments:write') && (
                  <button
                    type="button"
                    onClick={() => navigate(`/finances/nouveau-paiement?patientId=${encodeURIComponent(p._id)}`)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#073B70] text-white text-xs font-medium"
                  >
                    <CreditCard className="w-3.5 h-3.5" /> Encaisser un paiement
                  </button>
                )}
              </div>
              {patientPayments.length === 0 ? (
                <div className="text-xs text-[#708197]">Aucun paiement enregistré pour ce patient.</div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {patientPayments.map((pay) => (
                    <div key={pay._id} className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div>
                        <div className="font-semibold text-sm">
                          {pay.serviceName}{' '}
                          <span className="font-mono text-xs text-[#1265A3]">({pay.receiptNumber})</span>
                        </div>
                        <div className="text-[#708197] font-mono tabular-nums mt-0.5">
                          {formatDateFr(pay.date)} · {pay.method} · Réglé {formatFcfa(pay.amountPaidFcfa)} / {formatFcfa(pay.totalAmountFcfa)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge
                          label={pay.status === 'PAYE' ? 'Payé' : pay.status === 'PARTIEL' ? 'Partiel' : 'Impayé'}
                          tone={pay.status === 'PAYE' ? 'success' : pay.status === 'PARTIEL' ? 'warning' : 'danger'}
                        />
                        <button
                          type="button"
                          onClick={() => downloadPaymentReceiptPdf(pay)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#EAF4FC] text-[#073B70] font-medium"
                        >
                          <Download className="w-3 h-3" /> Reçu PDF
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'audit' && (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {(detail.auditLogs || []).length === 0 ? (
                <div className="text-[#708197]">Aucun événement d'audit récent pour ce patient.</div>
              ) : (
                detail.auditLogs?.map((log) => (
                  <div key={log._id} className="py-2.5 flex items-center justify-between gap-3">
                    <div>
                      <span className="font-semibold">{log.action}</span> — {log.details}
                      <div className="text-[11px] text-[#708197]">Par {log.actorName}</div>
                    </div>
                    <span className="font-mono text-[11px] text-[#708197] tabular-nums">{formatDateTimeFr(log.createdAt)}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Appointment list preview at bottom of Overview */}
        {activeTab === 'overview' && detail.appointments.length > 0 && (
          <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Derniers rendez-vous du patient</h3>
              <button
                type="button"
                onClick={() => openTab('appointments')}
                className="text-xs font-medium text-[#1265A3] hover:underline"
              >
                Tout voir
              </button>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {detail.appointments.slice(0, 5).map((a) => (
                <div key={a._id} className="py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-medium">{APPOINTMENT_TYPE_LABELS[a.type]}</span>
                    <span className="text-[#708197] ml-2 font-mono">{formatDateFr(a.date)} {a.startTime}</span>
                  </div>
                  <StatusBadge label={APPOINTMENT_STATUS_LABELS[a.status]} tone={a.status === 'TERMINE' ? 'success' : 'info'} />
                </div>
              ))}
            </div>
          </div>
        )}

        {renderPatientFormModal()}

        {/* Medical Record Synthesis / Risk Factors / Alerts Modal */}
        <Modal
          open={isMedRecordEditUrl}
          onClose={() => navigate(patientBasePath)}
          title={`Synthèse médicale & Alertes — ${p.patientNumber}`}
          subtitle="Accessible exclusivement au médecin."
        >
          <form onSubmit={handleSaveMedRecord} className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1">Synthèse clinique globale</label>
              <textarea
                rows={4}
                value={medRecordForm.summary}
                onChange={(e) => setMedRecordForm({ ...medRecordForm, summary: e.target.value })}
                placeholder="Résumé du profil cardiologique, suivi thérapeutique..."
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Facteurs de risque cardiovasculaire (séparés par des virgules)</label>
              <input
                type="text"
                value={medRecordForm.riskFactorsText}
                onChange={(e) => setMedRecordForm({ ...medRecordForm, riskFactorsText: e.target.value })}
                placeholder="HTA, Dyslipidémie, Tabagisme..."
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Alertes cliniques bandeau (séparées par des virgules)</label>
              <input
                type="text"
                value={medRecordForm.medicalAlertsText}
                onChange={(e) => setMedRecordForm({ ...medRecordForm, medicalAlertsText: e.target.value })}
                placeholder="Sous AVK, Pacemaker, Risque hémorragique..."
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => navigate(patientBasePath)} className="px-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700">
                Annuler
              </button>
              <button type="submit" disabled={savingMedRecord} className="px-4 py-2 text-sm rounded-lg bg-[#073B70] text-white font-medium">
                {savingMedRecord ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </div>
          </form>
        </Modal>

        {/* Inline Document Upload Modal (/documents/importer) */}
        <Modal
          open={isDocImportUrl}
          onClose={() => openTab('documents')}
          title={`Importer un document — ${p.patientNumber}`}
          maxWidth="max-w-md"
        >
          <form onSubmit={handleUploadDoc} className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1">Titre du document *</label>
              <input
                type="text"
                required
                value={docForm.title}
                onChange={(e) => setDocForm({ ...docForm, title: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Catégorie *</label>
              <select
                value={docForm.category}
                onChange={(e) => setDocForm({ ...docForm, category: e.target.value as DocumentCategory })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              >
                {Object.entries(DOCUMENT_CATEGORY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Fichier (PDF, PNG, JPEG, WEBP) *</label>
              <input
                type="file"
                required
                accept=".pdf,image/png,image/jpeg,image/webp"
                onChange={(e) => setDocForm({ ...docForm, file: e.target.files?.[0] || null })}
                className="w-full text-xs file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-[#EAF4FC] file:text-[#073B70] file:font-medium"
              />
            </div>
            {canWriteMed && (
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={docForm.sharedWithPatient}
                  onChange={(e) => setDocForm({ ...docForm, sharedWithPatient: e.target.checked })}
                />
                Rendre visible dans le portail patient
              </label>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => openTab('documents')} className="px-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700">
                Annuler
              </button>
              <button type="submit" disabled={uploadingDoc} className="px-4 py-2 text-sm rounded-lg bg-[#073B70] text-white font-medium">
                {uploadingDoc ? 'Importation...' : 'Enregistrer'}
              </button>
            </div>
          </form>
        </Modal>

        {/* Inline Follow-Up Create Modal (/suivis/ajouter) */}
        <Modal
          open={activeTab === 'followups' && isTabAddUrl}
          onClose={() => openTab('followups')}
          title={`Programmer un suivi — ${p.firstName} ${p.lastName}`}
        >
          <form onSubmit={handleCreateFollowUp} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Type de suivi *</label>
                <select
                  value={followUpForm.type}
                  onChange={(e) => setFollowUpForm({ ...followUpForm, type: e.target.value as FollowUpType })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                >
                  {Object.entries(FOLLOWUP_TYPE_LABELS).map(([k, v]) => {
                    const restricted = MEDICAL_FOLLOWUP_TYPES.includes(k as FollowUpType) && !hasPerm(user, 'followups:write_medical');
                    return (
                      <option key={k} value={k} disabled={restricted}>
                        {v} {restricted ? '(Médecin)' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Date d'échéance *</label>
                <input
                  type="date"
                  required
                  value={followUpForm.dueDate}
                  onChange={(e) => setFollowUpForm({ ...followUpForm, dueDate: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Responsable *</label>
                <select
                  required
                  value={followUpForm.assigneeId}
                  onChange={(e) => setFollowUpForm({ ...followUpForm, assigneeId: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                >
                  {(staff.length ? staff : [user]).map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.title ? `${s.title} ` : ''}{s.firstName} {s.lastName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Priorité</label>
                <select
                  value={followUpForm.priority}
                  onChange={(e) => setFollowUpForm({ ...followUpForm, priority: e.target.value as PriorityLevel })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                >
                  {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Motif *</label>
              <input
                type="text"
                required
                value={followUpForm.reason}
                onChange={(e) => setFollowUpForm({ ...followUpForm, reason: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Notes</label>
              <textarea
                rows={2}
                value={followUpForm.notes}
                onChange={(e) => setFollowUpForm({ ...followUpForm, notes: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => openTab('followups')} className="px-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700">
                Annuler
              </button>
              <button type="submit" disabled={savingFollowUp} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-[#073B70] text-white font-medium">
                <Activity className="w-4 h-4" /> Enregistrer
              </button>
            </div>
          </form>
        </Modal>

        {/* Follow-up Relance modal */}
        <Modal
          open={Boolean(relanceTarget)}
          onClose={() => setRelanceTarget(null)}
          title="Relancer / Reporter le suivi"
          maxWidth="max-w-md"
        >
          <form onSubmit={handleRelanceSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Statut</label>
                <select
                  value={relanceForm.status}
                  onChange={(e) => setRelanceForm({ ...relanceForm, status: e.target.value as FollowUpStatus })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                >
                  <option value="EN_COURS">En cours</option>
                  <option value="PATIENT_CONTACTE">Patient contacté</option>
                  <option value="PATIENT_INJOIGNABLE">Patient injoignable</option>
                  <option value="REPORTE">Reporté</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Échéance</label>
                <input
                  type="date"
                  value={relanceForm.dueDate}
                  onChange={(e) => setRelanceForm({ ...relanceForm, dueDate: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Note de relance *</label>
              <textarea
                rows={3}
                required
                value={relanceForm.relanceNote}
                onChange={(e) => setRelanceForm({ ...relanceForm, relanceNote: e.target.value, contactOutcome: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRelanceTarget(null)} className="px-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700">
                Annuler
              </button>
              <button type="submit" disabled={savingFollowUp} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-[#073B70] text-white font-medium">
                <CalendarClock className="w-4 h-4" /> Enregistrer
              </button>
            </div>
          </form>
        </Modal>

        {/* Follow-up Complete modal */}
        <Modal
          open={Boolean(completeTarget)}
          onClose={() => setCompleteTarget(null)}
          title="Clôturer le suivi patient"
          maxWidth="max-w-md"
        >
          <form onSubmit={handleCompleteFollowUp} className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1">Compte rendu de clôture *</label>
              <textarea
                rows={3}
                required
                value={completeForm.contactOutcome}
                onChange={(e) => setCompleteForm({ ...completeForm, contactOutcome: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Prochaine action éventuelle</label>
              <input
                type="text"
                value={completeForm.nextAction}
                onChange={(e) => setCompleteForm({ ...completeForm, nextAction: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setCompleteTarget(null)} className="px-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700">
                Annuler
              </button>
              <button type="submit" disabled={savingFollowUp} className="px-4 py-2 text-sm rounded-lg bg-emerald-600 text-white font-medium">
                Clôturer
              </button>
            </div>
          </form>
        </Modal>

        <ConfirmModal
          open={isArchiveUrl}
          title={p.status === 'ACTIF' ? 'Archiver le dossier patient ?' : 'Réactiver le dossier patient ?'}
          message={
            p.status === 'ACTIF'
              ? `Le dossier de ${p.firstName} ${p.lastName} (${p.patientNumber}) sera archivé selon la politique de conservation médicale sans suppression des données.`
              : `Le dossier ${p.patientNumber} redeviendra actif.`
          }
          confirmLabel={p.status === 'ACTIF' ? 'Archiver' : 'Réactiver'}
          danger={p.status === 'ACTIF'}
          loading={archiving}
          onConfirm={handleArchive}
          onCancel={() => navigate(patientBasePath)}
        />
      </div>
    );
  }

  // ---------------- PATIENTS DIRECTORY LIST VIEW ----------------
  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') loadList();
              }}
              placeholder="Nom, prénom, PAT-..., téléphone"
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F4F7FB] dark:bg-slate-900"
            />
          </div>
          <button
            type="button"
            onClick={() => loadList()}
            className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Rechercher
          </button>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
          >
            <option value="ACTIF">Dossiers actifs</option>
            <option value="ARCHIVE">Dossiers archivés</option>
            <option value="ALL">Tous les dossiers</option>
          </select>

          <select
            value={genderFilter}
            onChange={(e) => setGenderFilter(e.target.value as any)}
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
          >
            <option value="ALL">Tous sexes</option>
            <option value="M">Hommes</option>
            <option value="F">Femmes</option>
          </select>
        </div>

        {hasPerm(user, 'patients:write_admin') && (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[#073B70] hover:bg-[#1265A3] text-white text-sm font-medium whitespace-nowrap"
          >
            <UserPlus className="w-4 h-4" />
            Nouveau patient
          </button>
        )}
      </div>

      {loading ? (
        <TableSkeleton rows={6} />
      ) : patients.length === 0 ? (
        <EmptyState
          title="Aucun dossier patient trouvé"
          description="Modifiez vos critères de recherche ou créez une nouvelle fiche patient."
          actionLabel={hasPerm(user, 'patients:write_admin') ? 'Nouveau patient' : undefined}
          onAction={hasPerm(user, 'patients:write_admin') ? openCreate : undefined}
        />
      ) : (
        <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-xs text-[#708197] border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3 font-medium">Identifiant</th>
                  <th className="px-4 py-3 font-medium">Patient</th>
                  <th className="px-4 py-3 font-medium">Âge / Sexe</th>
                  <th className="px-4 py-3 font-medium">Téléphone</th>
                  <th className="px-4 py-3 font-medium">Statut</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {patients.map((p) => (
                  <tr
                    key={p._id}
                    className="hover:bg-[#EAF4FC]/40 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-[#073B70] dark:text-sky-300 tabular-nums">
                      {p.patientNumber}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => openPatientDossier(p)}
                        className="font-semibold text-[#172B45] dark:text-white hover:text-[#1265A3] text-left"
                      >
                        {p.firstName} {p.lastName}
                      </button>
                      {p.email && <div className="text-xs text-[#708197]">{p.email}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums">
                      {calculateAge(p.birthDate)} · {p.gender}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums">{p.phone}</td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        label={p.status === 'ACTIF' ? 'Actif' : 'Archivé'}
                        tone={p.status === 'ACTIF' ? 'success' : 'neutral'}
                      />
                    </td>
                    <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => openPatientDossier(p)}
                        className="px-2.5 py-1 text-xs font-medium rounded-lg bg-[#EAF4FC] text-[#073B70] dark:bg-[#073B70]/50 dark:text-sky-200 hover:bg-[#1265A3] hover:text-white transition-colors"
                      >
                        Ouvrir dossier
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {renderPatientFormModal()}
    </div>
  );
};
