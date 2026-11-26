import React, { useEffect, useRef, useState } from 'react';
import { CalendarPlus, Download, KeyRound, MapPin, Phone, Save } from 'lucide-react';
import { EmptyState, Modal, StatCard, StatusBadge, TableSkeleton } from '../components/UIPrimitives';
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_TYPE_LABELS,
  CLINIC_DEFAULTS,
  DOCUMENT_CATEGORY_LABELS,
  EXAMINATION_TYPE_LABELS,
  FOLLOWUP_TYPE_LABELS,
} from '../shared/constants';
import type {
  Appointment,
  AppointmentType,
  Examination,
  FollowUp,
  MedicalDocument,
  Patient,
  PublicUser,
} from '../shared/types';
import { apiFetch, downloadProtectedFile, formatDateFr } from '../lib/api';
import { useLiveSync } from '../lib/useLiveSync';
import { navigate, useAppRoute } from '../lib/router';

interface PatientPortalData {
  patient: Patient | null;
  appointments: Appointment[];
  examinations: Examination[];
  followUps: FollowUp[];
  documents: MedicalDocument[];
  clinicInfo?: typeof CLINIC_DEFAULTS;
}

export const PatientPortalPage: React.FC<{
  user?: PublicUser;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
}> = ({ user, notify }) => {
  const route = useAppRoute();
  const [data, setData] = useState<PatientPortalData | null>(null);
  const [doctors, setDoctors] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const coordsCardRef = useRef<HTMLFormElement | null>(null);

  const [reqForm, setReqForm] = useState({
    doctorId: '',
    date: new Date().toISOString().slice(0, 10),
    startTime: '10:00',
    endTime: '10:30',
    type: 'CONSULTATION_SUIVI' as AppointmentType,
    reason: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const [profileForm, setProfileForm] = useState({
    phone: '',
    email: '',
    address: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
  });
  const [savingProfile, setSavingProfile] = useState(false);

  const [pwdForm, setPwdForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [savingPwd, setSavingPwd] = useState(false);

  const patientKey = data?.patient?.patientNumber || route.segments[1] || user?.patientId || 'moi';
  const basePath = `/patient/${encodeURIComponent(patientKey)}`;
  const subAction = route.segments[2] || '';
  const reqOpen = subAction === 'demande-rdv';
  const pwdOpen = subAction === 'mot-de-passe';
  const coordsFocused = subAction === 'coordonnees';

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [dash, docsRes] = await Promise.all([
        apiFetch<PatientPortalData>('/api/dashboard'),
        apiFetch<{ doctors: PublicUser[] }>('/api/users/doctors').catch(() => ({ doctors: [] })),
      ]);
      setData(dash);
      setDoctors(docsRes.doctors);
      if (docsRes.doctors[0] && !reqForm.doctorId) {
        setReqForm((f) => ({ ...f, doctorId: docsRes.doctors[0]._id }));
      }
      if (dash.patient) {
        setProfileForm({
          phone: dash.patient.phone || '',
          email: dash.patient.email || '',
          address: dash.patient.address || '',
          emergencyContactName: dash.patient.emergencyContactName || '',
          emergencyContactPhone: dash.patient.emergencyContactPhone || '',
        });
      }
    } catch (err: any) {
      if (!silent) notify('error', err.message || 'Erreur lors du chargement de votre espace patient.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Canonicalize /patient or /patient/<_id> to /patient/PAT-00001 once patient profile loads
  useEffect(() => {
    if (!data?.patient?.patientNumber) return;
    const expectedSeg = data.patient.patientNumber;
    if (route.segments[0] === 'patient' && route.segments[1] !== expectedSeg) {
      const suffix = subAction ? `/${subAction}` : '';
      navigate(`/patient/${encodeURIComponent(expectedSeg)}${suffix}`, { replace: true });
    }
  }, [data?.patient?.patientNumber, route.segments, subAction]);

  useEffect(() => {
    if (coordsFocused && coordsCardRef.current) {
      coordsCardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [coordsFocused, loading]);

  useLiveSync(
    ['appointment', 'examination', 'followup', 'document', 'patient', 'settings'],
    () => load(true)
  );

  const handleRequestAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiFetch('/api/appointments', {
        method: 'POST',
        body: JSON.stringify(reqForm),
      });
      notify('success', 'Votre demande de rendez-vous a été transmise au secrétariat.');
      navigate(basePath);
      setReqForm((f) => ({ ...f, reason: '' }));
      await load();
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data?.patient) return;
    setSavingProfile(true);
    try {
      await apiFetch(`/api/patients/${data.patient._id}`, {
        method: 'PATCH',
        body: JSON.stringify(profileForm),
      });
      notify('success', 'Vos coordonnées ont été mises à jour.');
      await load();
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwdForm.newPassword !== pwdForm.confirmPassword) {
      notify('error', 'La confirmation ne correspond pas au nouveau mot de passe.');
      return;
    }
    setSavingPwd(true);
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: pwdForm.currentPassword,
          newPassword: pwdForm.newPassword,
        }),
      });
      notify('success', 'Votre mot de passe a été modifié avec succès.');
      setPwdForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      navigate(basePath);
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setSavingPwd(false);
    }
  };

  if (loading) return <TableSkeleton rows={6} />;
  if (!data?.patient) {
    return (
      <EmptyState
        title="Dossier patient non associé"
        description="Votre compte n'est pas encore lié à une fiche patient du cabinet. Contactez l'accueil au +237 693 44 78 10."
      />
    );
  }

  const p = data.patient;
  const clinic = data.clinicInfo || CLINIC_DEFAULTS;
  const upcomingAppts = data.appointments.filter((a) => a.status !== 'ANNULE' && a.status !== 'TERMINE');

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="font-mono text-xs text-[#1265A3] dark:text-sky-400">{p.patientNumber}</div>
          <h1 className="text-xl font-bold text-[#172B45] dark:text-white mt-0.5">
            Espace personnel — {p.firstName} {p.lastName}
          </h1>
          <p className="text-xs text-[#708197] dark:text-slate-400 mt-1">
            Consultez vos rendez-vous, résultats validés par le médecin et documents partagés.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(`${basePath}/mot-de-passe`)}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium whitespace-nowrap"
          >
            <KeyRound className="w-4 h-4 text-[#073B70] dark:text-sky-300" />
            Modifier mon mot de passe
          </button>
          <button
            type="button"
            onClick={() => navigate(`${basePath}/demande-rdv`)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#073B70] hover:bg-[#1265A3] text-white text-sm font-medium whitespace-nowrap"
          >
            <CalendarPlus className="w-4 h-4" />
            Demander un rendez-vous
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Rendez-vous à venir" value={upcomingAppts.length} tone="primary" />
        <StatCard label="Résultats validés disponibles" value={data.examinations.length} tone="success" />
        <StatCard label="Documents partagés" value={data.documents.length} />
        <StatCard label="Prochains contrôles" value={data.followUps.filter((f) => f.status !== 'TERMINE').length} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 space-y-6">
          {/* Appointments */}
          <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 font-semibold text-sm">
              Mes rendez-vous
            </div>
            {data.appointments.length === 0 ? (
              <div className="p-6 text-xs text-[#708197] text-center">Aucun rendez-vous enregistré.</div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.appointments.map((a) => (
                  <div key={a._id} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">{APPOINTMENT_TYPE_LABELS[a.type]}</div>
                      <div className="text-xs text-[#708197] mt-0.5">
                        {formatDateFr(a.date)} · {a.startTime} — {a.doctorName}
                      </div>
                    </div>
                    <StatusBadge
                      label={APPOINTMENT_STATUS_LABELS[a.status]}
                      tone={a.status === 'CONFIRME' ? 'success' : a.status === 'ANNULE' ? 'danger' : 'info'}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Validated & Shared Exam Results */}
          <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 font-semibold text-sm">
              Mes résultats d'examens validés
            </div>
            {data.examinations.length === 0 ? (
              <div className="p-6 text-xs text-[#708197] text-center">
                Aucun résultat validé et partagé pour le moment.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.examinations.map((ex) => (
                  <div key={ex._id} className="p-5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">
                        {EXAMINATION_TYPE_LABELS[ex.type]} ({ex.examNumber})
                      </span>
                      <StatusBadge label="Validé par le médecin" tone="success" />
                    </div>
                    <p className="text-xs text-[#172B45] dark:text-slate-200">{ex.resultSummary}</p>
                    {ex.reportText && (
                      <p className="text-xs text-[#708197] dark:text-slate-400 whitespace-pre-line">
                        {ex.reportText}
                      </p>
                    )}
                    {ex.attachedDocumentId && (
                      <button
                        type="button"
                        onClick={() =>
                          downloadProtectedFile(
                            `/api/documents/${ex.attachedDocumentId}/download`,
                            `${ex.examNumber}.pdf`
                          ).catch((err: any) => notify('error', err.message || 'Téléchargement impossible.'))
                        }
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-[#1265A3] hover:underline"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Télécharger la pièce jointe
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Shared Documents & Follow-ups */}
          <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 font-semibold text-sm">
              Mes documents & Prochains contrôles
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.documents.map((d) => (
                <div key={d._id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{d.title}</div>
                    <div className="text-xs text-[#708197]">
                      {DOCUMENT_CATEGORY_LABELS[d.category]} · {formatDateFr(d.createdAt)}
                    </div>
                  </div>
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
                    <Download className="w-3.5 h-3.5" />
                    Ouvrir
                  </button>
                </div>
              ))}
              {data.followUps.map((f) => (
                <div key={f._id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold">{FOLLOWUP_TYPE_LABELS[f.type]}</div>
                    <div className="text-xs text-[#708197]">
                      {f.reason} · Prévu le {formatDateFr(f.dueDate)}
                    </div>
                  </div>
                  <StatusBadge label={f.status === 'TERMINE' ? 'Effectué' : 'À prévoir'} tone={f.status === 'TERMINE' ? 'success' : 'info'} />
                </div>
              ))}
              {data.documents.length === 0 && data.followUps.length === 0 && (
                <div className="p-6 text-xs text-[#708197] text-center">Aucun document ou contrôle partagé.</div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Editable Personal Info + Clinic Info */}
        <div className="lg:col-span-5 space-y-6">
          <form
            ref={coordsCardRef}
            onSubmit={handleUpdateProfile}
            onFocus={() => {
              if (!coordsFocused) navigate(`${basePath}/coordonnees`, { replace: true });
            }}
            className={`bg-white dark:bg-[#131E30] border rounded-xl p-5 space-y-4 transition-shadow ${
              coordsFocused
                ? 'border-[#1265A3] ring-2 ring-[#1265A3]/20'
                : 'border-slate-200 dark:border-slate-800'
            }`}
          >
            <h2 className="text-sm font-semibold">Mes coordonnées autorisées</h2>
            <div>
              <label className="block text-xs font-medium mb-1">Téléphone</label>
              <input
                type="text"
                required
                value={profileForm.phone}
                onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Adresse e-mail</label>
              <input
                type="email"
                value={profileForm.email}
                onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Adresse</label>
              <input
                type="text"
                value={profileForm.address}
                onChange={(e) => setProfileForm({ ...profileForm, address: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Contact urgence</label>
                <input
                  type="text"
                  value={profileForm.emergencyContactName}
                  onChange={(e) => setProfileForm({ ...profileForm, emergencyContactName: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Tél. urgence</label>
                <input
                  type="text"
                  value={profileForm.emergencyContactPhone}
                  onChange={(e) => setProfileForm({ ...profileForm, emergencyContactPhone: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={savingProfile}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#073B70] hover:bg-[#1265A3] text-white text-xs font-medium"
            >
              <Save className="w-3.5 h-3.5" />
              {savingProfile ? 'Enregistrement...' : 'Mettre à jour mes coordonnées'}
            </button>
          </form>

          <div className="bg-[#073B70] text-white rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-bold">{clinic.clinicName}</h2>
            <p className="text-xs text-sky-200">{clinic.leadDoctorName} — {clinic.specialty}</p>
            <div className="text-xs space-y-1.5 pt-2 border-t border-white/15">
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 shrink-0 mt-0.5 text-sky-300" />
                <span>{clinic.address}, {clinic.city}</span>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 shrink-0 text-sky-300" />
                <span className="font-mono">{clinic.phone}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={reqOpen}
        onClose={() => navigate(basePath)}
        title="Demander un rendez-vous"
        subtitle="Votre demande sera validée par le secrétariat du cabinet."
        maxWidth="max-w-md"
      >
        <form onSubmit={handleRequestAppointment} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Médecin</label>
            <select
              required
              value={reqForm.doctorId}
              onChange={(e) => setReqForm({ ...reqForm, doctorId: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            >
              {doctors.map((d) => (
                <option key={d._id} value={d._id}>
                  {d.title ? `${d.title} ` : ''}{d.firstName} {d.lastName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Type de rendez-vous</label>
            <select
              value={reqForm.type}
              onChange={(e) => setReqForm({ ...reqForm, type: e.target.value as AppointmentType })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            >
              {Object.entries(APPOINTMENT_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs font-medium mb-1">Date souhaitée</label>
              <input
                type="date"
                required
                value={reqForm.date}
                onChange={(e) => setReqForm({ ...reqForm, date: e.target.value })}
                className="w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Début</label>
              <input
                type="time"
                required
                value={reqForm.startTime}
                onChange={(e) => setReqForm({ ...reqForm, startTime: e.target.value })}
                className="w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Fin</label>
              <input
                type="time"
                required
                value={reqForm.endTime}
                onChange={(e) => setReqForm({ ...reqForm, endTime: e.target.value })}
                className="w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Motif</label>
            <textarea
              required
              rows={3}
              value={reqForm.reason}
              onChange={(e) => setReqForm({ ...reqForm, reason: e.target.value })}
              placeholder="Décrivez brièvement votre besoin..."
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => navigate(basePath)}
              className="px-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm rounded-lg bg-[#073B70] text-white font-medium disabled:opacity-50"
            >
              {submitting ? 'Envoi...' : 'Envoyer la demande'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={pwdOpen}
        onClose={() => navigate(basePath)}
        title="Modifier mon mot de passe"
        subtitle="Utilisez un mot de passe personnel d'au moins 8 caractères."
        maxWidth="max-w-md"
      >
        <form onSubmit={handleChangePassword} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Mot de passe actuel</label>
            <input
              type="password"
              required
              value={pwdForm.currentPassword}
              onChange={(e) => setPwdForm({ ...pwdForm, currentPassword: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Nouveau mot de passe (min. 8 caractères)</label>
            <input
              type="password"
              required
              minLength={8}
              value={pwdForm.newPassword}
              onChange={(e) => setPwdForm({ ...pwdForm, newPassword: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Confirmer le nouveau mot de passe</label>
            <input
              type="password"
              required
              minLength={8}
              value={pwdForm.confirmPassword}
              onChange={(e) => setPwdForm({ ...pwdForm, confirmPassword: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => navigate(basePath)}
              className="px-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={savingPwd}
              className="px-4 py-2 text-sm rounded-lg bg-[#073B70] text-white font-medium disabled:opacity-50"
            >
              {savingPwd ? 'Enregistrement...' : 'Mettre à jour'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
