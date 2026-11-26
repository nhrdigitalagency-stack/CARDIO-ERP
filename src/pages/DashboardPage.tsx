import React, { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BellRing,
  CalendarCheck,
  CalendarPlus,
  CheckSquare,
  Clock,
  FilePlus2,
  HeartPulse,
  PhoneCall,
  Stethoscope,
  UserPlus,
  Users,
} from 'lucide-react';
import { AlertBeacon, EmptyState, StatCard, StatusBadge, TableSkeleton } from '../components/UIPrimitives';
import type { NavModuleId } from '../components/LayoutShell';
import type {
  Appointment,
  Examination,
  FollowUp,
  Patient,
  PublicUser,
  Task,
} from '../shared/types';
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_TYPE_LABELS,
  EXAMINATION_STATUS_LABELS,
  EXAMINATION_TYPE_LABELS,
  FOLLOWUP_TYPE_LABELS,
  PRIORITY_LABELS,
} from '../shared/constants';
import { apiFetch, formatDateFr, formatFcfa, hasPerm } from '../lib/api';
import { navigate } from '../lib/router';
import { useLiveSync } from '../lib/useLiveSync';

interface ControlToScheduleItem {
  id: string;
  patientId: string;
  patientName: string;
  patientNumber?: string;
  patientPhone?: string;
  recommendedDate: string;
  source: 'CONSULTATION' | 'SUIVI';
  label: string;
  assigneeName?: string;
}

interface DashboardData {
  today: string;
  primaryRole: 'MEDECIN' | 'ADMIN' | 'ACCUEIL';
  metrics: {
    totalPatients: number;
    newPatientsThisMonth: number;
    consultationsToday: number;
    totalConsultations: number;
    appointmentsToday: number;
    totalAppointments: number;
    patientsArrived: number;
    patientsWaiting: number;
    patientsInConsultation: number;
    appointmentsConfirmed: number;
    appointmentsUnconfirmed: number;
    appointmentsAbsent: number;
    patientRequests: number;
    examsToInterpret: number;
    examsPerformed: number;
    resultsToValidate: number;
    followUpsToDo: number;
    followUpsToday: number;
    followUpsOverdue: number;
    controlsToScheduleCount: number;
    upcomingAppointments: number;
    openTasks: number;
    overdueTasks: number;
    absenceRate: number;
    totalRevenueFcfa: number;
    pendingBalanceFcfa: number;
  };
  charts: {
    last7Days: Array<{ date: string; label: string; consultations: number; appointments: number }>;
    examsByCategory: Array<{ name: string; value: number }>;
  };
  lists: {
    recentPatients: Patient[];
    priorityFollowUps: FollowUp[];
    patientsToCallToday: FollowUp[];
    overdueFollowUps: Array<FollowUp & { daysOverdue?: number }>;
    unvalidatedExams: Examination[];
    controlsToSchedule: ControlToScheduleItem[];
    overdueTasks: Array<Task & { daysOverdue?: number }>;
    urgentTasks: Task[];
    upcomingSchedule: Appointment[];
  };
}

interface DashboardPageProps {
  user: PublicUser;
  onNavigate: (module: NavModuleId, patientId?: string) => void;
}

const BAR_COLORS = ['#073B70', '#1265A3', '#2B7CB8', '#4F95C9', '#D71920', '#64748B'];

