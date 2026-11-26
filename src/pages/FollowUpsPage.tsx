import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Filter,
  History,
  Mail,
  MessageSquare,
  PhoneCall,
  Play,
  Plus,
  Search,
  X,
} from 'lucide-react';
import {
  EmptyState,
  Modal,
  StatCard,
  StatusBadge,
  TableSkeleton,
} from '../components/UIPrimitives';
import type {
  FollowUp,
  FollowUpStatus,
  FollowUpType,
  Patient,
  PriorityLevel,
  PublicUser,
} from '../shared/types';
import {
  FOLLOWUP_STATUS_LABELS,
  FOLLOWUP_TYPE_LABELS,
  PRIORITY_LABELS,
} from '../shared/constants';
import { apiFetch, formatDateFr, formatDateTimeFr, hasPerm } from '../lib/api';
import { buildQuerySuffix, navigate, useAppRoute } from '../lib/router';
import { useLiveSync } from '../lib/useLiveSync';

const MEDICAL_TYPES: FollowUpType[] = [
  'CONTROLE_MEDICAL',
  'RESULTAT_EXAMEN',
  'EXAMEN_COMPLEMENTAIRE',
  'SURVEILLANCE',
];

type FollowUpTab = 'today' | 'overdue' | 'upcoming' | 'completed' | 'all';

const TAB_TO_SLUG: Record<FollowUpTab, string> = {
  today: 'a-rappeler-aujourdhui',
  overdue: 'en-retard',
  upcoming: 'a-venir',
  completed: 'termines',
  all: 'tous',
};

const SLUG_TO_TAB: Record<string, FollowUpTab> = {
  'a-rappeler-aujourdhui': 'today',
  'en-retard': 'overdue',
  'a-venir': 'upcoming',
  termines: 'completed',
  tous: 'all',
};

