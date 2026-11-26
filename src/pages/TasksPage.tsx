import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckSquare, History, Plus, X } from 'lucide-react';
import {
  EmptyState,
  Modal,
  StatCard,
  StatusBadge,
  TableSkeleton,
} from '../components/UIPrimitives';
import type {
  Patient,
  PriorityLevel,
  PublicUser,
  Task,
  TaskCategory,
  TaskStatus,
} from '../shared/types';
import {
  PRIORITY_LABELS,
  TASK_CATEGORY_LABELS,
  TASK_STATUS_LABELS,
} from '../shared/constants';
import { apiFetch, formatDateFr, formatDateTimeFr } from '../lib/api';
import { buildQuerySuffix, navigate, useAppRoute } from '../lib/router';
import { useLiveSync } from '../lib/useLiveSync';

export const TasksPage: React.FC<{
  user: PublicUser;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
}> = ({ user, notify }) => {
  const route = useAppRoute();
  const isRoot = route.segments[0] === 'taches';
  const seg1 = route.segments[1] || '';
  const seg2 = route.segments[2] || '';
  const isCreateUrl = isRoot && seg1 === 'nouvelle';
  const urlTaskId = isRoot && seg1 && seg1 !== 'nouvelle' ? seg1 : null;
  const isHistoryUrl = Boolean(urlTaskId && seg2 === 'historique');

  const queryPatientId = route.query.get('patientId') || '';
  const assigneeFilter = route.query.get('responsable') || '';
  const categoryFilter = route.query.get('categorie') || '';
  const statusFilter = route.query.get('statut') || '';
  const dateFilter = route.query.get('date') || '';

  const [tasks, setTasks] = useState<Task[]>([]);
  const [staff, setStaff] = useState<PublicUser[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);

  const [historyTarget, setHistoryTarget] = useState<Task | null>(null);

  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: 'ACCUEIL' as TaskCategory,
    patientId: queryPatientId,
    assigneeId: user._id,
    dueDate: new Date().toISOString().slice(0, 10),
    priority: 'NORMALE' as PriorityLevel,
  });

  const filterQuery = buildQuerySuffix({
    responsable: assigneeFilter || undefined,
    categorie: categoryFilter || undefined,
    statut: statusFilter || undefined,
    date: dateFilter || undefined,
  });

  const setFilterParam = (key: 'responsable' | 'categorie' | 'statut' | 'date', val: string) => {
    navigate(
      `/taches${buildQuerySuffix({
        responsable: assigneeFilter || undefined,
        categorie: categoryFilter || undefined,
        statut: statusFilter || undefined,
        date: dateFilter || undefined,
        [key]: val || undefined,
      })}`
    );
  };

  const closeModal = () => {
    navigate(`/taches${filterQuery}`);
  };

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (assigneeFilter) qs.set('assigneeId', assigneeFilter);
      if (categoryFilter) qs.set('category', categoryFilter);
      if (statusFilter) qs.set('status', statusFilter);

      const [tRes, sRes, pRes] = await Promise.all([
        apiFetch<{ tasks: Task[] }>(`/api/tasks?${qs.toString()}`),
        apiFetch<{ staff: PublicUser[] }>('/api/users/staff'),
        apiFetch<{ patients: Patient[] }>('/api/patients?status=ACTIF'),
      ]);
      setTasks(tRes.tasks);
      setStaff(sRes.staff);
      setPatients(pRes.patients);
    } catch (err: any) {
      if (!silent) notify('error', err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [assigneeFilter, categoryFilter, statusFilter]);

  useLiveSync(['task'], () => load(true));

  // Sync URL -> create & history modals
  useEffect(() => {
    if (!isRoot) return;
    if (isCreateUrl) {
      setHistoryTarget(null);
      if (queryPatientId) {
        setForm((f) => ({ ...f, patientId: queryPatientId }));
      }
      return;
    }
    if (isHistoryUrl && urlTaskId) {
      const match = tasks.find((t) => t._id === urlTaskId);
      if (match) {
        setHistoryTarget(match);
      } else if (!loading) {
        navigate(`/taches${filterQuery}`, { replace: true });
      }
      return;
    }
    setHistoryTarget(null);
  }, [isRoot, isCreateUrl, isHistoryUrl, urlTaskId, queryPatientId, tasks, loading]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          patientId: form.patientId || undefined,
        }),
      });
      notify('success', 'Tâche interne créée.');
      setForm({ ...form, title: '', description: '', patientId: '' });
      closeModal();
      await load();
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (task: Task, status: TaskStatus) => {
    try {
      await apiFetch(`/api/tasks/${task._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      notify('success', `Tâche marquée : ${TASK_STATUS_LABELS[status]}`);
      await load();
    } catch (err: any) {
      notify('error', err.message);
    }
  };

  const today = new Date().toISOString().slice(0, 10);
  const visibleTasks = dateFilter ? tasks.filter((t) => t.dueDate === dateFilter) : tasks;
  const openTasks = visibleTasks.filter((t) => t.status !== 'TERMINEE' && t.status !== 'ANNULEE');
  const overdueTasks = openTasks.filter((t) => t.dueDate < today);
  const doneTasks = visibleTasks.filter((t) => t.status === 'TERMINEE');

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatCard label="Tâches ouvertes" value={openTasks.length} tone="primary" />
        <StatCard label="Tâches en retard" value={overdueTasks.length} tone={overdueTasks.length > 0 ? 'danger' : 'success'} />
        <StatCard label="Tâches terminées" value={doneTasks.length} tone="success" />
      </div>

      {overdueTasks.length > 0 && (
        <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 flex flex-wrap items-center justify-between gap-3 text-xs text-[#D71920] dark:text-red-300">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Alerte interne : {overdueTasks.length} tâche(s) non réalisée(s) ont dépassé leur date limite.
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-[#131E30] border border-slate-200/90 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <select
            value={assigneeFilter}
            onChange={(e) => setFilterParam('responsable', e.target.value)}
            aria-label="Filtrer par responsable"
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
          >
            <option value="">Tous responsables</option>
            {staff.map((s) => (
              <option key={s._id} value={s._id}>
                {s.firstName} {s.lastName}
              </option>
            ))}
          </select>
          <select
            value={categoryFilter}
            onChange={(e) => setFilterParam('categorie', e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
          >
            <option value="">Toutes catégories</option>
            {Object.entries(TASK_CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setFilterParam('statut', e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
          >
            <option value="">Tous statuts</option>
            {Object.entries(TASK_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setFilterParam('date', e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
          />
          {(assigneeFilter || categoryFilter || statusFilter || dateFilter) && (
            <button
              type="button"
              onClick={() => navigate('/taches')}
              className="inline-flex items-center gap-1 text-xs text-[#D71920] hover:underline"
            >
              <X className="w-3.5 h-3.5" /> Réinitialiser
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => navigate(`/taches/nouvelle${filterQuery}`)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#073B70] hover:bg-[#1265A3] text-white text-sm font-semibold"
        >
          <Plus className="w-4 h-4" />
          Ajouter une tâche
        </button>
      </div>

      {loading ? (
        <TableSkeleton rows={5} />
      ) : visibleTasks.length === 0 ? (
        <EmptyState
          icon={<CheckSquare className="w-5 h-5" />}
          title="Aucune tâche interne"
          description="Organisez les actions administratives, d'accueil et médicales du cabinet."
          actionLabel="Ajouter une tâche"
          onAction={() => navigate(`/taches/nouvelle${filterQuery}`)}
        />
      ) : (
        <div className="bg-white dark:bg-[#131E30] border border-slate-200/90 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-[#F8FBFE] dark:bg-slate-900/60 text-xs text-[#708197] border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3 font-semibold">Tâche</th>
                  <th className="px-4 py-3 font-semibold">Catégorie</th>
                  <th className="px-4 py-3 font-semibold">Responsable</th>
                  <th className="px-4 py-3 font-semibold">Échéance</th>
                  <th className="px-4 py-3 font-semibold">Priorité</th>
                  <th className="px-4 py-3 font-semibold">Statut & Historique</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {visibleTasks.map((t) => {
                  const overdue = t.status !== 'TERMINEE' && t.status !== 'ANNULEE' && t.dueDate < today;
                  return (
                    <tr key={t._id} className={`hover:bg-[#EAF4FC]/30 dark:hover:bg-slate-800/40 ${overdue ? 'bg-red-50/35 dark:bg-red-950/15' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-[#172B45] dark:text-white">{t.title}</div>
                        {t.description && <div className="text-xs text-[#708197] mt-0.5">{t.description}</div>}
                        {t.patientName && (
                          <div className="text-[11px] text-[#1265A3] dark:text-sky-400 mt-0.5">Patient : {t.patientName}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">{TASK_CATEGORY_LABELS[t.category]}</td>
                      <td className="px-4 py-3 text-xs font-medium">{t.assigneeName}</td>
                      <td className={`px-4 py-3 text-xs font-mono tabular-nums ${overdue ? 'text-[#D71920] font-semibold' : ''}`}>
                        {formatDateFr(t.dueDate)}
                        {overdue && ' (Retard)'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          label={PRIORITY_LABELS[t.priority]}
                          tone={t.priority === 'CRITIQUE' || t.priority === 'HAUTE' ? 'danger' : 'neutral'}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <select
                            value={t.status}
                            onChange={(e) => changeStatus(t, e.target.value as TaskStatus)}
                            className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium"
                          >
                            {Object.entries(TASK_STATUS_LABELS).map(([k, v]) => (
                              <option key={k} value={k}>
                                {v}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => navigate(`/taches/${encodeURIComponent(t._id)}/historique${filterQuery}`)}
                            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[#708197] hover:text-[#073B70]"
                            title="Voir l'historique"
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* History Modal */}
      <Modal
        open={Boolean(isHistoryUrl && historyTarget)}
        onClose={closeModal}
        title={`Historique — ${historyTarget?.title || ''}`}
        maxWidth="max-w-md"
      >
        <div className="space-y-2">
          {(historyTarget?.history || []).length === 0 ? (
            <div className="text-xs text-[#708197]">Aucun historique disponible.</div>
          ) : (
            [...(historyTarget?.history || [])].reverse().map((h, i) => (
              <div key={i} className="p-3 rounded-lg bg-[#F3F7FB] dark:bg-slate-900 text-xs flex justify-between gap-2">
                <div>
                  <div className="font-semibold text-[#073B70] dark:text-sky-300">{h.action}</div>
                  <div className="text-[#708197]">{h.byName}</div>
                </div>
                <div className="font-mono text-[11px] text-[#708197] tabular-nums">{formatDateTimeFr(h.at)}</div>
              </div>
            ))
          )}
        </div>
      </Modal>

      <Modal open={isCreateUrl} onClose={closeModal} title="Nouvelle tâche interne">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Titre *</label>
            <input
              type="text"
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Description</label>
            <textarea
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Catégorie</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as TaskCategory })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              >
                {Object.entries(TASK_CATEGORY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Responsable *</label>
              <select
                required
                value={form.assigneeId}
                onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              >
                {staff.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.firstName} {s.lastName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Date limite *</label>
              <input
                type="date"
                required
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Priorité</label>
              <select
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value as PriorityLevel })}
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
            <label className="block text-xs font-medium mb-1">Patient associé (facultatif)</label>
            <select
              value={form.patientId}
              onChange={(e) => setForm({ ...form, patientId: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            >
              <option value="">Aucun patient associé</option>
              {patients.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.patientNumber} — {p.firstName} {p.lastName}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeModal} className="px-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700">
              Annuler
            </button>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-[#073B70] hover:bg-[#1265A3] text-white font-medium">
              <CheckSquare className="w-4 h-4" /> Créer la tâche
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