export const DashboardPage: React.FC<DashboardPageProps> = ({ user, onNavigate }) => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const res = await apiFetch<DashboardData>('/api/dashboard');
      setData(res);
    } catch (err: any) {
      if (!silent) setError(err.message || 'Impossible de charger le tableau de bord.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useLiveSync(
    ['patient', 'appointment', 'queue', 'consultation', 'examination', 'followup', 'task', 'payment', 'document', 'service', 'notification'],
    () => load(true)
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 animate-pulse" />
          ))}
        </div>
        <TableSkeleton rows={5} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <EmptyState
        title="Chargement impossible"
        description={error || 'Aucune donnée disponible.'}
        actionLabel="Réessayer"
        onAction={() => load()}
      />
    );
  }

  const m = data.metrics;
  const isDoctor = hasPerm(user, 'medical:read');
  const isAdmin = hasPerm(user, 'statistics:read_admin');

  const patientsToCallToday = data.lists.patientsToCallToday || [];
  const overdueFollowUps = data.lists.overdueFollowUps || [];
  const unvalidatedExams = data.lists.unvalidatedExams || [];
  const controlsToSchedule = data.lists.controlsToSchedule || [];

  const totalAlerts = m.followUpsOverdue + m.overdueTasks;

  return (
    <div className="space-y-6">
      {/* Header & Quick Action Toolbar */}
      <div className="bg-white dark:bg-[#131E30] border border-slate-200/90 dark:border-slate-800 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-[#073B70] dark:text-white font-display">
            Bonjour, {user.title ? `${user.title} ` : ''}{user.firstName} {user.lastName}
          </h1>
          <p className="text-xs text-[#708197] dark:text-slate-400 mt-0.5">
            Pilotage temps réel Supabase · Cloudflare R2 · Resend · {formatDateFr(data.today)} · Zéro décision médicale automatisée
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasPerm(user, 'patients:write_admin') && (
            <button
              type="button"
              onClick={() => navigate('/patients/nouveau')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-[#073B70] hover:bg-[#1265A3] text-white whitespace-nowrap"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Nouveau patient
            </button>
          )}
          {hasPerm(user, 'appointments:write') && (
            <button
              type="button"
              onClick={() => navigate('/rendez-vous/nouveau')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FC]/60 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <CalendarPlus className="w-3.5 h-3.5 text-[#1265A3]" />
              Nouveau rendez-vous
            </button>
          )}
          {hasPerm(user, 'consultations:write') && (
            <button
              type="button"
              onClick={() => navigate('/consultations/nouvelle')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FC]/60 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <Stethoscope className="w-3.5 h-3.5 text-[#D71920]" />
              Nouvelle consultation
            </button>
          )}
          {hasPerm(user, 'examinations:prescribe') && (
            <button
              type="button"
              onClick={() => navigate('/examens/prescrire')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FC]/60 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <HeartPulse className="w-3.5 h-3.5 text-[#D71920]" />
              Prescrire un examen
            </button>
          )}
          {hasPerm(user, 'followups:read') && (
            <button
              type="button"
              onClick={() => navigate('/suivis')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FC]/60 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <Activity className="w-3.5 h-3.5 text-[#1265A3]" />
              Suivi patients
            </button>
          )}
          {hasPerm(user, 'tasks:write') && (
            <button
              type="button"
              onClick={() => navigate('/taches/nouvelle')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FC]/60 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <CheckSquare className="w-3.5 h-3.5 text-[#073B70] dark:text-sky-400" />
              Ajouter une tâche
            </button>
          )}
        </div>
      </div>

      {/* Internal Coordination & Medical Alert Strip */}
      {(totalAlerts > 0 || (isDoctor && m.resultsToValidate > 0)) && (
        <div className="bg-red-50/90 dark:bg-red-950/35 border border-red-200 dark:border-red-900/80 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="relative p-2 rounded-lg bg-[#D71920]/10 text-[#D71920] shrink-0">
              <BellRing className="w-4 h-4 animate-pulse" />
              <span className="absolute -top-1 -right-1">
                <AlertBeacon tone="danger" />
              </span>
            </div>
            <div>
              <div className="text-sm font-semibold text-[#D71920] dark:text-red-300 flex items-center gap-2">
                Alertes prioritaires de coordination ({totalAlerts + (isDoctor ? m.resultsToValidate : 0)})
              </div>
              <p className="text-xs text-[#7A1C20] dark:text-red-200/80 mt-0.5">
                {m.followUpsOverdue} suivi(s) patient en retard, {m.overdueTasks} tâche(s) interne(s) en retard
                {isDoctor && m.resultsToValidate > 0 ? ` et ${m.resultsToValidate} résultat(s) d'examen non validé(s)` : ''}{' '}
                nécessitent une attention immédiate.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {m.followUpsOverdue > 0 && (
              <button
                type="button"
                onClick={() => navigate('/suivis/en-retard')}
                className="px-3 py-1.5 rounded-lg bg-[#D71920] hover:bg-red-700 text-white text-xs font-medium"
              >
                Traiter les suivis ({m.followUpsOverdue})
              </button>
            )}
            {isDoctor && m.resultsToValidate > 0 && (
              <button
                type="button"
                onClick={() => navigate('/examens')}
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium"
              >
                Valider les examens ({m.resultsToValidate})
              </button>
            )}
            {m.overdueTasks > 0 && (
              <button
                type="button"
                onClick={() => navigate('/taches')}
                className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-red-200 dark:border-red-800 text-[#D71920] dark:text-red-300 text-xs font-medium"
              >
                Voir les tâches ({m.overdueTasks})
              </button>
            )}
          </div>
        </div>
      )}

      {/* Role-specific KPI Grid */}
      {isDoctor ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <StatCard label="Patients actifs" value={m.totalPatients} icon={<Users className="w-4 h-4" />} tone="primary" onClick={() => onNavigate('patients')} />
          <StatCard label="Consultations du jour" value={m.consultationsToday} icon={<Stethoscope className="w-4 h-4" />} onClick={() => onNavigate('consultations')} />
          <StatCard label="Patients en attente" value={m.patientsWaiting} subtext={`${m.patientsInConsultation} en consultation`} icon={<Clock className="w-4 h-4" />} onClick={() => onNavigate('queue')} />
          <StatCard
            label="Examens non validés"
            value={m.resultsToValidate}
            subtext={`${m.examsToInterpret} à interpréter`}
            icon={<HeartPulse className="w-4 h-4" />}
            tone={m.resultsToValidate > 0 ? 'warning' : 'default'}
            alertPulse={m.resultsToValidate > 0}
            onClick={() => onNavigate('examinations')}
          />
          <StatCard
            label="Suivis en retard"
            value={m.followUpsOverdue}
            subtext={`${m.followUpsToday} à rappeler aujourd'hui`}
            icon={<Activity className="w-4 h-4" />}
            tone={m.followUpsOverdue > 0 ? 'danger' : 'success'}
            alertPulse={m.followUpsOverdue > 0}
            onClick={() => navigate('/suivis/en-retard')}
          />
        </div>
      ) : isAdmin ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="Total patients actifs" value={m.totalPatients} subtext={`+${m.newPatientsThisMonth} ce mois`} icon={<Users className="w-4 h-4" />} tone="primary" onClick={() => onNavigate('patients')} />
          <StatCard label="Consultations / Examens" value={`${m.totalConsultations} / ${m.examsPerformed}`} subtext={`${m.resultsToValidate} examen(s) non validé(s)`} icon={<HeartPulse className="w-4 h-4" />} onClick={() => onNavigate('examinations')} />
          <StatCard label="Suivis & Tâches en retard" value={m.followUpsOverdue + m.overdueTasks} subtext={`${m.absenceRate}% d'absences RDV`} icon={<AlertTriangle className="w-4 h-4" />} tone={m.followUpsOverdue + m.overdueTasks > 0 ? 'danger' : 'success'} onClick={() => navigate('/suivis/en-retard')} />
          <StatCard label="Recettes encaissées" value={formatFcfa(m.totalRevenueFcfa)} subtext={`Solde dû : ${formatFcfa(m.pendingBalanceFcfa)}`} tone="success" onClick={() => onNavigate('finance')} />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <StatCard label="Rendez-vous du jour" value={m.appointmentsToday} subtext={`${m.appointmentsConfirmed} confirmés · ${m.appointmentsUnconfirmed} à confirmer`} icon={<CalendarCheck className="w-4 h-4" />} tone="primary" onClick={() => onNavigate('appointments')} />
          <StatCard label="File d'attente active" value={m.patientsWaiting} subtext={`${m.patientsArrived} arrivés · ${m.patientsInConsultation} en cours`} icon={<Clock className="w-4 h-4" />} onClick={() => onNavigate('queue')} />
          <StatCard label="À rappeler aujourd'hui" value={m.followUpsToday} subtext={`${m.controlsToScheduleCount} contrôle(s) à planifier`} icon={<PhoneCall className="w-4 h-4" />} tone={m.followUpsToday > 0 ? 'primary' : 'default'} onClick={() => navigate('/suivis/a-rappeler-aujourdhui')} />
          <StatCard label="Demandes patients" value={m.patientRequests} subtext={`${m.appointmentsAbsent} absent(s)`} tone={m.patientRequests > 0 ? 'warning' : 'default'} onClick={() => onNavigate('appointments')} />
          <StatCard label="Retards suivis / tâches" value={m.followUpsOverdue + m.overdueTasks} subtext={`${m.openTasks} tâches ouvertes`} icon={<AlertTriangle className="w-4 h-4" />} tone={m.followUpsOverdue + m.overdueTasks > 0 ? 'danger' : 'success'} onClick={() => onNavigate('tasks')} />
        </div>
      )}

      {/* Coordination Center: 4 Explicit Operational Cards */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-[#073B70] dark:text-white font-display">
              Centre de coordination des parcours patients
            </h2>
            <p className="text-xs text-[#708197] dark:text-slate-400">
              Identification automatique des actions humaines à réaliser aujourd'hui sans décision médicale automatisée
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/suivis')}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#1265A3] dark:text-sky-400 hover:underline"
          >
            Ouvrir le module de suivi <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* 1. Patients à rappeler aujourd'hui */}
          <div className="bg-white dark:bg-[#131E30] border border-slate-200/90 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col">
            <div className="px-5 py-3.5 bg-[#F8FBFE] dark:bg-[#0F1827] border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PhoneCall className="w-4 h-4 text-[#1265A3]" />
                <h3 className="text-sm font-semibold text-[#172B45] dark:text-white">
                  Patients à rappeler aujourd'hui
                </h3>
              </div>
              <StatusBadge label={`${patientsToCallToday.length}`} tone={patientsToCallToday.length > 0 ? 'info' : 'neutral'} />
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 flex-1">
              {patientsToCallToday.length === 0 ? (
                <div className="p-6 text-center text-xs text-[#708197]">
                  Aucun rappel patient programmé pour aujourd'hui.
                </div>
              ) : (
                patientsToCallToday.map((f) => (
                  <div key={f._id} className="px-5 py-3 flex items-start justify-between gap-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onNavigate('patients', f.patientNumber || f.patientId)}
                          className="text-xs font-semibold text-[#073B70] dark:text-sky-300 hover:underline truncate"
                        >
                          {f.patientName}
                        </button>
                        {f.patientPhone && (
                          <span className="text-[11px] font-mono text-[#1265A3] dark:text-sky-400">
                            {f.patientPhone}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[#708197] dark:text-slate-400 truncate mt-0.5">
                        {FOLLOWUP_TYPE_LABELS[f.type]} · {f.reason}
                      </div>
                      <div className="text-[11px] text-[#708197] mt-1">
                        Responsable : <span className="font-medium text-[#172B45] dark:text-slate-200">{f.assigneeName}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate(`/suivis/${encodeURIComponent(f._id)}/relance`)}
                      className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-[#073B70] dark:text-sky-300 hover:bg-[#EAF4FC]/60 shrink-0"
                    >
                      Relancer
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 2. Suivis en retard */}
          <div className={`bg-white dark:bg-[#131E30] border rounded-xl overflow-hidden flex flex-col ${overdueFollowUps.length > 0 ? 'border-red-200 dark:border-red-900/70' : 'border-slate-200/90 dark:border-slate-800'}`}>
            <div className="px-5 py-3.5 bg-[#F8FBFE] dark:bg-[#0F1827] border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {overdueFollowUps.length > 0 && <AlertBeacon tone="danger" title="Suivis en retard prioritaires" />}
                <AlertTriangle className={`w-4 h-4 text-[#D71920] ${overdueFollowUps.length > 0 ? 'animate-pulse' : ''}`} />
                <h3 className="text-sm font-semibold text-[#172B45] dark:text-white">
                  Suivis en retard
                </h3>
              </div>
              <StatusBadge
                label={overdueFollowUps.length > 0 ? `${overdueFollowUps.length} en retard` : '0'}
                tone={overdueFollowUps.length > 0 ? 'danger' : 'success'}
                icon={overdueFollowUps.length > 0 ? <AlertTriangle className="w-3 h-3 animate-pulse" /> : undefined}
              />
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 flex-1">
              {overdueFollowUps.length === 0 ? (
                <div className="p-6 text-center text-xs text-emerald-700 dark:text-emerald-400">
                  Aucun suivi en retard : toutes les relances sont à jour.
                </div>
              ) : (
                overdueFollowUps.map((f) => {
                  const isHighPriority = f.priority === 'CRITIQUE' || f.priority === 'HAUTE';
                  return (
                    <div key={f._id} className="px-5 py-3 flex items-start justify-between gap-3 hover:bg-red-50/30 dark:hover:bg-red-950/20">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <AlertBeacon tone={isHighPriority ? 'danger' : 'warning'} />
                          <button
                            type="button"
                            onClick={() => onNavigate('patients', f.patientNumber || f.patientId)}
                            className="text-xs font-semibold text-[#172B45] dark:text-white hover:underline truncate"
                          >
                            {f.patientName}
                          </button>
                          <StatusBadge
                            label={f.daysOverdue ? `+${f.daysOverdue}j retard` : 'En retard'}
                            tone="danger"
                            icon={<AlertTriangle className="w-3 h-3" />}
                          />
                          {isHighPriority && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide bg-[#D71920] text-white animate-pulse">
                              {PRIORITY_LABELS[f.priority]}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-[#708197] dark:text-slate-400 truncate mt-0.5">
                          {f.reason}
                        </div>
                        <div className="text-[11px] font-mono text-[#708197] mt-1 tabular-nums">
                          Échéance : {formatDateFr(f.dueDate)} · {f.assigneeName}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => navigate(`/suivis/${encodeURIComponent(f._id)}/relance`)}
                        className="px-2.5 py-1 rounded-lg bg-[#D71920] hover:bg-red-700 text-white text-[11px] font-medium shrink-0"
                      >
                        Traiter
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 3. Examens dont les résultats ne sont pas encore validés */}
          <div className={`bg-white dark:bg-[#131E30] border rounded-xl overflow-hidden flex flex-col ${unvalidatedExams.length > 0 ? 'border-amber-300 dark:border-amber-800/80' : 'border-slate-200/90 dark:border-slate-800'}`}>
            <div className="px-5 py-3.5 bg-[#F8FBFE] dark:bg-[#0F1827] border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {unvalidatedExams.length > 0 && <AlertBeacon tone="warning" title="Résultats en attente de validation" />}
                <HeartPulse className={`w-4 h-4 text-[#D71920] ${unvalidatedExams.length > 0 ? 'animate-pulse' : ''}`} />
                <h3 className="text-sm font-semibold text-[#172B45] dark:text-white">
                  Examens en attente de validation médicale
                </h3>
              </div>
              <StatusBadge
                label={unvalidatedExams.length > 0 ? `${unvalidatedExams.length} à valider` : '0'}
                tone={unvalidatedExams.length > 0 ? 'warning' : 'success'}
                icon={unvalidatedExams.length > 0 ? <BellRing className="w-3 h-3 animate-pulse" /> : undefined}
              />
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 flex-1">
              {unvalidatedExams.length === 0 ? (
                <div className="p-6 text-center text-xs text-[#708197]">
                  Tous les examens réalisés ont été validés par le cardiologue.
                </div>
              ) : (
                unvalidatedExams.map((ex) => {
                  const needsDoctorAction =
                    ex.status === 'RESULTAT_DISPONIBLE' || ex.status === 'A_INTERPRETER' || ex.status === 'REALISE';
                  return (
                    <div key={ex._id} className="px-5 py-3 flex items-start justify-between gap-3 hover:bg-amber-50/40 dark:hover:bg-amber-950/15">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <AlertBeacon tone={needsDoctorAction ? 'danger' : 'warning'} />
                          <span className="text-xs font-mono font-semibold text-[#073B70] dark:text-sky-300">
                            {ex.examNumber}
                          </span>
                          <span className="text-xs font-semibold text-[#172B45] dark:text-white truncate">
                            {ex.patientName}
                          </span>
                          {needsDoctorAction && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950/80 dark:text-amber-300 dark:border-amber-700 animate-pulse">
                              <AlertTriangle className="w-3 h-3" /> Validation requise
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-[#708197] dark:text-slate-400 truncate mt-0.5">
                          {EXAMINATION_TYPE_LABELS[ex.type]} · Prescrit le {formatDateFr(ex.prescriptionDate)}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          navigate(
                            `/examens/${encodeURIComponent(ex._id)}/${isDoctor ? 'valider' : 'operer'}`
                          )
                        }
                        className="shrink-0"
                      >
                        <StatusBadge
                          label={EXAMINATION_STATUS_LABELS[ex.status]}
                          tone={needsDoctorAction ? 'danger' : 'warning'}
                          icon={<AlertTriangle className="w-3 h-3" />}
                        />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 4. Contrôles à programmer */}
          <div className="bg-white dark:bg-[#131E30] border border-slate-200/90 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col">
            <div className="px-5 py-3.5 bg-[#F8FBFE] dark:bg-[#0F1827] border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarCheck className="w-4 h-4 text-[#073B70] dark:text-sky-300" />
                <h3 className="text-sm font-semibold text-[#172B45] dark:text-white">
                  Contrôles à programmer
                </h3>
              </div>
              <StatusBadge label={`${controlsToSchedule.length}`} tone={controlsToSchedule.length > 0 ? 'info' : 'neutral'} />
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 flex-1">
              {controlsToSchedule.length === 0 ? (
                <div className="p-6 text-center text-xs text-[#708197]">
                  Tous les contrôles recommandés disposent déjà d'un rendez-vous planifié.
                </div>
              ) : (
                controlsToSchedule.map((c) => (
                  <div key={`${c.source}-${c.id}`} className="px-5 py-3 flex items-start justify-between gap-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onNavigate('patients', c.patientNumber || c.patientId)}
                          className="text-xs font-semibold text-[#073B70] dark:text-sky-300 hover:underline truncate"
                        >
                          {c.patientName}
                        </button>
                        {c.patientPhone && (
                          <span className="text-[11px] font-mono text-[#708197]">{c.patientPhone}</span>
                        )}
                      </div>
                      <div className="text-xs text-[#708197] dark:text-slate-400 truncate mt-0.5">
                        {c.label}
                      </div>
                      <div className="text-[11px] font-mono text-[#708197] mt-1 tabular-nums">
                        Date cible : {formatDateFr(c.recommendedDate)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        navigate(
                          `/rendez-vous/nouveau?patientId=${encodeURIComponent(c.patientId)}&date=${encodeURIComponent(c.recommendedDate)}`
                        )
                      }
                      className="px-2.5 py-1 rounded-lg bg-[#073B70] hover:bg-[#1265A3] text-white text-[11px] font-medium shrink-0"
                    >
                      Planifier RDV
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white dark:bg-[#131E30] border border-slate-200/90 dark:border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-[#172B45] dark:text-white">
                Activité des 7 derniers jours
              </h2>
              <p className="text-xs text-[#708197] dark:text-slate-400">
                Rendez-vous {isDoctor || isAdmin ? 'et consultations médicales' : 'enregistrés'}
              </p>
            </div>
          </div>
          {data.charts.last7Days.every((d) => d.consultations === 0 && d.appointments === 0) ? (
            <div className="h-56 flex items-center justify-center text-xs text-[#708197]">
              Aucune activité enregistrée sur les 7 derniers jours.
            </div>
          ) : (
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.charts.last7Days} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#708197' }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#708197' }} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid #E2E8F0',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="appointments" name="Rendez-vous" fill="#1265A3" radius={[4, 4, 0, 0]} />
                  {isDoctor || isAdmin ? (
                    <Bar dataKey="consultations" name="Consultations" fill="#073B70" radius={[4, 4, 0, 0]} />
                  ) : null}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="lg:col-span-5 bg-white dark:bg-[#131E30] border border-slate-200/90 dark:border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-[#172B45] dark:text-white">
                Examens cardiologiques par catégorie
              </h2>
              <p className="text-xs text-[#708197] dark:text-slate-400">
                Répartition des explorations prescrites
              </p>
            </div>
          </div>
          {data.charts.examsByCategory.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-xs text-[#708197]">
              Aucun examen enregistré pour le moment.
            </div>
          ) : (
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.charts.examsByCategory}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: 10, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#708197' }} />
                  <YAxis type="category" dataKey="name" width={135} tick={{ fontSize: 11, fill: '#708197' }} />
                  <Tooltip contentStyle={{ borderRadius: '8px', fontSize: '12px' }} />
                  <Bar dataKey="value" name="Examens" radius={[0, 4, 4, 0]}>
                    {data.charts.examsByCategory.map((_, idx) => (
                      <Cell key={idx} fill={BAR_COLORS[idx % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Operational Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upcoming Schedule */}
        <div className="bg-white dark:bg-[#131E30] border border-slate-200/90 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Prochains rendez-vous</h3>
            <button
              type="button"
              onClick={() => onNavigate('appointments')}
              className="text-xs font-medium text-[#1265A3] dark:text-sky-400 hover:underline"
            >
              Calendrier
            </button>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 flex-1">
            {data.lists.upcomingSchedule.length === 0 ? (
              <div className="p-6 text-center text-xs text-[#708197]">
                Aucun rendez-vous programmé.
              </div>
            ) : (
              data.lists.upcomingSchedule.map((a) => (
                <div key={a._id} className="px-5 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => navigate(`/rendez-vous/${encodeURIComponent(a._id)}/modifier`)}
                      className="text-xs font-semibold text-[#172B45] dark:text-slate-100 hover:underline truncate block text-left"
                    >
                      {a.patientName}
                    </button>
                    <div className="text-xs text-[#708197] dark:text-slate-400 truncate mt-0.5">
                      {APPOINTMENT_TYPE_LABELS[a.type]}
                    </div>
                    <div className="text-[11px] font-mono text-[#708197] mt-1 tabular-nums">
                      {formatDateFr(a.date)} · {a.startTime}
                    </div>
                  </div>
                  <StatusBadge
                    label={APPOINTMENT_STATUS_LABELS[a.status]}
                    tone={
                      a.adminPriority === 'URGENCE_A_VALIDER'
                        ? 'danger'
                        : a.status === 'CONFIRME'
                        ? 'info'
                        : 'neutral'
                    }
                  />
                </div>
              ))
            )}
          </div>
        </div>

        {/* Uncompleted & Urgent Tasks */}
        <div className="bg-white dark:bg-[#131E30] border border-slate-200/90 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Tâches non réalisées</h3>
            <button
              type="button"
              onClick={() => onNavigate('tasks')}
              className="text-xs font-medium text-[#1265A3] dark:text-sky-400 hover:underline"
            >
              Tout voir
            </button>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 flex-1">
            {data.lists.urgentTasks.length === 0 ? (
              <div className="p-6 text-center text-xs text-[#708197]">
                Aucune tâche en attente.
              </div>
            ) : (
              data.lists.urgentTasks.map((t) => {
                const isOverdue = t.dueDate < data.today;
                return (
                  <div key={t._id} className="px-5 py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => navigate(`/taches/${encodeURIComponent(t._id)}/historique`)}
                        className="text-xs font-semibold text-[#172B45] dark:text-slate-100 hover:underline truncate block text-left"
                      >
                        {t.title}
                      </button>
                      <div className="text-[11px] text-[#708197] mt-0.5 tabular-nums">
                        {t.assigneeName} · Limite : {formatDateFr(t.dueDate)}
                      </div>
                    </div>
                    <StatusBadge
                      label={isOverdue ? 'En retard' : PRIORITY_LABELS[t.priority]}
                      tone={isOverdue || t.priority === 'CRITIQUE' || t.priority === 'HAUTE' ? 'danger' : 'neutral'}
                    />
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Recent Active Patients */}
        <div className="bg-white dark:bg-[#131E30] border border-slate-200/90 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Derniers patients enregistrés</h3>
            <button
              type="button"
              onClick={() => onNavigate('patients')}
              className="text-xs font-medium text-[#1265A3] dark:text-sky-400 hover:underline"
            >
              Répertoire
            </button>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 flex-1">
            {data.lists.recentPatients.length === 0 ? (
              <div className="p-6 text-center text-xs text-[#708197]">
                Aucun patient actif.
              </div>
            ) : (
              data.lists.recentPatients.map((p) => (
                <button
                  key={p._id}
                  type="button"
                  onClick={() => onNavigate('patients', p.patientNumber || p._id)}
                  className="w-full text-left px-5 py-3 hover:bg-[#EAF4FC]/45 dark:hover:bg-slate-800/60 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[#073B70] dark:text-sky-300 truncate">
                      {p.firstName} {p.lastName}
                    </div>
                    <div className="text-[11px] font-mono text-[#708197]">
                      {p.patientNumber} · {p.phone}
                    </div>
                  </div>
                  <FilePlus2 className="w-4 h-4 text-slate-400 shrink-0" />
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
