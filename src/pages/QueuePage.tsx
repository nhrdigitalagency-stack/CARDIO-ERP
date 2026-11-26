import React, { useEffect, useState } from 'react';
import { BellRing, CheckCircle2, Clock, Play, RefreshCw, ShieldAlert, Stethoscope, UserCheck, UserX } from 'lucide-react';
import { AppointmentStatusBadge, EmptyState, StatCard, TableSkeleton } from '../components/UIPrimitives';
import type { Appointment, PublicUser } from '../shared/types';
import { APPOINTMENT_TYPE_LABELS } from '../shared/constants';
import { apiFetch, formatDateTimeFr, hasPerm } from '../lib/api';
import { buildQuerySuffix, navigate, useAppRoute } from '../lib/router';
import { useLiveSync } from '../lib/useLiveSync';

function formatWaitDuration(arrivedAt?: string, startedAt?: string): string | null {
  if (!arrivedAt) return null;
  const startMs = new Date(arrivedAt).getTime();
  const endMs = startedAt ? new Date(startedAt).getTime() : Date.now();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null;
  const mins = Math.max(0, Math.round((endMs - startMs) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h${String(m).padStart(2, '0')}`;
}

export const QueuePage: React.FC<{
  user: PublicUser;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
}> = ({ user, notify }) => {
  const route = useAppRoute();
  const todayIso = new Date().toISOString().slice(0, 10);
  const urlDate = route.query.get('date');
  const date = urlDate && /^\d{4}-\d{2}-\d{2}$/.test(urlDate) ? urlDate : todayIso;

  const setDate = (nextDate: string) => {
    navigate(`/file-attente${buildQuerySuffix({ date: nextDate === todayIso ? undefined : nextDate })}`);
  };

  const [queue, setQueue] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await apiFetch<{ queue: Appointment[] }>(`/api/queue?date=${date}`);
      setQueue(res.queue);
    } catch (err: any) {
      if (!silent) notify('error', err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      setTick((t) => t + 1);
    }, 30000);
    return () => clearInterval(timer);
  }, [date]);

  useLiveSync(['queue', 'appointment'], () => load(true));

  const runAction = async (
    id: string,
    action: 'ARRIVED' | 'WAITING' | 'SIGNAL_DOCTOR' | 'START_CONSULTATION' | 'FINISH' | 'ABSENT'
  ) => {
    setBusyId(id);
    try {
      await apiFetch(`/api/queue/${id}/action`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      const labels: Record<string, string> = {
        ARRIVED: 'Arrivée enregistrée avec numéro de passage.',
        WAITING: 'Patient placé en salle d’attente.',
        SIGNAL_DOCTOR: 'Médecin notifié de la disponibilité du patient.',
        START_CONSULTATION: 'Consultation démarrée.',
        FINISH: 'Prise en charge terminée.',
        ABSENT: 'Patient marqué absent.',
      };
      notify('success', labels[action]);
      await load(true);
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setBusyId(null);
    }
  };

  const canManage = hasPerm(user, 'queue:manage');
  const waitingCount = queue.filter((q) => q.status === 'PATIENT_ARRIVE' || q.status === 'EN_ATTENTE_CONSULTATION').length;
  const inConsultCount = queue.filter((q) => q.status === 'EN_CONSULTATION').length;
  const doneCount = queue.filter((q) => q.status === 'TERMINE').length;

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-[#131E30] border border-slate-200/90 dark:border-slate-800 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-base font-bold text-[#073B70] dark:text-white font-display">
            File d'attente & Salle d'attente du cabinet
          </h1>
          <p className="text-xs text-[#708197] dark:text-slate-400 mt-0.5">
            Synchronisation temps réel Supabase · Numéros de passage, durées d'attente et signalement médecin
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
          />
          <button
            type="button"
            onClick={() => load()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-[#EAF4FC]/60 dark:hover:bg-slate-800"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Actualiser
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Patients attendus (jour)" value={queue.length} icon={<Clock className="w-4 h-4" />} tone="primary" />
        <StatCard label="En salle d'attente" value={waitingCount} tone={waitingCount > 0 ? 'warning' : 'default'} />
        <StatCard label="En consultation" value={inConsultCount} tone="primary" />
        <StatCard label="Prises en charge terminées" value={doneCount} tone="success" />
      </div>

      {loading ? (
        <TableSkeleton rows={5} />
      ) : queue.length === 0 ? (
        <EmptyState
          icon={<Clock className="w-5 h-5" />}
          title="Aucun patient dans la file d'attente pour cette date"
          description="Les rendez-vous confirmés ou en attente pour la journée sélectionnée apparaîtront automatiquement ici."
        />
      ) : (
        <div className="bg-white dark:bg-[#131E30] border border-slate-200/90 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-[#F8FBFE] dark:bg-slate-900/60 text-xs text-[#708197] border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3 font-semibold">Passage</th>
                  <th className="px-4 py-3 font-semibold">Patient</th>
                  <th className="px-4 py-3 font-semibold">Type & Motif</th>
                  <th className="px-4 py-3 font-semibold">Horaires & Attente</th>
                  <th className="px-4 py-3 font-semibold">Statut</th>
                  {canManage && <th className="px-4 py-3 font-semibold text-right">Actions accueil / médecin</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {queue.map((q) => {
                  const waitDuration =
                    q.status === 'PATIENT_ARRIVE' || q.status === 'EN_ATTENTE_CONSULTATION'
                      ? formatWaitDuration(q.arrivedAt)
                      : q.arrivedAt && q.consultationStartedAt
                      ? formatWaitDuration(q.arrivedAt, q.consultationStartedAt)
                      : null;

                  return (
                    <tr key={q._id} className="hover:bg-[#EAF4FC]/30 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center justify-center min-w-[44px] px-2.5 py-1 rounded-lg bg-[#EAF4FC] dark:bg-[#073B70]/45 font-mono font-bold text-sm text-[#073B70] dark:text-sky-200 tabular-nums">
                          {q.queueNumber ? `#${String(q.queueNumber).padStart(2, '0')}` : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {hasPerm(user, 'patients:read_admin') ? (
                            <button
                              type="button"
                              onClick={() => navigate(`/patients/${encodeURIComponent(q.patientNumber || q.patientId)}`)}
                              className="font-semibold text-[#073B70] dark:text-sky-300 hover:underline text-left"
                            >
                              {q.patientName}
                            </button>
                          ) : (
                            <span className="font-semibold text-[#172B45] dark:text-white">{q.patientName}</span>
                          )}
                          {q.adminPriority === 'URGENCE_A_VALIDER' && (
                            <span title="Priorité urgence" className="inline-flex shrink-0">
                              <ShieldAlert className="w-4 h-4 text-[#D71920]" />
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-mono text-[#708197]">{q.patientNumber} · {q.doctorName}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-xs font-semibold text-[#073B70] dark:text-sky-300">{APPOINTMENT_TYPE_LABELS[q.type]}</div>
                        <div className="text-xs text-[#708197]">{q.reason}</div>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono tabular-nums text-[#708197]">
                        <div>RDV : {q.startTime}</div>
                        {q.arrivedAt && <div>Arrivée : {formatDateTimeFr(q.arrivedAt).slice(-5)}</div>}
                        {waitDuration && (
                          <div className="text-amber-700 dark:text-amber-400 font-semibold">
                            Attente : {waitDuration}
                          </div>
                        )}
                        {q.consultationStartedAt && (
                          <div className="text-[#073B70] dark:text-sky-300">
                            Début : {formatDateTimeFr(q.consultationStartedAt).slice(-5)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <AppointmentStatusBadge status={q.status} />
                      </td>
                      {canManage && (
                        <td className="px-4 py-3 text-right whitespace-nowrap space-x-1.5">
                          {(q.status === 'EN_ATTENTE' || q.status === 'CONFIRME') && (
                            <>
                              <button
                                type="button"
                                disabled={busyId === q._id}
                                onClick={() => runAction(q._id, 'ARRIVED')}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#073B70] hover:bg-[#1265A3] text-white text-xs font-medium"
                              >
                                <UserCheck className="w-3.5 h-3.5" /> Arrivé
                              </button>
                              <button
                                type="button"
                                disabled={busyId === q._id}
                                onClick={() => runAction(q._id, 'ABSENT')}
                                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-[#D71920] hover:bg-red-50"
                                title="Marquer absent"
                              >
                                <UserX className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                          {q.status === 'PATIENT_ARRIVE' && (
                            <button
                              type="button"
                              disabled={busyId === q._id}
                              onClick={() => runAction(q._id, 'SIGNAL_DOCTOR')}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#1265A3] hover:bg-[#073B70] text-white text-xs font-medium"
                            >
                              <BellRing className="w-3.5 h-3.5" /> Signaler au médecin
                            </button>
                          )}
                          {(q.status === 'PATIENT_ARRIVE' || q.status === 'EN_ATTENTE_CONSULTATION') && (
                            <button
                              type="button"
                              disabled={busyId === q._id}
                              onClick={() => runAction(q._id, 'START_CONSULTATION')}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium"
                            >
                              <Play className="w-3.5 h-3.5" /> En consultation
                            </button>
                          )}
                          {q.status === 'EN_CONSULTATION' && (
                            <>
                              {hasPerm(user, 'consultations:write') && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    navigate(
                                      `/consultations/nouvelle${buildQuerySuffix({
                                        patientId: q.patientId,
                                        appointmentId: q._id,
                                      })}`
                                    )
                                  }
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#073B70] hover:bg-[#1265A3] text-white text-xs font-medium"
                                >
                                  <Stethoscope className="w-3.5 h-3.5" /> Rédiger
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={busyId === q._id}
                                onClick={() => runAction(q._id, 'FINISH')}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" /> Terminer
                              </button>
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
