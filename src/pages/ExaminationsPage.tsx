import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileUp,
  HeartPulse,
  Plus,
  Stethoscope,
} from 'lucide-react';
import {
  EmptyState,
  Modal,
  StatusBadge,
  TableSkeleton,
} from '../components/UIPrimitives';
import type {
  Examination,
  ExaminationStatus,
  ExaminationType,
  Patient,
  PublicUser,
} from '../shared/types';
import {
  EXAMINATION_STATUS_LABELS,
  EXAMINATION_TYPE_LABELS,
} from '../shared/constants';
import { apiFetch, downloadProtectedFile, formatDateFr, hasPerm } from '../lib/api';
import { buildQuerySuffix, navigate, useAppRoute } from '../lib/router';
import { useLiveSync } from '../lib/useLiveSync';

export const ExaminationsPage: React.FC<{
  user: PublicUser;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
}> = ({ user, notify }) => {
  const route = useAppRoute();
  const isRoot = route.segments[0] === 'examens';
  const seg1 = route.segments[1] || '';
  const seg2 = route.segments[2] || '';
  const isPrescribeUrl = isRoot && seg1 === 'prescrire';
  const urlExamId = isRoot && seg1 && seg1 !== 'prescrire' ? seg1 : null;
  const isOperateUrl = Boolean(urlExamId && seg2 === 'operer');
  const isValidateUrl = Boolean(urlExamId && seg2 === 'valider');
  const queryPatientId = route.query.get('patientId') || '';
  const statusFilter = route.query.get('statut') || '';
  const typeFilter = route.query.get('type') || '';

  const [exams, setExams] = useState<Examination[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);

  const [createForm, setCreateForm] = useState({
    patientId: queryPatientId,
    type: 'ECG' as ExaminationType,
    scheduledDate: '',
    technicalNotes: '',
  });
  const [saving, setSaving] = useState(false);

  const [operateTarget, setOperateTarget] = useState<Examination | null>(null);
  const [operateForm, setOperateForm] = useState({
    status: 'REALISE' as ExaminationStatus,
    scheduledDate: '',
    performedDate: new Date().toISOString().slice(0, 10),
    operatorName: '',
    technicalNotes: '',
    resultSummary: '',
    file: null as File | null,
  });

  const [validateTarget, setValidateTarget] = useState<Examination | null>(null);
  const [validateForm, setValidateForm] = useState({
    resultSummary: '',
    reportText: '',
    sharedWithPatient: true,
  });

  const isDoctor = hasPerm(user, 'examinations:validate');

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (statusFilter) qs.set('status', statusFilter);
      if (typeFilter) qs.set('type', typeFilter);

      const [exRes, patRes] = await Promise.all([
        apiFetch<{ examinations: Examination[] }>(`/api/examinations?${qs.toString()}`),
        apiFetch<{ patients: Patient[] }>('/api/patients?status=ACTIF'),
      ]);
      setExams(exRes.examinations);
      setPatients(patRes.patients);
      if (patRes.patients[0] && !createForm.patientId) {
        setCreateForm((f) => ({ ...f, patientId: patRes.patients[0]._id }));
      }
    } catch (err: any) {
      if (!silent) notify('error', err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const filterQuery = buildQuerySuffix({
    type: typeFilter || undefined,
    statut: statusFilter || undefined,
  });

  const setFilter = (nextType: string, nextStatus: string) => {
    navigate(
      `/examens${buildQuerySuffix({
        type: nextType || undefined,
        statut: nextStatus || undefined,
      })}`
    );
  };

  useEffect(() => {
    load();
  }, [statusFilter, typeFilter]);

  useLiveSync(['examination', 'document', 'patient'], () => load(true));

  // Sync URL -> prescribe, operate, validate modals
  useEffect(() => {
    if (!isRoot) return;
    if (isPrescribeUrl) {
      if (!hasPerm(user, 'examinations:prescribe')) {
        navigate(`/examens${filterQuery}`, { replace: true });
        return;
      }
      setOperateTarget(null);
      setValidateTarget(null);
      setCreateForm((f) => ({
        ...f,
        patientId: queryPatientId || f.patientId || patients[0]?._id || '',
      }));
      return;
    }

    if (urlExamId && (isOperateUrl || isValidateUrl)) {
      const match = exams.find((e) => e._id === urlExamId);
      if (!match) {
        if (!loading) {
          navigate(`/examens${filterQuery}`, { replace: true });
        }
        return;
      }
      if (isOperateUrl) {
        if (!hasPerm(user, 'examinations:operate') || match.status === 'VALIDE') {
          navigate(`/examens${filterQuery}`, { replace: true });
          return;
        }
        setValidateTarget(null);
        setOperateTarget(match);
        setOperateForm({
          status: match.status === 'PRESCRIT' ? 'PROGRAMME' : 'A_INTERPRETER',
          scheduledDate: match.scheduledDate || '',
          performedDate: match.performedDate || new Date().toISOString().slice(0, 10),
          operatorName: match.operatorName || '',
          technicalNotes: match.technicalNotes || '',
          resultSummary: match.resultSummary || '',
          file: null,
        });
      } else if (isValidateUrl) {
        if (!isDoctor || match.status === 'VALIDE' || match.status === 'ANNULE') {
          navigate(`/examens${filterQuery}`, { replace: true });
          return;
        }
        setOperateTarget(null);
        setValidateTarget(match);
        setValidateForm({
          resultSummary: match.resultSummary || '',
          reportText: match.reportText || '',
          sharedWithPatient: match.sharedWithPatient ?? true,
        });
      }
      return;
    }

    setOperateTarget(null);
    setValidateTarget(null);
  }, [isRoot, isPrescribeUrl, urlExamId, isOperateUrl, isValidateUrl, queryPatientId, exams, patients, loading]);

  const closeModal = () => {
    navigate(`/examens${filterQuery}`);
  };

  const handlePrescribe = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/examinations', {
        method: 'POST',
        body: JSON.stringify(createForm),
      });
      notify('success', 'Examen cardiologique prescrit.');
      closeModal();
      await load();
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setSaving(false);
    }
  };

  const openOperate = (ex: Examination) => {
    navigate(`/examens/${encodeURIComponent(ex._id)}/operer${filterQuery}`);
  };

  const handleOperateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!operateTarget) return;
    setSaving(true);
    try {
      let attachedDocumentId = operateTarget.attachedDocumentId;
      if (operateForm.file) {
        const fd = new FormData();
        fd.append('file', operateForm.file);
        fd.append('title', `${EXAMINATION_TYPE_LABELS[operateTarget.type]} (${operateTarget.examNumber})`);
        fd.append('category', 'COMPTE_RENDU');
        fd.append('patientId', operateTarget.patientId);
        fd.append('examinationId', operateTarget._id);
        const up = await apiFetch<{ document: { _id: string } }>('/api/documents/upload', {
          method: 'POST',
          body: fd,
        });
        attachedDocumentId = up.document._id;
      }

      await apiFetch(`/api/examinations/${operateTarget._id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: operateForm.status,
          scheduledDate: operateForm.scheduledDate || undefined,
          performedDate: operateForm.performedDate || undefined,
          operatorName: operateForm.operatorName || undefined,
          technicalNotes: operateForm.technicalNotes || undefined,
          resultSummary: operateForm.resultSummary || undefined,
          attachedDocumentId,
        }),
      });
      notify('success', 'Examen mis à jour.');
      closeModal();
      await load();
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setSaving(false);
    }
  };

  const openValidate = (ex: Examination) => {
    navigate(`/examens/${encodeURIComponent(ex._id)}/valider${filterQuery}`);
  };

  const handleValidateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateTarget) return;
    setSaving(true);
    try {
      await apiFetch(`/api/examinations/${validateTarget._id}/validate-result`, {
        method: 'POST',
        body: JSON.stringify(validateForm),
      });
      notify('success', 'Résultat validé médicalement.');
      closeModal();
      await load();
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <select
            value={typeFilter}
            onChange={(e) => setFilter(e.target.value, statusFilter)}
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
          >
            <option value="">Tous les examens</option>
            {Object.entries(EXAMINATION_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setFilter(typeFilter, e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
          >
            <option value="">Tous les statuts</option>
            {Object.entries(EXAMINATION_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>

        {hasPerm(user, 'examinations:prescribe') && (
          <button
            type="button"
            onClick={() => navigate(`/examens/prescrire${filterQuery}`)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#073B70] hover:bg-[#1265A3] text-white text-sm font-medium"
          >
            <HeartPulse className="w-4 h-4" />
            Prescrire un examen
          </button>
        )}
      </div>

      {loading ? (
        <TableSkeleton rows={5} />
      ) : exams.length === 0 ? (
        <EmptyState
          title="Aucun examen cardiologique"
          description="Prescrivez une exploration (ECG, Holter, MAPA, Échocardiographie...) pour démarrer le suivi."
          actionLabel={hasPerm(user, 'examinations:prescribe') ? 'Prescrire un examen' : undefined}
          onAction={hasPerm(user, 'examinations:prescribe') ? () => navigate(`/examens/prescrire${filterQuery}`) : undefined}
        />
      ) : (
        <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-xs text-[#708197] border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3 font-medium">Identifiant</th>
                  <th className="px-4 py-3 font-medium">Patient</th>
                  <th className="px-4 py-3 font-medium">Exploration</th>
                  <th className="px-4 py-3 font-medium">Dates</th>
                  <th className="px-4 py-3 font-medium">Statut</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {exams.map((ex) => (
                  <tr key={ex._id} className="hover:bg-[#EAF4FC]/30 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-[#073B70] dark:text-sky-300 tabular-nums">
                      {ex.examNumber}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold">{ex.patientName}</div>
                      <div className="text-xs font-mono text-[#708197]">{ex.patientNumber}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs font-semibold">{EXAMINATION_TYPE_LABELS[ex.type]}</div>
                      {isDoctor && ex.resultSummary && (
                        <div className="text-xs text-[#708197] truncate max-w-xs mt-0.5">
                          {ex.resultSummary}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-[#708197] tabular-nums">
                      <div>Prescrit : {formatDateFr(ex.prescriptionDate)}</div>
                      {ex.scheduledDate && <div>Prévu : {formatDateFr(ex.scheduledDate)}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        label={EXAMINATION_STATUS_LABELS[ex.status]}
                        tone={
                          ex.status === 'VALIDE'
                            ? 'success'
                            : ex.status === 'A_INTERPRETER' || ex.status === 'RESULTAT_DISPONIBLE'
                            ? 'warning'
                            : ex.status === 'ANNULE'
                            ? 'danger'
                            : 'info'
                        }
                      />
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap space-x-1.5">
                      {ex.attachedDocumentId && isDoctor && (
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
                          <Download className="w-3.5 h-3.5" /> Tracé
                        </button>
                      )}
                      {hasPerm(user, 'examinations:operate') && ex.status !== 'VALIDE' && (
                        <button
                          type="button"
                          onClick={() => openOperate(ex)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs hover:bg-slate-50 dark:hover:bg-slate-800"
                        >
                          <FileUp className="w-3.5 h-3.5" /> Saisir / Importer
                        </button>
                      )}
                      {isDoctor && ex.status !== 'VALIDE' && ex.status !== 'ANNULE' && (
                        <button
                          type="button"
                          onClick={() => openValidate(ex)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 text-white text-xs font-medium"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" /> Valider résultat
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Prescribe Modal */}
      <Modal
        open={isPrescribeUrl}
        onClose={closeModal}
        title="Prescrire un examen cardiologique"
        maxWidth="max-w-md"
      >
        <form onSubmit={handlePrescribe} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Patient *</label>
            <select
              required
              value={createForm.patientId}
              onChange={(e) => setCreateForm({ ...createForm, patientId: e.target.value })}
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
            <label className="block text-xs font-medium mb-1">Type d'examen *</label>
            <select
              value={createForm.type}
              onChange={(e) => setCreateForm({ ...createForm, type: e.target.value as ExaminationType })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            >
              {Object.entries(EXAMINATION_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Date prévue (optionnel)</label>
            <input
              type="date"
              value={createForm.scheduledDate}
              onChange={(e) => setCreateForm({ ...createForm, scheduledDate: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Indication / Notes techniques</label>
            <textarea
              rows={2}
              value={createForm.technicalNotes}
              onChange={(e) => setCreateForm({ ...createForm, technicalNotes: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeModal} className="px-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700">
              Annuler
            </button>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-[#073B70] text-white font-medium">
              <Plus className="w-4 h-4" /> Prescrire
            </button>
          </div>
        </form>
      </Modal>

      {/* Technical execution & PDF/image upload Modal */}
      <Modal
        open={Boolean(isOperateUrl && operateTarget)}
        onClose={closeModal}
        title={`Réalisation & Import — ${operateTarget?.examNumber}`}
        subtitle={`${operateTarget?.patientName} · ${operateTarget ? EXAMINATION_TYPE_LABELS[operateTarget.type] : ''}`}
      >
        <form onSubmit={handleOperateSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Statut</label>
              <select
                value={operateForm.status}
                onChange={(e) => setOperateForm({ ...operateForm, status: e.target.value as ExaminationStatus })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              >
                <option value="PROGRAMME">Programmé</option>
                <option value="EN_COURS">En cours</option>
                <option value="REALISE">Réalisé</option>
                <option value="RESULTAT_DISPONIBLE">Résultat disponible</option>
                <option value="A_INTERPRETER">À interpréter</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Opérateur</label>
              <input
                type="text"
                value={operateForm.operatorName}
                onChange={(e) => setOperateForm({ ...operateForm, operatorName: e.target.value })}
                placeholder="Nom du praticien / technicien"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Date prévue</label>
              <input
                type="date"
                value={operateForm.scheduledDate}
                onChange={(e) => setOperateForm({ ...operateForm, scheduledDate: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Date de réalisation</label>
              <input
                type="date"
                value={operateForm.performedDate}
                onChange={(e) => setOperateForm({ ...operateForm, performedDate: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Importer tracé / compte rendu (PDF ou Image)</label>
            <input
              type="file"
              accept=".pdf,image/png,image/jpeg,image/webp"
              onChange={(e) => setOperateForm({ ...operateForm, file: e.target.files?.[0] || null })}
              className="w-full text-xs file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-[#EAF4FC] file:text-[#073B70] file:font-medium"
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Observations techniques</label>
            <textarea
              rows={2}
              value={operateForm.technicalNotes}
              onChange={(e) => setOperateForm({ ...operateForm, technicalNotes: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Résumé préliminaire (non présenté au patient avant validation)</label>
            <textarea
              rows={2}
              value={operateForm.resultSummary}
              onChange={(e) => setOperateForm({ ...operateForm, resultSummary: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeModal} className="px-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700">
              Annuler
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-[#073B70] text-white font-medium">
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Doctor Validation Modal */}
      <Modal
        open={Boolean(isValidateUrl && validateTarget)}
        onClose={closeModal}
        title={`Validation médicale — ${validateTarget?.examNumber}`}
        subtitle="Un résultat non validé n'est jamais présenté au patient comme compte rendu définitif."
      >
        <form onSubmit={handleValidateSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Conclusion synthétique *</label>
            <input
              type="text"
              required
              value={validateForm.resultSummary}
              onChange={(e) => setValidateForm({ ...validateForm, resultSummary: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Compte rendu médical détaillé *</label>
            <textarea
              required
              rows={4}
              value={validateForm.reportText}
              onChange={(e) => setValidateForm({ ...validateForm, reportText: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={validateForm.sharedWithPatient}
              onChange={(e) => setValidateForm({ ...validateForm, sharedWithPatient: e.target.checked })}
            />
            Rendre ce résultat validé visible dans le portail du patient
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeModal} className="px-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700">
              Annuler
            </button>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-emerald-600 text-white font-medium">
              <Stethoscope className="w-4 h-4" /> Valider le compte rendu
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
