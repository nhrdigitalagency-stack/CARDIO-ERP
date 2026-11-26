import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Edit3,
  FileCheck2,
  Lock,
  Plus,
  ShieldAlert,
  Stethoscope,
  Trash2,
} from 'lucide-react';
import {
  ConfirmModal,
  EmptyState,
  Modal,
  StatusBadge,
  TableSkeleton,
} from '../components/UIPrimitives';
import type {
  Consultation,
  ExaminationType,
  Patient,
  PrescriptionLine,
  PublicUser,
} from '../shared/types';
import { EXAMINATION_TYPE_LABELS } from '../shared/constants';
import { apiFetch, formatDateFr, formatDateTimeFr, hasPerm } from '../lib/api';
import { downloadConsultationPdf } from '../lib/pdfGenerator';
import { buildQuerySuffix, navigate, useAppRoute } from '../lib/router';
import { useLiveSync } from '../lib/useLiveSync';

const EXAM_TYPES = Object.keys(EXAMINATION_TYPE_LABELS) as ExaminationType[];

export const ConsultationsPage: React.FC<{
  user: PublicUser;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
}> = ({ user, notify }) => {
  const route = useAppRoute();
  const seg1 = route.segments[1] || '';
  const seg2 = route.segments[2] || '';
  const isConsultRoot = route.segments[0] === 'consultations';
  const isCreateUrl = isConsultRoot && seg1 === 'nouvelle';
  const urlConsultId = isConsultRoot && seg1 && seg1 !== 'nouvelle' ? seg1 : null;
  const isEditUrl = Boolean(urlConsultId && seg2 === 'modifier');
  const isValidateUrl = Boolean(urlConsultId && seg2 === 'valider');
  const isAmendUrl = Boolean(urlConsultId && seg2 === 'corriger');
  const queryPatientId = route.query.get('patientId') || '';
  const queryAppointmentId = route.query.get('appointmentId') || '';

  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Consultation | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [validateTarget, setValidateTarget] = useState<Consultation | null>(null);
  const [autoFollowUp, setAutoFollowUp] = useState(true);
  const [validating, setValidating] = useState(false);

  const [amendTarget, setAmendTarget] = useState<Consultation | null>(null);
  const [amendForm, setAmendForm] = useState({
    reason: '',
    observations: '',
    confirmedDiagnosis: '',
    treatmentsText: '',
    recommendations: '',
  });
  const [amending, setAmending] = useState(false);

  const [form, setForm] = useState({
    patientId: '',
    date: new Date().toISOString().slice(0, 10),
    time: new Date().toTimeString().slice(0, 5),
    reason: '',
    illnessHistory: '',
    symptoms: '',
    relevantHistory: '',
    clinicalExam: '',
    systolicBP: '',
    diastolicBP: '',
    heartRate: '',
    temperature: '',
    oxygenSaturation: '',
    weight: '',
    height: '',
    respiratoryRate: '',
    observations: '',
    diagnosticHypotheses: '',
    confirmedDiagnosis: '',
    prescribedExams: [] as ExaminationType[],
    treatmentsText: '',
    prescriptionLines: [] as PrescriptionLine[],
    recommendations: '',
    nextControlDate: '',
  });

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [consRes, patRes] = await Promise.all([
        apiFetch<{ consultations: Consultation[] }>('/api/consultations'),
        apiFetch<{ patients: Patient[] }>('/api/patients?status=ACTIF'),
      ]);
      setConsultations(consRes.consultations);
      setPatients(patRes.patients);
      if (patRes.patients[0] && !form.patientId) {
        setForm((f) => ({ ...f, patientId: patRes.patients[0]._id }));
      }
    } catch (err: any) {
      if (!silent) notify('error', err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useLiveSync(
    ['consultation', 'patient', 'appointment', 'examination', 'followup'],
    () => load(true)
  );

  // Sync URL -> selected consultation & form/validate/amend modals
  useEffect(() => {
    if (!isConsultRoot) return;

    if (isCreateUrl) {
      if (!hasPerm(user, 'consultations:write')) {
        navigate('/consultations', { replace: true });
        return;
      }
      setEditingId(null);
      setValidateTarget(null);
      setAmendTarget(null);
      setForm({
        patientId: queryPatientId || patients[0]?._id || '',
        date: new Date().toISOString().slice(0, 10),
        time: new Date().toTimeString().slice(0, 5),
        reason: '',
        illnessHistory: '',
        symptoms: '',
        relevantHistory: '',
        clinicalExam: '',
        systolicBP: '',
        diastolicBP: '',
        heartRate: '',
        temperature: '',
        oxygenSaturation: '',
        weight: '',
        height: '',
        respiratoryRate: '',
        observations: '',
        diagnosticHypotheses: '',
        confirmedDiagnosis: '',
        prescribedExams: [],
        treatmentsText: '',
        prescriptionLines: [],
        recommendations: '',
        nextControlDate: '',
      });
      return;
    }

    if (urlConsultId) {
      const match = consultations.find((c) => c._id === urlConsultId);
      if (!match) {
        if (!loading) {
          navigate('/consultations', { replace: true });
        }
        return;
      }
      setSelected(match);

      if (isEditUrl) {
        if (match.status === 'VALIDEE' || !hasPerm(user, 'consultations:write')) {
          navigate(`/consultations/${encodeURIComponent(match._id)}`, { replace: true });
          return;
        }
        setEditingId(match._id);
        setValidateTarget(null);
        setAmendTarget(null);
        setForm({
          patientId: match.patientId,
          date: match.date,
          time: match.time,
          reason: match.reason,
          illnessHistory: match.illnessHistory || '',
          symptoms: match.symptoms || '',
          relevantHistory: match.relevantHistory || '',
          clinicalExam: match.clinicalExam || '',
          systolicBP: match.vitals?.systolicBP?.toString() || '',
          diastolicBP: match.vitals?.diastolicBP?.toString() || '',
          heartRate: match.vitals?.heartRate?.toString() || '',
          temperature: match.vitals?.temperature?.toString() || '',
          oxygenSaturation: match.vitals?.oxygenSaturation?.toString() || '',
          weight: match.vitals?.weight?.toString() || '',
          height: match.vitals?.height?.toString() || '',
          respiratoryRate: match.vitals?.respiratoryRate?.toString() || '',
          observations: match.observations || '',
          diagnosticHypotheses: match.diagnosticHypotheses || '',
          confirmedDiagnosis: match.confirmedDiagnosis || '',
          prescribedExams: match.prescribedExams || [],
          treatmentsText: match.treatmentsText || '',
          prescriptionLines: match.prescriptionLines || [],
          recommendations: match.recommendations || '',
          nextControlDate: match.nextControlDate || '',
        });
      } else if (isValidateUrl) {
        if (match.status !== 'BROUILLON' || !hasPerm(user, 'consultations:validate')) {
          navigate(`/consultations/${encodeURIComponent(match._id)}`, { replace: true });
          return;
        }
        setEditingId(null);
        setAmendTarget(null);
        setValidateTarget(match);
      } else if (isAmendUrl) {
        if (match.status !== 'VALIDEE' || !hasPerm(user, 'consultations:validate')) {
          navigate(`/consultations/${encodeURIComponent(match._id)}`, { replace: true });
          return;
        }
        setEditingId(null);
        setValidateTarget(null);
        setAmendTarget(match);
        setAmendForm({
          reason: '',
          observations: match.observations || '',
          confirmedDiagnosis: match.confirmedDiagnosis || '',
          treatmentsText: match.treatmentsText || '',
          recommendations: match.recommendations || '',
        });
      } else {
        setEditingId(null);
        setValidateTarget(null);
        setAmendTarget(null);
      }
      return;
    }

    setSelected(null);
    setEditingId(null);
    setValidateTarget(null);
    setAmendTarget(null);
  }, [isConsultRoot, isCreateUrl, urlConsultId, isEditUrl, isValidateUrl, isAmendUrl, queryPatientId, consultations, patients, loading]);

  const computedBmi = (() => {
    const w = Number(form.weight);
    const h = Number(form.height);
    if (w > 0 && h > 0) {
      const hm = h / 100;
      return (w / (hm * hm)).toFixed(1);
    }
    return '—';
  })();

  const openNew = () => {
    navigate(`/consultations/nouvelle${buildQuerySuffix({ patientId: queryPatientId || undefined })}`);
  };

  const openDraftEdit = (c: Consultation) => {
    if (c.status === 'VALIDEE') return;
    navigate(`/consultations/${encodeURIComponent(c._id)}/modifier`);
  };

  const closeFormModal = () => {
    if (editingId) {
      navigate(`/consultations/${encodeURIComponent(editingId)}`);
    } else if (urlConsultId) {
      navigate(`/consultations/${encodeURIComponent(urlConsultId)}`);
    } else {
      navigate('/consultations');
    }
  };

  const handleSaveDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const payload = {
      patientId: form.patientId,
      appointmentId: !editingId && queryAppointmentId ? queryAppointmentId : undefined,
      date: form.date,
      time: form.time,
      reason: form.reason,
      illnessHistory: form.illnessHistory,
      symptoms: form.symptoms,
      relevantHistory: form.relevantHistory,
      clinicalExam: form.clinicalExam,
      vitals: {
        systolicBP: form.systolicBP ? Number(form.systolicBP) : undefined,
        diastolicBP: form.diastolicBP ? Number(form.diastolicBP) : undefined,
        heartRate: form.heartRate ? Number(form.heartRate) : undefined,
        temperature: form.temperature ? Number(form.temperature) : undefined,
        oxygenSaturation: form.oxygenSaturation ? Number(form.oxygenSaturation) : undefined,
        weight: form.weight ? Number(form.weight) : undefined,
        height: form.height ? Number(form.height) : undefined,
        respiratoryRate: form.respiratoryRate ? Number(form.respiratoryRate) : undefined,
      },
      observations: form.observations,
      diagnosticHypotheses: form.diagnosticHypotheses,
      confirmedDiagnosis: form.confirmedDiagnosis,
      prescribedExams: form.prescribedExams,
      treatmentsText: form.treatmentsText,
      prescriptionLines: form.prescriptionLines.filter((l) => l.medication.trim()),
      recommendations: form.recommendations,
      nextControlDate: form.nextControlDate || undefined,
    };

    try {
      if (editingId) {
        const res = await apiFetch<{ consultation: Consultation }>(`/api/consultations/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        notify('success', 'Brouillon mis à jour.');
        await load();
        navigate(`/consultations/${encodeURIComponent(res.consultation._id)}`);
      } else {
        const res = await apiFetch<{ consultation: Consultation }>('/api/consultations', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        notify('success', 'Consultation enregistrée en brouillon.');
        await load();
        navigate(`/consultations/${encodeURIComponent(res.consultation._id)}`);
      }
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleValidate = async () => {
    if (!validateTarget) return;
    setValidating(true);
    try {
      const res = await apiFetch<{ consultation: Consultation }>(`/api/consultations/${validateTarget._id}/validate`, {
        method: 'POST',
        body: JSON.stringify({ autoCreateFollowUp: autoFollowUp }),
      });
      notify('success', 'Consultation validée et verrouillée. Examens et ordonnances créés.');
      await load();
      navigate(`/consultations/${encodeURIComponent(res.consultation._id)}`);
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setValidating(false);
    }
  };

  const openAmend = (c: Consultation) => {
    navigate(`/consultations/${encodeURIComponent(c._id)}/corriger`);
  };

  const handleAmend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amendTarget) return;
    setAmending(true);
    try {
      const res = await apiFetch<{ consultation: Consultation }>(`/api/consultations/${amendTarget._id}/amend`, {
        method: 'POST',
        body: JSON.stringify(amendForm),
      });
      notify('success', 'Correction horodatée enregistrée.');
      await load();
      navigate(`/consultations/${encodeURIComponent(res.consultation._id)}`);
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setAmending(false);
    }
  };

  const toggleExam = (t: ExaminationType) => {
    setForm((prev) => ({
      ...prev,
      prescribedExams: prev.prescribedExams.includes(t)
        ? prev.prescribedExams.filter((x) => x !== t)
        : [...prev.prescribedExams, t],
    }));
  };

  const addPrescriptionLine = () => {
    setForm((prev) => ({
      ...prev,
      prescriptionLines: [
        ...prev.prescriptionLines,
        { medication: '', dosage: '', frequency: '', duration: '', instructions: '' },
      ],
    }));
  };

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-base font-bold text-[#172B45] dark:text-white">
            Consultations cardiologiques
          </h1>
          <p className="text-xs text-[#708197] dark:text-slate-400">
            Saisie clinique, constantes avec IMC automatique, validation verrouillée et corrections tracées
          </p>
        </div>
        {hasPerm(user, 'consultations:write') && (
          <button
            type="button"
            onClick={openNew}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#073B70] hover:bg-[#1265A3] text-white text-sm font-medium"
          >
            <Stethoscope className="w-4 h-4" />
            Nouvelle consultation
          </button>
        )}
      </div>

      {loading ? (
        <TableSkeleton rows={5} />
      ) : consultations.length === 0 ? (
        <EmptyState
          title="Aucune consultation enregistrée"
          description="Créez une nouvelle consultation en brouillon ou validez un acte médical."
          actionLabel={hasPerm(user, 'consultations:write') ? 'Nouvelle consultation' : undefined}
          onAction={hasPerm(user, 'consultations:write') ? openNew : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Consultation List */}
          <div className="lg:col-span-5 bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
            {consultations.map((c) => (
              <button
                key={c._id}
                type="button"
                onClick={() => navigate(`/consultations/${encodeURIComponent(c._id)}`)}
                className={`w-full text-left p-4 hover:bg-[#EAF4FC]/40 dark:hover:bg-slate-800/50 transition-colors ${
                  selected?._id === c._id ? 'bg-[#EAF4FC]/60 dark:bg-[#073B70]/30' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-[#172B45] dark:text-white">
                      {c.patientName}
                    </div>
                    <div className="text-xs text-[#708197] mt-0.5">{c.reason}</div>
                    <div className="text-[11px] font-mono text-[#708197] mt-1 tabular-nums">
                      {formatDateFr(c.date)} · {c.time} · {c.patientNumber}
                    </div>
                  </div>
                  <StatusBadge
                    label={c.status === 'VALIDEE' ? 'Validée' : 'Brouillon'}
                    tone={c.status === 'VALIDEE' ? 'success' : 'warning'}
                  />
                </div>
              </button>
            ))}
          </div>

          {/* Detail Panel */}
          <div className="lg:col-span-7 bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl p-6">
            {!selected ? (
              <div className="text-center py-16 text-sm text-[#708197]">
                Sélectionnez une consultation pour afficher son compte rendu détaillé.
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-[#1265A3]">{selected.patientNumber}</span>
                      <StatusBadge
                        label={selected.status === 'VALIDEE' ? 'Validée & Verrouillée' : 'Brouillon modifiable'}
                        tone={selected.status === 'VALIDEE' ? 'success' : 'warning'}
                      />
                    </div>
                    <h2 className="text-lg font-bold mt-1">{selected.patientName}</h2>
                    <p className="text-xs text-[#708197]">
                      {formatDateFr(selected.date)} à {selected.time} · {selected.doctorName}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        downloadConsultationPdf(
                          selected,
                          patients.find((p) => p._id === selected.patientId)
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <Download className="w-3.5 h-3.5" /> Compte rendu PDF
                    </button>

                    {selected.status === 'BROUILLON' && hasPerm(user, 'consultations:write') && (
                      <button
                        type="button"
                        onClick={() => openDraftEdit(selected)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
                      >
                        <Edit3 className="w-3.5 h-3.5" /> Modifier brouillon
                      </button>
                    )}

                    {selected.status === 'BROUILLON' && hasPerm(user, 'consultations:validate') && (
                      <button
                        type="button"
                        onClick={() =>
                          navigate(`/consultations/${encodeURIComponent(selected._id)}/valider`)
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium"
                      >
                        <FileCheck2 className="w-3.5 h-3.5" /> Valider consultation
                      </button>
                    )}

                    {selected.status === 'VALIDEE' && hasPerm(user, 'consultations:validate') && (
                      <button
                        type="button"
                        onClick={() => openAmend(selected)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-300 text-amber-800 dark:text-amber-300 text-xs font-medium"
                      >
                        <Lock className="w-3.5 h-3.5" /> Corriger (tracé)
                      </button>
                    )}
                  </div>
                </div>

                {/* Vitals strip */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs font-mono tabular-nums">
                  <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/50">
                    <div className="text-[11px] font-sans text-[#708197]">Tension artérielle</div>
                    <div className="font-semibold mt-0.5">
                      {selected.vitals?.systolicBP && selected.vitals?.diastolicBP
                        ? `${selected.vitals.systolicBP}/${selected.vitals.diastolicBP} mmHg`
                        : '—'}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/50">
                    <div className="text-[11px] font-sans text-[#708197]">Fréquence cardiaque</div>
                    <div className="font-semibold mt-0.5">
                      {selected.vitals?.heartRate ? `${selected.vitals.heartRate} bpm` : '—'}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/50">
                    <div className="text-[11px] font-sans text-[#708197]">SpO2 / Temp</div>
                    <div className="font-semibold mt-0.5">
                      {selected.vitals?.oxygenSaturation ?? '—'}% · {selected.vitals?.temperature ?? '—'}°C
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/50">
                    <div className="text-[11px] font-sans text-[#708197]">Poids / IMC</div>
                    <div className="font-semibold mt-0.5">
                      {selected.vitals?.weight ?? '—'} kg · IMC {selected.vitals?.bmi ?? '—'}
                    </div>
                  </div>
                </div>

                <div className="space-y-3 text-sm">
                  <div>
                    <div className="text-xs font-semibold text-[#708197]">Motif & Symptômes</div>
                    <p className="mt-0.5">{selected.reason}</p>
                    {selected.symptoms && <p className="text-xs text-[#708197] mt-1">{selected.symptoms}</p>}
                  </div>

                  {selected.clinicalExam && (
                    <div>
                      <div className="text-xs font-semibold text-[#708197]">Examen clinique</div>
                      <p className="mt-0.5 text-xs whitespace-pre-line">{selected.clinicalExam}</p>
                    </div>
                  )}

                  {(selected.confirmedDiagnosis || selected.diagnosticHypotheses) && (
                    <div>
                      <div className="text-xs font-semibold text-[#708197]">Diagnostic retenu / Hypothèses</div>
                      <p className="mt-0.5 font-medium text-[#073B70] dark:text-sky-300">
                        {selected.confirmedDiagnosis || selected.diagnosticHypotheses}
                      </p>
                    </div>
                  )}

                  {selected.prescribedExams && selected.prescribedExams.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-[#708197] mb-1">Examens prescrits</div>
                      <div className="flex flex-wrap gap-1.5">
                        {selected.prescribedExams.map((t) => (
                          <StatusBadge key={t} label={EXAMINATION_TYPE_LABELS[t] || t} tone="info" />
                        ))}
                      </div>
                    </div>
                  )}

                  {selected.prescriptionLines && selected.prescriptionLines.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-[#708197] mb-1">Ordonnance</div>
                      <ul className="space-y-1 text-xs bg-slate-50 dark:bg-slate-900/50 p-3 rounded-lg">
                        {selected.prescriptionLines.map((l, i) => (
                          <li key={i}>
                            • <strong>{l.medication}</strong> {l.dosage} — {l.frequency} ({l.duration})
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {selected.recommendations && (
                    <div>
                      <div className="text-xs font-semibold text-[#708197]">Recommandations & Prochain contrôle</div>
                      <p className="text-xs mt-0.5">{selected.recommendations}</p>
                      {selected.nextControlDate && (
                        <p className="text-xs font-mono text-[#1265A3] mt-1">
                          Prochain contrôle : {formatDateFr(selected.nextControlDate)}
                        </p>
                      )}
                    </div>
                  )}

                  {selected.corrections && selected.corrections.length > 0 && (
                    <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                      <div className="text-xs font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        Historique des corrections post-validation
                      </div>
                      {selected.corrections.map((corr, idx) => (
                        <div key={idx} className="text-xs p-2.5 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900">
                          <div className="font-semibold">
                            {corr.correctedByName} · {formatDateTimeFr(corr.correctedAt)}
                          </div>
                          <div>Motif : {corr.reason}</div>
                          <div className="text-[#708197]">{corr.changesSummary}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Consultation Form Modal */}
      <Modal
        open={isCreateUrl || Boolean(isEditUrl && editingId)}
        onClose={closeFormModal}
        title={editingId ? 'Modifier le brouillon de consultation' : 'Nouvelle consultation médicale'}
        subtitle="Calcul automatique de l'IMC · Enregistrement en brouillon avant validation."
        maxWidth="max-w-4xl"
      >
        <form onSubmit={handleSaveDraft} className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Patient *</label>
              <select
                required
                disabled={Boolean(editingId)}
                value={form.patientId}
                onChange={(e) => setForm({ ...form, patientId: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              >
                {patients.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.patientNumber} — {p.firstName} {p.lastName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Date *</label>
              <input
                type="date"
                required
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Heure *</label>
              <input
                type="time"
                required
                value={form.time}
                onChange={(e) => setForm({ ...form, time: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Motif de consultation *</label>
              <input
                type="text"
                required
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Symptômes</label>
              <input
                type="text"
                value={form.symptoms}
                onChange={(e) => setForm({ ...form, symptoms: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
          </div>

          {/* Vitals */}
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">Constantes cliniques</span>
              <span className="text-xs font-mono text-[#073B70] dark:text-sky-300">IMC calculé : {computedBmi}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
              <input type="number" placeholder="TA Sys" value={form.systolicBP} onChange={(e) => setForm({ ...form, systolicBP: e.target.value })} className="px-2.5 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs" />
              <input type="number" placeholder="TA Dia" value={form.diastolicBP} onChange={(e) => setForm({ ...form, diastolicBP: e.target.value })} className="px-2.5 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs" />
              <input type="number" placeholder="FC bpm" value={form.heartRate} onChange={(e) => setForm({ ...form, heartRate: e.target.value })} className="px-2.5 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs" />
              <input type="number" step="0.1" placeholder="Temp °C" value={form.temperature} onChange={(e) => setForm({ ...form, temperature: e.target.value })} className="px-2.5 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs" />
              <input type="number" placeholder="SpO2 %" value={form.oxygenSaturation} onChange={(e) => setForm({ ...form, oxygenSaturation: e.target.value })} className="px-2.5 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs" />
              <input type="number" step="0.1" placeholder="Poids kg" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} className="px-2.5 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs" />
              <input type="number" placeholder="Taille cm" value={form.height} onChange={(e) => setForm({ ...form, height: e.target.value })} className="px-2.5 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs" />
              <input type="number" placeholder="FR /min" value={form.respiratoryRate} onChange={(e) => setForm({ ...form, respiratoryRate: e.target.value })} className="px-2.5 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Histoire de la maladie / Antécédents pertinents</label>
              <textarea rows={2} value={form.illnessHistory} onChange={(e) => setForm({ ...form, illnessHistory: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Examen clinique & Auscultation</label>
              <textarea rows={2} value={form.clinicalExam} onChange={(e) => setForm({ ...form, clinicalExam: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Hypothèses diagnostiques</label>
              <input type="text" value={form.diagnosticHypotheses} onChange={(e) => setForm({ ...form, diagnosticHypotheses: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Diagnostic retenu (libre)</label>
              <input type="text" value={form.confirmedDiagnosis} onChange={(e) => setForm({ ...form, confirmedDiagnosis: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5">Examens cardiologiques à prescrire</label>
            <div className="flex flex-wrap gap-2">
              {EXAM_TYPES.map((t) => {
                const active = form.prescribedExams.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleExam(t)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs border transition-colors ${
                      active
                        ? 'bg-[#073B70] text-white border-[#073B70]'
                        : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {EXAMINATION_TYPE_LABELS[t]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Structured Prescription lines */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium">Prescription médicamenteuse</label>
              <button type="button" onClick={addPrescriptionLine} className="inline-flex items-center gap-1 text-xs font-medium text-[#1265A3] hover:underline">
                <Plus className="w-3.5 h-3.5" /> Ajouter une ligne
              </button>
            </div>
            {form.prescriptionLines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-center">
                <input type="text" placeholder="Médicament" value={line.medication} onChange={(e) => {
                  const next = [...form.prescriptionLines];
                  next[idx] = { ...line, medication: e.target.value };
                  setForm({ ...form, prescriptionLines: next });
                }} className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs" />
                <input type="text" required={Boolean(line.medication.trim())} placeholder="Dosage" value={line.dosage} onChange={(e) => {
                  const next = [...form.prescriptionLines];
                  next[idx] = { ...line, dosage: e.target.value };
                  setForm({ ...form, prescriptionLines: next });
                }} className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs" />
                <input type="text" required={Boolean(line.medication.trim())} placeholder="Posologie" value={line.frequency} onChange={(e) => {
                  const next = [...form.prescriptionLines];
                  next[idx] = { ...line, frequency: e.target.value };
                  setForm({ ...form, prescriptionLines: next });
                }} className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs" />
                <input type="text" required={Boolean(line.medication.trim())} placeholder="Durée" value={line.duration} onChange={(e) => {
                  const next = [...form.prescriptionLines];
                  next[idx] = { ...line, duration: e.target.value };
                  setForm({ ...form, prescriptionLines: next });
                }} className="px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs" />
                <button type="button" onClick={() => setForm({ ...form, prescriptionLines: form.prescriptionLines.filter((_, i) => i !== idx) })} className="text-xs text-[#D71920] inline-flex items-center gap-1">
                  <Trash2 className="w-3.5 h-3.5" /> Retirer
                </button>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium mb-1">Observations & Recommandations</label>
              <textarea rows={2} value={form.recommendations} onChange={(e) => setForm({ ...form, recommendations: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Date du prochain contrôle</label>
              <input type="date" value={form.nextControlDate} onChange={(e) => setForm({ ...form, nextControlDate: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs" />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={closeFormModal} className="px-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700">
              Annuler
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-[#073B70] text-white font-medium disabled:opacity-50">
              {saving ? 'Enregistrement...' : 'Enregistrer en brouillon'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Validate Confirmation */}
      <Modal
        open={Boolean(isValidateUrl && validateTarget)}
        onClose={() =>
          navigate(validateTarget ? `/consultations/${encodeURIComponent(validateTarget._id)}` : '/consultations')
        }
        title="Valider et verrouiller la consultation ?"
        maxWidth="max-w-md"
      >
        <div className="space-y-4 text-sm">
          <p className="text-[#708197]">
            Une fois validée, cette consultation ne pourra plus être modifiée silencieusement. Les examens prescrits et ordonnances seront générés automatiquement.
          </p>
          {validateTarget?.nextControlDate && (
            <label className="flex items-center gap-2 text-xs p-3 rounded-lg bg-[#EAF4FC] dark:bg-[#073B70]/30">
              <input type="checkbox" checked={autoFollowUp} onChange={(e) => setAutoFollowUp(e.target.checked)} />
              Programmer automatiquement le suivi pour le {formatDateFr(validateTarget.nextControlDate)}
            </label>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() =>
                navigate(validateTarget ? `/consultations/${encodeURIComponent(validateTarget._id)}` : '/consultations')
              }
              className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700"
            >
              Annuler
            </button>
            <button type="button" disabled={validating} onClick={handleValidate} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium">
              <CheckCircle2 className="w-4 h-4" /> {validating ? 'Validation...' : 'Valider définitivement'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Timestamped Amendment Modal */}
      <Modal
        open={Boolean(isAmendUrl && amendTarget)}
        onClose={() =>
          navigate(amendTarget ? `/consultations/${encodeURIComponent(amendTarget._id)}` : '/consultations')
        }
        title="Correction horodatée d'une consultation validée"
        subtitle="Toute modification crée une trace inaltérable avec auteur, date et motif."
      >
        <form onSubmit={handleAmend} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Motif obligatoire de la correction *</label>
            <input
              type="text"
              required
              minLength={5}
              value={amendForm.reason}
              onChange={(e) => setAmendForm({ ...amendForm, reason: e.target.value })}
              placeholder="ex. Précision posologie suite appel patient..."
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Diagnostic retenu</label>
            <input
              type="text"
              value={amendForm.confirmedDiagnosis}
              onChange={(e) => setAmendForm({ ...amendForm, confirmedDiagnosis: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Observations</label>
            <textarea
              rows={3}
              value={amendForm.observations}
              onChange={(e) => setAmendForm({ ...amendForm, observations: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Recommandations</label>
            <textarea
              rows={2}
              value={amendForm.recommendations}
              onChange={(e) => setAmendForm({ ...amendForm, recommendations: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() =>
                navigate(amendTarget ? `/consultations/${encodeURIComponent(amendTarget._id)}` : '/consultations')
              }
              className="px-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700"
            >
              Annuler
            </button>
            <button type="submit" disabled={amending} className="px-4 py-2 text-sm rounded-lg bg-[#073B70] text-white font-medium">
              {amending ? 'Enregistrement...' : 'Enregistrer la correction tracée'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