export const FollowUpsPage: React.FC<{
  user: PublicUser;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
}> = ({ user, notify }) => {
  const route = useAppRoute();
  const isRoot = route.segments[0] === 'suivis';
  const seg1 = route.segments[1] || '';
  const seg2 = route.segments[2] || '';

  const isCreateUrl = isRoot && seg1 === 'nouveau';
  const urlTab: FollowUpTab = SLUG_TO_TAB[seg1] || 'today';
  const urlFollowUpId = isRoot && seg1 && seg1 !== 'nouveau' && !SLUG_TO_TAB[seg1] ? seg1 : null;
  const isRelanceUrl = Boolean(urlFollowUpId && seg2 === 'relance');
  const isCompleteUrl = Boolean(urlFollowUpId && seg2 === 'cloturer');

  const queryPatientId = route.query.get('patientId') || '';
  const assigneeFilter = route.query.get('responsable') || '';
  const statusFilter = route.query.get('statut') || '';
  const dateFilter = route.query.get('date') || '';
  const searchQuery = route.query.get('q') || '';

  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [staff, setStaff] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedHistoryIds, setExpandedHistoryIds] = useState<Record<string, boolean>>({});
  const [sendingEmailId, setSendingEmailId] = useState<string | null>(null);
  const [sendingWhatsAppId, setSendingWhatsAppId] = useState<string | null>(null);
  const [runningAutoReminders, setRunningAutoReminders] = useState(false);

  const [saving, setSaving] = useState(false);
  const [createForm, setCreateForm] = useState({
    patientId: queryPatientId,
    type: 'APPEL_TELEPHONIQUE' as FollowUpType,
    reason: '',
    dueDate: new Date().toISOString().slice(0, 10),
    assigneeId: user._id,
    priority: 'NORMALE' as PriorityLevel,
    notes: '',
    nextAction: '',
  });

  const [actionTarget, setActionTarget] = useState<FollowUp | null>(null);
  const [actionForm, setActionForm] = useState({
    status: 'PATIENT_CONTACTE' as FollowUpStatus,
    dueDate: '',
    assigneeId: '',
    contactOutcome: '',
    relanceNote: '',
  });

  const [completeTarget, setCompleteTarget] = useState<FollowUp | null>(null);
  const [completeForm, setCompleteForm] = useState({ contactOutcome: '', nextAction: '' });

  const today = new Date().toISOString().slice(0, 10);
  const isDoctor = hasPerm(user, 'followups:write_medical');
  const tab = urlTab;

  const filterQuery = buildQuerySuffix({
    responsable: assigneeFilter || undefined,
    statut: statusFilter || undefined,
    date: dateFilter || undefined,
    q: searchQuery || undefined,
  });

  const listPath = (nextTab: FollowUpTab = tab, overrides?: Record<string, string | undefined>) => {
    const q = buildQuerySuffix({
      responsable: assigneeFilter || undefined,
      statut: statusFilter || undefined,
      date: dateFilter || undefined,
      q: searchQuery || undefined,
      ...overrides,
    });
    return `/suivis/${TAB_TO_SLUG[nextTab]}${q}`;
  };

  const setTab = (nextTab: FollowUpTab) => {
    navigate(listPath(nextTab));
  };

  const setFilterParam = (key: 'responsable' | 'statut' | 'date' | 'q', val: string) => {
    navigate(listPath(tab, { [key]: val || undefined }));
  };

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [fRes, pRes, sRes] = await Promise.all([
        apiFetch<{ followUps: FollowUp[] }>('/api/follow-ups'),
        apiFetch<{ patients: Patient[] }>('/api/patients?status=ACTIF'),
        apiFetch<{ staff: PublicUser[] }>('/api/users/staff'),
      ]);
      setFollowUps(fRes.followUps);
      setPatients(pRes.patients);
      setStaff(sRes.staff);
      if (pRes.patients[0] && !createForm.patientId) {
        setCreateForm((f) => ({ ...f, patientId: pRes.patients[0]._id }));
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

  useLiveSync(['followup', 'patient'], () => load(true));

  // Sync URL -> create/relance/complete modals
  useEffect(() => {
    if (!isRoot) return;
    if (isCreateUrl) {
      setActionTarget(null);
      setCompleteTarget(null);
      setCreateForm((f) => ({
        ...f,
        patientId: queryPatientId || f.patientId || patients[0]?._id || '',
      }));
      return;
    }

    if (urlFollowUpId && (isRelanceUrl || isCompleteUrl)) {
      const match = followUps.find((f) => f._id === urlFollowUpId);
      if (!match) {
        if (!loading) navigate(`/suivis${filterQuery}`, { replace: true });
        return;
      }
      if (isRelanceUrl) {
        setCompleteTarget(null);
        setActionTarget(match);
        setActionForm({
          status: match.status === 'A_EFFECTUER' ? 'PATIENT_CONTACTE' : match.status,
          dueDate: match.dueDate,
          assigneeId: match.assigneeId,
          contactOutcome: match.contactOutcome || '',
          relanceNote: '',
        });
      } else if (isCompleteUrl) {
        const isMed = MEDICAL_TYPES.includes(match.type);
        if (isMed && !isDoctor) {
          navigate(`/suivis${filterQuery}`, { replace: true });
          return;
        }
        setActionTarget(null);
        setCompleteTarget(match);
      }
      return;
    }

    setActionTarget(null);
    setCompleteTarget(null);
  }, [isRoot, isCreateUrl, urlFollowUpId, isRelanceUrl, isCompleteUrl, queryPatientId, followUps, patients, loading, isDoctor]);

  const closeModal = () => {
    navigate(listPath());
  };

  const isClosed = (s: FollowUpStatus) => s === 'TERMINE' || s === 'ANNULE';

  // Apply explicit filters (responsable, date, statut, recherche) before segment counts
  const baseFiltered = followUps.filter((f) => {
    if (assigneeFilter && f.assigneeId !== assigneeFilter) return false;
    if (statusFilter && f.status !== statusFilter) return false;
    if (dateFilter && f.dueDate !== dateFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const match =
        (f.patientName || '').toLowerCase().includes(q) ||
        (f.patientNumber || '').toLowerCase().includes(q) ||
        (f.patientPhone || '').toLowerCase().includes(q) ||
        f.reason.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  const overdueList = baseFiltered.filter((f) => !isClosed(f.status) && f.dueDate < today);
  const todayList = baseFiltered.filter((f) => !isClosed(f.status) && f.dueDate === today);
  const upcomingList = baseFiltered.filter((f) => !isClosed(f.status) && f.dueDate > today);
  const completedList = baseFiltered.filter((f) => isClosed(f.status));

  // If user chose an explicit date or completed status filter, automatically show matching items cleanly
  const visibleList =
    dateFilter || statusFilter === 'TERMINE' || statusFilter === 'ANNULE'
      ? baseFiltered
      : tab === 'overdue'
      ? overdueList
      : tab === 'today'
      ? todayList
      : tab === 'upcoming'
      ? upcomingList
      : tab === 'completed'
      ? completedList
      : baseFiltered;

  const hasActiveFilters = Boolean(assigneeFilter || statusFilter || dateFilter || searchQuery.trim());

  const clearFilters = () => {
    navigate(`/suivis/${TAB_TO_SLUG[tab]}`);
  };

  const toggleHistory = (id: string) => {
    setExpandedHistoryIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/follow-ups', {
        method: 'POST',
        body: JSON.stringify(createForm),
      });
      notify('success', 'Suivi patient programmé et historisé.');
      setCreateForm((f) => ({ ...f, reason: '', notes: '', nextAction: '' }));
      closeModal();
      await load();
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setSaving(false);
    }
  };

  const openRelance = (f: FollowUp) => {
    navigate(`/suivis/${encodeURIComponent(f._id)}/relance${filterQuery}`);
  };

  const handleRelanceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actionTarget) return;
    setSaving(true);
    try {
      await apiFetch(`/api/follow-ups/${actionTarget._id}`, {
        method: 'PATCH',
        body: JSON.stringify(actionForm),
      });
      notify('success', 'Relance enregistrée dans l’historique.');
      closeModal();
      await load();
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCompleteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!completeTarget) return;
    setSaving(true);
    try {
      await apiFetch(`/api/follow-ups/${completeTarget._id}/complete`, {
        method: 'POST',
        body: JSON.stringify(completeForm),
      });
      notify('success', 'Suivi clôturé avec succès.');
      setCompleteForm({ contactOutcome: '', nextAction: '' });
      closeModal();
      await load();
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSendEmailReminder = async (f: FollowUp) => {
    setSendingEmailId(f._id);
    try {
      const res = await apiFetch<{ ok: boolean; providerMessageId?: string }>(
        `/api/follow-ups/${encodeURIComponent(f._id)}/send-reminder`,
        { method: 'POST', body: JSON.stringify({}) }
      );
      notify(
        'success',
        `Relance e-mail Resend envoyée à ${f.patientName}${res.providerMessageId ? ` (ID: ${res.providerMessageId})` : ''}.`
      );
      await load(true);
    } catch (err: any) {
      notify('error', err.message || "Impossible d'envoyer la relance par e-mail.");
    } finally {
      setSendingEmailId(null);
    }
  };

  const handleSendWhatsAppReminder = async (f: FollowUp) => {
    setSendingWhatsAppId(f._id);
    try {
      const res = await apiFetch<{ ok: boolean; providerMessageId?: string }>(
        `/api/follow-ups/${encodeURIComponent(f._id)}/send-reminder`,
        { method: 'POST', body: JSON.stringify({ channel: 'WHATSAPP' }) }
      );
      notify(
        'success',
        `Relance WhatsApp envoyée à ${f.patientName}${res.providerMessageId ? ` (ID: ${res.providerMessageId})` : ''}.`
      );
      await load(true);
    } catch (err: any) {
      notify('error', err.message || "Impossible d'envoyer la relance WhatsApp.");
    } finally {
      setSendingWhatsAppId(null);
    }
  };

  const handleRunAutoReminders = async () => {
    setRunningAutoReminders(true);
    try {
      const res = await apiFetch<{
        ok: boolean;
        summary: {
          appointmentsReminded: number;
          followUpsReminded: number;
          tasksEscalated: number;
          examsEscalated: number;
          emailsSent: number;
          emailsFailed: number;
          emailsSkipped: number;
          whatsappSent: number;
          whatsappFailed: number;
          whatsappSkipped: number;
        };
      }>('/api/notifications/run-reminders', { method: 'POST' });
      const s = res.summary;
      notify(
        s.emailsFailed > 0 || s.whatsappFailed > 0 ? 'info' : 'success',
        `Relances exécutées : ${s.emailsSent} e-mail(s) Resend, ${s.whatsappSent || 0} WhatsApp (${s.appointmentsReminded} RDV J-1, ${s.followUpsReminded} suivi(s)).`
      );
      await load(true);
    } catch (err: any) {
      notify('error', err.message || "Échec d'exécution des relances automatiques.");
    } finally {
      setRunningAutoReminders(false);
    }
  };

  const totalGlobalOverdue = followUps.filter((f) => !isClosed(f.status) && f.dueDate < today).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-white dark:bg-[#131E30] border border-slate-200/90 dark:border-slate-800 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-base font-bold text-[#073B70] dark:text-white font-display">
            Suivi post-consultation & Coordination des rappels
          </h1>
          <p className="text-xs text-[#708197] dark:text-slate-400 mt-0.5">
            Relances automatiques & manuelles par E-mail (Resend) & WhatsApp · Clôture médicale validée par le médecin
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={runningAutoReminders}
            onClick={handleRunAutoReminders}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#1265A3] text-[#073B70] dark:text-sky-300 hover:bg-[#EAF4FC]/60 dark:hover:bg-slate-800 text-xs font-semibold disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" />
            {runningAutoReminders ? 'Relances en cours...' : 'Lancer les relances auto'}
          </button>
          <button
            type="button"
            onClick={() => navigate(`/suivis/nouveau${filterQuery}`)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#073B70] hover:bg-[#1265A3] text-white text-sm font-semibold"
          >
            <Plus className="w-4 h-4" />
            Programmer un suivi
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="À rappeler aujourd'hui" value={todayList.length} tone="primary" onClick={() => setTab('today')} />
        <StatCard label="Suivis en retard" value={overdueList.length} tone={overdueList.length > 0 ? 'danger' : 'success'} onClick={() => setTab('overdue')} />
        <StatCard label="À venir" value={upcomingList.length} onClick={() => setTab('upcoming')} />
        <StatCard label="Clôturés" value={completedList.length} tone="success" onClick={() => setTab('completed')} />
      </div>

      {/* Internal Alert Banner for Overdue Follow-ups */}
      {totalGlobalOverdue > 0 && tab !== 'overdue' && !dateFilter && (
        <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 flex flex-wrap items-center justify-between gap-3 text-xs text-[#D71920] dark:text-red-300">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Alerte interne : {totalGlobalOverdue} suivi(s) patient non réalisé(s) ont dépassé leur date d'échéance.
          </div>
          <button
            type="button"
            onClick={() => navigate(`/suivis/${TAB_TO_SLUG.overdue}`)}
            className="px-3 py-1 rounded-lg bg-[#D71920] text-white font-semibold whitespace-nowrap"
          >
            Afficher les retards ({totalGlobalOverdue})
          </button>
        </div>
      )}

      {/* Multi-Criteria Filter Bar: Responsable, Date, Statut & Search */}
      <div className="bg-white dark:bg-[#131E30] border border-slate-200/90 dark:border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#073B70] dark:text-sky-300">
            <Filter className="w-3.5 h-3.5" />
            Filtres de coordination
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#D71920] hover:underline"
            >
              <X className="w-3.5 h-3.5" /> Réinitialiser les filtres
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setFilterParam('q', e.target.value)}
              placeholder="Patient, PAT-..., motif..."
              className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F3F7FB] dark:bg-slate-900 text-xs"
            />
          </div>

          <select
            value={assigneeFilter}
            onChange={(e) => setFilterParam('responsable', e.target.value)}
            aria-label="Filtrer par responsable"
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
          >
            <option value="">Tous les responsables</option>
            {staff.map((s) => (
              <option key={s._id} value={s._id}>
                {s.title ? `${s.title} ` : ''}{s.firstName} {s.lastName}
              </option>
            ))}
          </select>

          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setFilterParam('date', e.target.value)}
            aria-label="Filtrer par date d'échéance"
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
          />

          <select
            value={statusFilter}
            onChange={(e) => setFilterParam('statut', e.target.value)}
            aria-label="Filtrer par statut"
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
          >
            <option value="">Tous les statuts</option>
            {Object.entries(FOLLOWUP_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>

        {/* Period Segmented Tabs */}
        {!dateFilter && (
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg w-fit">
            {([
              ['today', `Aujourd'hui (${todayList.length})`],
              ['overdue', `En retard (${overdueList.length})`],
              ['upcoming', `À venir (${upcomingList.length})`],
              ['completed', `Terminés (${completedList.length})`],
              ['all', `Tous (${baseFiltered.length})`],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap ${
                  tab === id
                    ? 'bg-white dark:bg-slate-900 text-[#073B70] dark:text-sky-300 shadow-xs font-semibold'
                    : 'text-[#708197] hover:text-[#172B45] dark:hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Follow-ups List */}
      {loading ? (
        <TableSkeleton rows={5} />
      ) : visibleList.length === 0 ? (
        <EmptyState
          icon={<Activity className="w-5 h-5" />}
          title="Aucun suivi correspondant aux critères"
          description="Modifiez vos filtres ou programmez un rappel, un contrôle médical ou une relance administrative."
          actionLabel="Programmer un suivi"
          onAction={() => navigate(`/suivis/nouveau${filterQuery}`)}
        />
      ) : (
        <div className="space-y-3">
          {visibleList.map((f) => {
            const isOverdue = !isClosed(f.status) && f.dueDate < today;
            const isMedical = MEDICAL_TYPES.includes(f.type);
            const canClose = !isMedical || isDoctor;
            const historyExpanded = Boolean(expandedHistoryIds[f._id]);
            const historyList = f.history || [];

            return (
              <div
                key={f._id}
                className={`bg-white dark:bg-[#131E30] border rounded-xl p-4 space-y-3 ${
                  isOverdue ? 'border-red-300 dark:border-red-900' : 'border-slate-200/90 dark:border-slate-800'
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-sm text-[#172B45] dark:text-white">
                        {f.patientName}
                      </span>
                      <span className="font-mono text-xs text-[#708197]">{f.patientNumber}</span>
                      {f.patientPhone && (
                        <span className="font-mono text-xs text-[#1265A3] dark:text-sky-400">
                          {f.patientPhone}
                        </span>
                      )}
                      <StatusBadge label={FOLLOWUP_TYPE_LABELS[f.type]} tone={isMedical ? 'info' : 'neutral'} />
                      <StatusBadge
                        label={isOverdue ? `En retard (${FOLLOWUP_STATUS_LABELS[f.status]})` : FOLLOWUP_STATUS_LABELS[f.status]}
                        tone={
                          isOverdue
                            ? 'danger'
                            : f.status === 'TERMINE'
                            ? 'success'
                            : f.status === 'PATIENT_INJOIGNABLE'
                            ? 'warning'
                            : 'info'
                        }
                      />
                      <StatusBadge
                        label={PRIORITY_LABELS[f.priority]}
                        tone={f.priority === 'CRITIQUE' || f.priority === 'HAUTE' ? 'danger' : 'neutral'}
                      />
                    </div>

                    <div className="text-sm font-medium text-[#172B45] dark:text-slate-100">{f.reason}</div>

                    <div className="text-xs text-[#708197] dark:text-slate-400 flex flex-wrap gap-x-5 gap-y-1 tabular-nums">
                      <span>
                        Échéance :{' '}
                        <strong className={isOverdue ? 'text-[#D71920]' : 'text-[#172B45] dark:text-slate-200'}>
                          {formatDateFr(f.dueDate)}
                        </strong>
                      </span>
                      <span>
                        Responsable : <strong className="text-[#172B45] dark:text-slate-200">{f.assigneeName}</strong>
                      </span>
                      {f.contactOutcome && <span>Résultat : {f.contactOutcome}</span>}
                      {f.nextAction && <span>Prochaine action : {f.nextAction}</span>}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => toggleHistory(f._id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-[#708197] hover:text-[#172B45] dark:hover:text-white"
                    >
                      <History className="w-3.5 h-3.5" />
                      Historique ({historyList.length})
                      {historyExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>

                    {!isClosed(f.status) && (
                      <>
                        <button
                          type="button"
                          disabled={sendingEmailId === f._id}
                          onClick={() => handleSendEmailReminder(f)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1265A3]/40 text-[#073B70] dark:text-sky-300 text-xs font-medium hover:bg-[#EAF4FC]/60 dark:hover:bg-slate-800 disabled:opacity-50"
                        >
                          <Mail className="w-3.5 h-3.5 text-[#1265A3]" />
                          {sendingEmailId === f._id ? 'Envoi...' : 'Relancer e-mail'}
                        </button>
                        <button
                          type="button"
                          disabled={sendingWhatsAppId === f._id}
                          onClick={() => handleSendWhatsAppReminder(f)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-600/40 text-emerald-700 dark:text-emerald-400 text-xs font-medium hover:bg-emerald-50 dark:hover:bg-emerald-950/40 disabled:opacity-50"
                        >
                          <MessageSquare className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                          {sendingWhatsAppId === f._id ? 'Envoi...' : 'WhatsApp'}
                        </button>
                        <button
                          type="button"
                          onClick={() => openRelance(f)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-[#EAF4FC]/60 dark:hover:bg-slate-800"
                        >
                          <PhoneCall className="w-3.5 h-3.5 text-[#1265A3]" />
                          Relancer / Reporter
                        </button>
                        {canClose ? (
                          <button
                            type="button"
                            onClick={() => navigate(`/suivis/${encodeURIComponent(f._id)}/cloturer${filterQuery}`)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Clôturer
                          </button>
                        ) : (
                          <span className="text-[11px] text-[#708197] px-2">Clôture réservée au médecin</span>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Expandable Full Follow-Up History Timeline */}
                {historyExpanded && (
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-[#708197] mb-2">
                      Historique complet des actions et relances
                    </div>
                    {historyList.length === 0 ? (
                      <div className="text-xs text-[#708197]">Aucune trace enregistrée.</div>
                    ) : (
                      <div className="space-y-2">
                        {[...historyList].reverse().map((h, idx) => (
                          <div
                            key={`${h.at}-${idx}`}
                            className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 px-3 py-2 rounded-lg bg-[#F3F7FB] dark:bg-slate-900/60 text-xs"
                          >
                            <div>
                              <span className="font-semibold text-[#073B70] dark:text-sky-300">{h.action}</span>
                              {h.note && <span className="text-[#172B45] dark:text-slate-200"> — {h.note}</span>}
                            </div>
                            <div className="text-[11px] text-[#708197] font-mono tabular-nums shrink-0">
                              {h.byName} · {formatDateTimeFr(h.at)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create Follow-Up Modal */}
      <Modal
        open={isCreateUrl}
        onClose={closeModal}
        title="Programmer un suivi patient"
        subtitle="Attribution d'un responsable, d'une échéance et création de la trace initiale."
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              <label className="block text-xs font-medium mb-1">Type de suivi *</label>
              <select
                value={createForm.type}
                onChange={(e) => setCreateForm({ ...createForm, type: e.target.value as FollowUpType })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              >
                {Object.entries(FOLLOWUP_TYPE_LABELS).map(([k, v]) => {
                  const restricted = MEDICAL_TYPES.includes(k as FollowUpType) && !isDoctor;
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
                value={createForm.dueDate}
                onChange={(e) => setCreateForm({ ...createForm, dueDate: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Responsable *</label>
              <select
                required
                value={createForm.assigneeId}
                onChange={(e) => setCreateForm({ ...createForm, assigneeId: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              >
                {staff.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.title ? `${s.title} ` : ''}{s.firstName} {s.lastName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium mb-1">Motif *</label>
              <input
                type="text"
                required
                value={createForm.reason}
                onChange={(e) => setCreateForm({ ...createForm, reason: e.target.value })}
                placeholder="ex. Rappeler pour résultat Holter ECG..."
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Priorité</label>
              <select
                value={createForm.priority}
                onChange={(e) => setCreateForm({ ...createForm, priority: e.target.value as PriorityLevel })}
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
            <label className="block text-xs font-medium mb-1">Prochaine action / Notes</label>
            <textarea
              rows={2}
              value={createForm.notes}
              onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeModal} className="px-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700">
              Annuler
            </button>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-[#073B70] hover:bg-[#1265A3] text-white font-medium">
              <Activity className="w-4 h-4" /> Enregistrer le suivi
            </button>
          </div>
        </form>
      </Modal>

      {/* Relance / Report Modal */}
      <Modal
        open={Boolean(isRelanceUrl && actionTarget)}
        onClose={closeModal}
        title={`Relancer / Reporter — ${actionTarget?.patientName}`}
        maxWidth="max-w-md"
      >
        <form onSubmit={handleRelanceSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Nouveau statut</label>
              <select
                value={actionForm.status}
                onChange={(e) => setActionForm({ ...actionForm, status: e.target.value as FollowUpStatus })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              >
                <option value="EN_COURS">En cours</option>
                <option value="PATIENT_CONTACTE">Patient contacté</option>
                <option value="PATIENT_INJOIGNABLE">Patient injoignable</option>
                <option value="REPORTE">Reporté</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Responsable</label>
              <select
                value={actionForm.assigneeId}
                onChange={(e) => setActionForm({ ...actionForm, assigneeId: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              >
                {staff.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.firstName} {s.lastName}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Date prévue (reporter si besoin)</label>
            <input
              type="date"
              value={actionForm.dueDate}
              onChange={(e) => setActionForm({ ...actionForm, dueDate: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Résultat du contact / Note de relance *</label>
            <textarea
              rows={3}
              required
              value={actionForm.relanceNote}
              onChange={(e) => setActionForm({ ...actionForm, relanceNote: e.target.value, contactOutcome: e.target.value })}
              placeholder="ex. Appel passé à 10h15, patient joignable, RDV proposé..."
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeModal} className="px-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700">
              Annuler
            </button>
            <button type="submit" disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-[#073B70] hover:bg-[#1265A3] text-white font-medium">
              <CalendarClock className="w-4 h-4" /> Enregistrer
            </button>
          </div>
        </form>
      </Modal>

      {/* Complete Modal */}
      <Modal
        open={Boolean(isCompleteUrl && completeTarget)}
        onClose={closeModal}
        title="Clôturer le suivi patient"
        maxWidth="max-w-md"
      >
        <form onSubmit={handleCompleteSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Résultat du contact / Compte rendu de clôture *</label>
            <textarea
              required
              rows={3}
              value={completeForm.contactOutcome}
              onChange={(e) => setCompleteForm({ ...completeForm, contactOutcome: e.target.value })}
              placeholder="ex. Patient informé, RDV de contrôle fixé le..."
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
            <button type="button" onClick={closeModal} className="px-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700">
              Annuler
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium">
              Confirmer la clôture
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
