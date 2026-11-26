import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Calendar as CalendarIcon,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  GripVertical,
  Move,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import {
  AppointmentStatusBadge,
  ConfirmModal,
  EmptyState,
  Modal,
  StatusBadge,
  TableSkeleton,
} from '../components/UIPrimitives';
import type {
  Appointment,
  AppointmentStatus,
  AppointmentType,
  Patient,
  PublicUser,
} from '../shared/types';
import { APPOINTMENT_STATUS_LABELS, APPOINTMENT_TYPE_LABELS } from '../shared/constants';
import { apiFetch, formatDateFr, hasPerm } from '../lib/api';
import { buildQuerySuffix, navigate, useAppRoute } from '../lib/router';
import { useLiveSync } from '../lib/useLiveSync';

type CalendarViewMode = 'day' | 'week' | 'month';

const DAY_TIME_SLOTS: string[] = Array.from({ length: 23 }, (_, idx) => {
  const totalMinutes = 7 * 60 + 30 + idx * 30;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
});

function timeToMinutes(hhmm: string): number {
  const [h, m] = (hhmm || '09:00').split(':').map(Number);
  return (Number.isFinite(h) ? h : 9) * 60 + (Number.isFinite(m) ? m : 0);
}

function minutesToTime(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, totalMinutes));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function getWeekBounds(isoDate: string): { start: string; end: string; days: string[] } {
  const d = new Date(isoDate + 'T12:00:00');
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const cur = new Date(monday);
    cur.setDate(monday.getDate() + i);
    days.push(cur.toISOString().slice(0, 10));
  }
  return { start: days[0], end: days[6], days };
}

function getMonthBounds(isoDate: string): { start: string; end: string; cells: Array<{ date: string; inMonth: boolean }> } {
  const [y, m] = isoDate.split('-').map(Number);
  const firstDay = new Date(y, m - 1, 1);
  const lastDay = new Date(y, m, 0);
  const startDow = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
  const cells: Array<{ date: string; inMonth: boolean }> = [];
  const startDate = new Date(firstDay);
  startDate.setDate(firstDay.getDate() - startDow);

  for (let i = 0; i < 42; i++) {
    const cur = new Date(startDate);
    cur.setDate(startDate.getDate() + i);
    const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
    cells.push({ date: iso, inMonth: cur.getMonth() === m - 1 });
  }
  const endIso = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;
  return {
    start: `${y}-${String(m).padStart(2, '0')}-01`,
    end: endIso,
    cells,
  };
}

export const AppointmentsPage: React.FC<{
  user: PublicUser;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
}> = ({ user, notify }) => {
  const route = useAppRoute();
  const todayIso = new Date().toISOString().slice(0, 10);

  const rawView = route.query.get('vue');
  const viewMode: CalendarViewMode =
    rawView === 'day' || rawView === 'week' || rawView === 'month' ? rawView : 'week';
  const rawDate = route.query.get('date');
  const anchorDate = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : todayIso;

  const seg1 = route.segments[1] || '';
  const seg2 = route.segments[2] || '';
  const isCreateUrl = route.segments[0] === 'rendez-vous' && seg1 === 'nouveau';
  const isEditUrl = route.segments[0] === 'rendez-vous' && Boolean(seg1 && seg1 !== 'nouveau' && seg2 === 'modifier');
  const isCancelUrl = route.segments[0] === 'rendez-vous' && Boolean(seg1 && seg1 !== 'nouveau' && seg2 === 'annuler');
  const urlApptId = seg1 && seg1 !== 'nouveau' ? seg1 : null;
  const queryPatientId = route.query.get('patientId') || '';

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [doctors, setDoctors] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);

  const [doctorFilter, setDoctorFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const [editingAppt, setEditingAppt] = useState<Appointment | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    patientId: queryPatientId,
    doctorId: '',
    date: anchorDate,
    startTime: '09:00',
    endTime: '09:30',
    type: 'CONSULTATION_SUIVI' as AppointmentType,
    reason: '',
    adminPriority: 'NORMALE' as 'NORMALE' | 'PRIORITAIRE' | 'URGENCE_A_VALIDER',
    notes: '',
  });

  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const canWriteAppointments = hasPerm(user, 'appointments:write');
  const [dragMode, setDragMode] = useState(true);
  const [draggedAppt, setDraggedAppt] = useState<Appointment | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  const [dropCheckState, setDropCheckState] = useState<{
    key: string;
    available: boolean;
    message?: string;
    checking?: boolean;
  } | null>(null);
  const [movingApptId, setMovingApptId] = useState<string | null>(null);

  const baseQuery = (extra?: Record<string, string | undefined>) =>
    buildQuerySuffix({
      vue: viewMode === 'week' ? undefined : viewMode,
      date: anchorDate === todayIso ? undefined : anchorDate,
      ...extra,
    });

  const setViewMode = (mode: CalendarViewMode) => {
    navigate(
      `/rendez-vous${buildQuerySuffix({
        vue: mode === 'week' ? undefined : mode,
        date: anchorDate === todayIso ? undefined : anchorDate,
      })}`
    );
  };

  const setAnchorDate = (nextDate: string, nextView?: CalendarViewMode) => {
    const v = nextView || viewMode;
    navigate(
      `/rendez-vous${buildQuerySuffix({
        vue: v === 'week' ? undefined : v,
        date: nextDate === todayIso ? undefined : nextDate,
      })}`
    );
  };

  const loadMeta = async () => {
    try {
      const [patsRes, docsRes] = await Promise.all([
        apiFetch<{ patients: Patient[] }>('/api/patients?status=ACTIF'),
        apiFetch<{ doctors: PublicUser[] }>('/api/users/doctors'),
      ]);
      setPatients(patsRes.patients);
      setDoctors(docsRes.doctors);
      setForm((f) => ({
        ...f,
        doctorId: f.doctorId || docsRes.doctors[0]?._id || '',
        patientId: queryPatientId || f.patientId || patsRes.patients[0]?._id || '',
      }));
    } catch {
      // handled in main load
    }
  };

  const loadAppointments = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (viewMode === 'day') {
        qs.set('date', anchorDate);
      } else if (viewMode === 'week') {
        const wb = getWeekBounds(anchorDate);
        qs.set('startDate', wb.start);
        qs.set('endDate', wb.end);
      } else {
        const mb = getMonthBounds(anchorDate);
        qs.set('startDate', mb.start);
        qs.set('endDate', mb.end);
      }
      if (doctorFilter) qs.set('doctorId', doctorFilter);
      if (typeFilter) qs.set('type', typeFilter);
      if (statusFilter) qs.set('status', statusFilter);

      const res = await apiFetch<{ appointments: Appointment[] }>(`/api/appointments?${qs.toString()}`);
      setAppointments(res.appointments);
    } catch (err: any) {
      if (!silent) notify('error', err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadMeta();
  }, []);

  useEffect(() => {
    loadAppointments();
  }, [viewMode, anchorDate, doctorFilter, typeFilter, statusFilter]);

  // Hydrate create/edit/cancel modals from URL
  useEffect(() => {
    if (isCreateUrl) {
      if (!hasPerm(user, 'appointments:write')) {
        navigate(`/rendez-vous${baseQuery()}`, { replace: true });
        return;
      }
      setEditingAppt(null);
      setForm({
        patientId: queryPatientId || patients[0]?._id || '',
        doctorId: doctors[0]?._id || '',
        date: rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : anchorDate,
        startTime: '09:00',
        endTime: '09:30',
        type: 'CONSULTATION_SUIVI',
        reason: '',
        adminPriority: 'NORMALE',
        notes: '',
      });
    } else if (isEditUrl && urlApptId) {
      const found = appointments.find((a) => a._id === urlApptId);
      if (found) {
        setEditingAppt(found);
        setForm({
          patientId: found.patientId,
          doctorId: found.doctorId,
          date: found.date,
          startTime: found.startTime,
          endTime: found.endTime,
          type: found.type,
          reason: found.reason,
          adminPriority: found.adminPriority,
          notes: found.notes || '',
        });
      } else if (!loading) {
        apiFetch<{ appointments: Appointment[] }>('/api/appointments')
          .then((res) => {
            const match = res.appointments.find((a) => a._id === urlApptId);
            if (match) {
              setEditingAppt(match);
              setForm({
                patientId: match.patientId,
                doctorId: match.doctorId,
                date: match.date,
                startTime: match.startTime,
                endTime: match.endTime,
                type: match.type,
                reason: match.reason,
                adminPriority: match.adminPriority,
                notes: match.notes || '',
              });
            } else {
              navigate(`/rendez-vous${baseQuery()}`, { replace: true });
            }
          })
          .catch(() => navigate(`/rendez-vous${baseQuery()}`, { replace: true }));
      }
    } else if (isCancelUrl && urlApptId) {
      const found = appointments.find((a) => a._id === urlApptId);
      if (found) {
        setCancelTarget(found);
      } else if (!loading) {
        apiFetch<{ appointments: Appointment[] }>('/api/appointments')
          .then((res) => {
            const match = res.appointments.find((a) => a._id === urlApptId);
            if (match) setCancelTarget(match);
            else navigate(`/rendez-vous${baseQuery()}`, { replace: true });
          })
          .catch(() => navigate(`/rendez-vous${baseQuery()}`, { replace: true }));
      }
    } else {
      setEditingAppt(null);
      setCancelTarget(null);
    }
  }, [isCreateUrl, isEditUrl, isCancelUrl, urlApptId, queryPatientId, appointments, loading, patients, doctors]);

  useLiveSync(['appointment', 'queue', 'patient'], () => {
    loadAppointments(true);
  });

  const shiftPeriod = (dir: -1 | 1) => {
    if (viewMode === 'day') setAnchorDate(addDays(anchorDate, dir));
    else if (viewMode === 'week') setAnchorDate(addDays(anchorDate, dir * 7));
    else {
      const [y, m] = anchorDate.split('-').map(Number);
      const next = new Date(y, m - 1 + dir, 1);
      setAnchorDate(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`);
    }
  };

  const openCreate = (presetDate?: string) => {
    navigate(
      `/rendez-vous/nouveau${buildQuerySuffix({
        vue: viewMode === 'week' ? undefined : viewMode,
        date: presetDate || (anchorDate === todayIso ? undefined : anchorDate),
      })}`
    );
  };

  const openEdit = (appt: Appointment) => {
    navigate(`/rendez-vous/${encodeURIComponent(appt._id)}/modifier${baseQuery()}`);
  };

  const closeFormModal = () => {
    navigate(`/rendez-vous${baseQuery()}`);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingAppt) {
        await apiFetch(`/api/appointments/${editingAppt._id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            doctorId: form.doctorId,
            date: form.date,
            startTime: form.startTime,
            endTime: form.endTime,
            type: form.type,
            reason: form.reason,
            adminPriority: form.adminPriority,
            notes: form.notes,
          }),
        });
        notify('success', 'Rendez-vous mis à jour.');
      } else {
        await apiFetch('/api/appointments', {
          method: 'POST',
          body: JSON.stringify(form),
        });
        notify('success', 'Rendez-vous programmé.');
      }
      await loadAppointments();
      closeFormModal();
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (appt: Appointment, status: AppointmentStatus) => {
    try {
      await apiFetch(`/api/appointments/${appt._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      notify('success', `Statut mis à jour : ${APPOINTMENT_STATUS_LABELS[status]}`);
      await loadAppointments();
    } catch (err: any) {
      notify('error', err.message);
    }
  };

  const validateUrgency = async (appt: Appointment) => {
    try {
      await apiFetch(`/api/appointments/${appt._id}/validate-urgency`, { method: 'POST' });
      notify('success', 'Urgence validée médicalement.');
      await loadAppointments();
    } catch (err: any) {
      notify('error', err.message);
    }
  };

  const handleCancel = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await apiFetch(`/api/appointments/${cancelTarget._id}`, { method: 'DELETE' });
      notify('success', 'Rendez-vous annulé.');
      await loadAppointments();
      navigate(`/rendez-vous${baseQuery()}`);
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setCancelling(false);
    }
  };

  const isApptMovable = (appt: Appointment) =>
    canWriteAppointments &&
    dragMode &&
    appt.status !== 'ANNULE' &&
    appt.status !== 'TERMINE' &&
    appt.status !== 'EN_CONSULTATION';

  const computeTargetTimes = (appt: Appointment, nextStartTime?: string) => {
    const startTime = nextStartTime || appt.startTime;
    const duration = Math.max(15, timeToMinutes(appt.endTime) - timeToMinutes(appt.startTime));
    const endTime = nextStartTime ? minutesToTime(timeToMinutes(startTime) + duration) : appt.endTime;
    return { startTime, endTime };
  };

  const handleDragStartAppt = (e: React.DragEvent, appt: Appointment) => {
    if (!isApptMovable(appt)) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', appt._id);
    setDraggedAppt(appt);
    setDropTargetKey(null);
    setDropCheckState(null);
  };

  const handleDragEndAppt = () => {
    setDraggedAppt(null);
    setDropTargetKey(null);
    setDropCheckState(null);
  };

  const handleDragOverSlot = (e: React.DragEvent, targetDate: string, nextStartTime?: string) => {
    if (!draggedAppt) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const { startTime, endTime } = computeTargetTimes(draggedAppt, nextStartTime);
    const key = `${targetDate}|${startTime}`;
    if (dropTargetKey === key) return;

    setDropTargetKey(key);
    // Immediate local conflict hint while live Supabase verification runs
    const localConflict = appointments.find(
      (a) =>
        a._id !== draggedAppt._id &&
        a.doctorId === draggedAppt.doctorId &&
        a.date === targetDate &&
        a.status !== 'ANNULE' &&
        a.status !== 'ABSENT' &&
        startTime < a.endTime &&
        endTime > a.startTime
    );

    setDropCheckState({
      key,
      available: !localConflict,
      checking: true,
      message: localConflict
        ? `Conflit avec ${localConflict.patientName} (${localConflict.startTime}–${localConflict.endTime})`
        : 'Vérification Supabase en cours...',
    });

    const qs = new URLSearchParams({
      doctorId: draggedAppt.doctorId,
      date: targetDate,
      startTime,
      endTime,
      excludeId: draggedAppt._id,
    });
    apiFetch<{
      available: boolean;
      conflictWith: { patientName?: string; startTime: string; endTime: string } | null;
    }>(`/api/appointments/check-availability?${qs.toString()}`)
      .then((res) => {
        setDropCheckState((prev) => {
          if (!prev || prev.key !== key) return prev;
          return {
            key,
            available: res.available,
            checking: false,
            message: res.available
              ? `Créneau libre (${startTime}–${endTime})`
              : `Conflit agenda : ${res.conflictWith?.patientName || 'Autre patient'} (${res.conflictWith?.startTime}–${res.conflictWith?.endTime})`,
          };
        });
      })
      .catch(() => {
        // Keep local hint if transient error
      });
  };

  const handleDropSlot = async (e: React.DragEvent, targetDate: string, nextStartTime?: string) => {
    e.preventDefault();
    const droppedId = e.dataTransfer.getData('text/plain');
    const appt = draggedAppt || (droppedId ? appointments.find((a) => a._id === droppedId) || null : null);
    handleDragEndAppt();
    if (!appt || !isApptMovable(appt)) return;

    const { startTime, endTime } = computeTargetTimes(appt, nextStartTime);
    if (appt.date === targetDate && appt.startTime === startTime && appt.endTime === endTime) {
      return;
    }

    setMovingApptId(appt._id);
    try {
      const qs = new URLSearchParams({
        doctorId: appt.doctorId,
        date: targetDate,
        startTime,
        endTime,
        excludeId: appt._id,
      });
      const check = await apiFetch<{
        available: boolean;
        conflictWith: { patientName?: string; startTime: string; endTime: string } | null;
      }>(`/api/appointments/check-availability?${qs.toString()}`);

      if (!check.available) {
        notify(
          'error',
          `Déplacement bloqué (conflit agenda) : ${check.conflictWith?.patientName || 'un patient'} occupe déjà ${check.conflictWith?.startTime}–${check.conflictWith?.endTime}.`
        );
        return;
      }

      await apiFetch(`/api/appointments/${appt._id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          date: targetDate,
          startTime,
          endTime,
        }),
      });
      notify(
        'success',
        `Rendez-vous de ${appt.patientName} déplacé au ${formatDateFr(targetDate)} (${startTime}–${endTime}).`
      );
      await loadAppointments(true);
    } catch (err: any) {
      notify('error', err.message || 'Impossible de déplacer ce créneau.');
    } finally {
      setMovingApptId(null);
    }
  };

  const filtered = appointments.filter((a) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (a.patientName || '').toLowerCase().includes(q) ||
      (a.patientNumber || '').toLowerCase().includes(q) ||
      a.reason.toLowerCase().includes(q)
    );
  });

  const unvalidatedUrgencies = filtered.filter(
    (a) => a.adminPriority === 'URGENCE_A_VALIDER' && !a.urgencyValidatedByHealthPro && a.status !== 'ANNULE'
  );

  const weekBounds = getWeekBounds(anchorDate);
  const monthBounds = getMonthBounds(anchorDate);

  return (
    <div className="space-y-5">
      {/* Unvalidated Urgency Alert Banner */}
      {unvalidatedUrgencies.length > 0 && (
        <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3 text-sm text-[#D71920] dark:text-red-300">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">
                {unvalidatedUrgencies.length} urgence(s) signalée(s) en attente de validation par un professionnel de santé
              </div>
              <div className="text-xs opacity-90">
                La priorité médicale doit être confirmée explicitement par le médecin.
              </div>
            </div>
          </div>
          {hasPerm(user, 'medical:write') && (
            <button
              type="button"
              onClick={() => validateUrgency(unvalidatedUrgencies[0])}
              className="px-3 py-1.5 rounded-lg bg-[#D71920] text-white text-xs font-medium whitespace-nowrap"
            >
              Valider {unvalidatedUrgencies[0].patientName}
            </button>
          )}
        </div>
      )}

      {/* Calendar Controls Bar */}
      <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            {([
              ['day', 'Jour'],
              ['week', 'Semaine'],
              ['month', 'Mois'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setViewMode(id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  viewMode === id
                    ? 'bg-white dark:bg-slate-900 text-[#073B70] dark:text-sky-300 shadow-xs'
                    : 'text-[#708197] hover:text-[#172B45] dark:hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => shiftPeriod(-1)}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
              aria-label="Période précédente"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setAnchorDate(new Date().toISOString().slice(0, 10))}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Aujourd'hui
            </button>
            <button
              type="button"
              onClick={() => shiftPeriod(1)}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
              aria-label="Période suivante"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="text-sm font-semibold px-2 flex items-center gap-1.5">
            <CalendarIcon className="w-4 h-4 text-[#1265A3]" />
            {viewMode === 'day' && formatDateFr(anchorDate)}
            {viewMode === 'week' && `${formatDateFr(weekBounds.start)} — ${formatDateFr(weekBounds.end)}`}
            {viewMode === 'month' &&
              new Date(anchorDate + 'T12:00:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filtrer patient / motif..."
            className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F4F7FB] dark:bg-slate-900"
          />
          <select
            value={doctorFilter}
            onChange={(e) => setDoctorFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
          >
            <option value="">Tous médecins</option>
            {doctors.map((d) => (
              <option key={d._id} value={d._id}>
                {d.title ? `${d.title} ` : ''}{d.firstName} {d.lastName}
              </option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
          >
            <option value="">Tous types</option>
            {Object.entries(APPOINTMENT_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
          >
            <option value="">Tous statuts</option>
            {Object.entries(APPOINTMENT_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          {canWriteAppointments && (
            <button
              type="button"
              onClick={() => setDragMode((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium whitespace-nowrap transition-colors ${
                dragMode
                  ? 'bg-[#EAF4FC] border-[#1265A3]/40 text-[#073B70] dark:bg-[#073B70]/40 dark:border-sky-700 dark:text-sky-200'
                  : 'border-slate-200 dark:border-slate-700 text-[#708197] hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
              title="Activer ou désactiver le déplacement par glisser-déposer avec contrôle de conflit Supabase"
            >
              <Move className="w-3.5 h-3.5" />
              {dragMode ? 'Glisser-déposer actif' : 'Glisser-déposer'}
            </button>
          )}
          {canWriteAppointments && (
            <button
              type="button"
              onClick={() => openCreate()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#073B70] hover:bg-[#1265A3] text-white text-xs font-medium whitespace-nowrap"
            >
              <CalendarPlus className="w-4 h-4" />
              Nouveau rendez-vous
            </button>
          )}
        </div>
      </div>

      {canWriteAppointments && dragMode && (
        <div className="px-4 py-2.5 rounded-xl bg-[#EAF4FC]/70 dark:bg-[#073B70]/25 border border-[#1265A3]/20 dark:border-sky-900 flex flex-wrap items-center justify-between gap-2 text-xs text-[#073B70] dark:text-sky-200">
          <div className="flex items-center gap-2">
            <GripVertical className="w-4 h-4 text-[#1265A3] shrink-0" />
            <span>
              {viewMode === 'day'
                ? 'Glissez un rendez-vous vers un créneau horaire (07h30–18h30) pour le reprogrammer avec vérification de conflit Supabase en temps réel.'
                : 'Glissez une carte rendez-vous vers un autre jour pour modifier sa date avec vérification de conflit Supabase en temps réel.'}
            </span>
          </div>
          {dropCheckState && (
            <span
              className={`px-2.5 py-1 rounded-md font-semibold ${
                dropCheckState.available
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                  : 'bg-red-100 text-[#D71920] dark:bg-red-950/70 dark:text-red-300'
              }`}
            >
              {dropCheckState.message}
            </span>
          )}
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={6} />
      ) : viewMode === 'month' ? (
        <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-[#708197] bg-slate-50 dark:bg-slate-900/60">
            {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((d) => (
              <div key={d} className="px-3 py-2 text-center">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 divide-x divide-y divide-slate-100 dark:divide-slate-800">
            {monthBounds.cells.map((c) => {
              const dayItems = filtered.filter((a) => a.date === c.date);
              const cellDropKey = draggedAppt ? `${c.date}|${draggedAppt.startTime}` : null;
              const isDropHover = Boolean(cellDropKey && dropTargetKey === cellDropKey);
              return (
                <div
                  key={c.date}
                  onDragOver={(e) => handleDragOverSlot(e, c.date)}
                  onDrop={(e) => handleDropSlot(e, c.date)}
                  className={`min-h-[104px] p-2 transition-colors ${
                    c.inMonth ? '' : 'bg-slate-50/70 dark:bg-slate-900/30 opacity-50'
                  } ${
                    isDropHover
                      ? dropCheckState?.available === false
                        ? 'bg-red-50/80 dark:bg-red-950/35 ring-2 ring-inset ring-[#D71920]'
                        : 'bg-emerald-50/80 dark:bg-emerald-950/35 ring-2 ring-inset ring-emerald-500'
                      : ''
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <button
                      type="button"
                      onClick={() => setAnchorDate(c.date, 'day')}
                      className="text-xs font-mono font-semibold hover:text-[#1265A3] tabular-nums"
                    >
                      {c.date.slice(8)}
                    </button>
                    {hasPerm(user, 'appointments:write') && (
                      <button
                        type="button"
                        onClick={() => openCreate(c.date)}
                        className="text-[11px] text-[#1265A3] hover:underline"
                      >
                        +
                      </button>
                    )}
                  </div>
                  <div className="space-y-1">
                    {dayItems.slice(0, 3).map((a) => {
                      const movable = isApptMovable(a);
                      return (
                        <button
                          key={a._id}
                          type="button"
                          draggable={movable}
                          onDragStart={(e) => handleDragStartAppt(e, a)}
                          onDragEnd={handleDragEndAppt}
                          onClick={() => openEdit(a)}
                          className={`w-full text-left px-1.5 py-1 rounded text-[11px] truncate border flex items-center gap-1 ${
                            movable ? 'cursor-grab active:cursor-grabbing' : ''
                          } ${movingApptId === a._id ? 'opacity-50' : ''} ${
                            a.adminPriority === 'URGENCE_A_VALIDER'
                              ? 'bg-red-50 border-red-200 text-[#D71920] dark:bg-red-950/50 dark:border-red-900'
                              : 'bg-[#EAF4FC] border-[#1265A3]/20 text-[#073B70] dark:bg-[#073B70]/40 dark:text-sky-200 dark:border-sky-800'
                          }`}
                        >
                          {movable && <GripVertical className="w-3 h-3 opacity-60 shrink-0" />}
                          <span className="truncate">
                            <span className="font-mono">{a.startTime}</span> {a.patientName}
                          </span>
                        </button>
                      );
                    })}
                    {dayItems.length > 3 && (
                      <div className="text-[10px] text-[#708197] pl-1">+{dayItems.length - 3} autre(s)</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : viewMode === 'week' ? (
        <div className="bg-white dark:bg-[#131E30] border border-slate-200/90 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="grid grid-cols-1 md:grid-cols-7 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-800">
            {weekBounds.days.map((dayIso) => {
              const dayItems = filtered
                .filter((a) => a.date === dayIso)
                .sort((a, b) => a.startTime.localeCompare(b.startTime));
              const isToday = dayIso === new Date().toISOString().slice(0, 10);
              const dayHeader = new Date(dayIso + 'T12:00:00').toLocaleDateString('fr-FR', {
                weekday: 'short',
                day: '2-digit',
                month: 'short',
              });
              const dayDropKey = draggedAppt ? `${dayIso}|${draggedAppt.startTime}` : null;
              const isDayDropHover = Boolean(dayDropKey && dropTargetKey === dayDropKey);
              return (
                <div
                  key={dayIso}
                  onDragOver={(e) => handleDragOverSlot(e, dayIso)}
                  onDrop={(e) => handleDropSlot(e, dayIso)}
                  className={`min-h-[260px] flex flex-col transition-colors ${
                    isDayDropHover
                      ? dropCheckState?.available === false
                        ? 'bg-red-50/70 dark:bg-red-950/30 ring-2 ring-inset ring-[#D71920]'
                        : 'bg-emerald-50/70 dark:bg-emerald-950/30 ring-2 ring-inset ring-emerald-500'
                      : ''
                  }`}
                >
                  <div
                    className={`px-3 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between ${
                      isToday ? 'bg-[#EAF4FC] dark:bg-[#073B70]/40' : 'bg-[#F8FBFE] dark:bg-slate-900/60'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setAnchorDate(dayIso, 'day')}
                      className={`text-xs font-semibold capitalize hover:underline ${
                        isToday ? 'text-[#073B70] dark:text-sky-200' : 'text-[#172B45] dark:text-slate-200'
                      }`}
                    >
                      {dayHeader}
                    </button>
                    {hasPerm(user, 'appointments:write') && (
                      <button
                        type="button"
                        onClick={() => openCreate(dayIso)}
                        className="text-xs font-bold text-[#1265A3] dark:text-sky-400 hover:underline px-1"
                        title="Planifier sur ce jour"
                      >
                        +
                      </button>
                    )}
                  </div>
                  <div className="p-2 space-y-2 flex-1">
                    {dayItems.length === 0 ? (
                      <div className="text-[11px] text-[#708197] text-center py-6">
                        {isDayDropHover ? 'Déposer ici' : 'Aucun RDV'}
                      </div>
                    ) : (
                      dayItems.map((a) => {
                        const movable = isApptMovable(a);
                        return (
                          <button
                            key={a._id}
                            type="button"
                            draggable={movable}
                            onDragStart={(e) => handleDragStartAppt(e, a)}
                            onDragEnd={handleDragEndAppt}
                            onClick={() => openEdit(a)}
                            className={`w-full text-left p-2 rounded-lg border text-xs space-y-1 transition-opacity ${
                              movable ? 'cursor-grab active:cursor-grabbing' : ''
                            } ${
                              draggedAppt?._id === a._id || movingApptId === a._id ? 'opacity-50' : ''
                            } ${
                              a.status === 'ANNULE'
                                ? 'bg-slate-50 border-slate-200 text-slate-400 line-through dark:bg-slate-900/40 dark:border-slate-800'
                                : a.adminPriority === 'URGENCE_A_VALIDER'
                                ? 'bg-red-50 border-red-200 text-[#D71920] dark:bg-red-950/50 dark:border-red-900 dark:text-red-300'
                                : 'bg-[#F3F7FB] border-slate-200 hover:border-[#1265A3] dark:bg-slate-900/70 dark:border-slate-700'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1 font-mono text-[11px] font-semibold">
                              <span>{a.startTime} - {a.endTime}</span>
                              {movable && <GripVertical className="w-3.5 h-3.5 text-[#708197] shrink-0" />}
                            </div>
                            <div className="font-semibold text-[#172B45] dark:text-white truncate">
                              {a.patientName}
                            </div>
                            <div className="text-[11px] text-[#708197] truncate">
                              {APPOINTMENT_TYPE_LABELS[a.type]}
                            </div>
                            <AppointmentStatusBadge status={a.status} />
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {canWriteAppointments && dragMode && (
            <div className="bg-white dark:bg-[#131E30] border border-slate-200/90 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-[#F8FBFE] dark:bg-[#0F1827] border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-[#073B70] dark:text-sky-200 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[#1265A3]" />
                  Planning horaire interactif du {formatDateFr(anchorDate)} (créneaux de 30 min)
                </div>
                <span className="text-[11px] text-[#708197]">
                  Glissez-déposez un rendez-vous sur un autre créneau horaire
                </span>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[420px] overflow-y-auto">
                {DAY_TIME_SLOTS.map((slot) => {
                  const slotEnd = minutesToTime(timeToMinutes(slot) + 30);
                  const slotAppts = filtered.filter(
                    (a) => a.date === anchorDate && a.startTime >= slot && a.startTime < slotEnd
                  );
                  const slotDropKey = `${anchorDate}|${slot}`;
                  const isHover = dropTargetKey === slotDropKey;
                  return (
                    <div
                      key={slot}
                      onDragOver={(e) => handleDragOverSlot(e, anchorDate, slot)}
                      onDrop={(e) => handleDropSlot(e, anchorDate, slot)}
                      className={`px-4 py-2 flex flex-col sm:flex-row sm:items-center gap-2.5 min-h-[46px] transition-colors ${
                        isHover
                          ? dropCheckState?.available === false
                            ? 'bg-red-50/80 dark:bg-red-950/35 ring-1 ring-inset ring-[#D71920]'
                            : 'bg-emerald-50/80 dark:bg-emerald-950/35 ring-1 ring-inset ring-emerald-500'
                          : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/20'
                      }`}
                    >
                      <div className="w-24 shrink-0 font-mono text-xs font-semibold text-[#708197] tabular-nums">
                        {slot} – {slotEnd}
                      </div>
                      <div className="flex-1 flex flex-wrap items-center gap-2">
                        {slotAppts.length === 0 ? (
                          <span className="text-[11px] text-slate-400 dark:text-slate-600">
                            {isHover ? (dropCheckState?.message || 'Déposer sur ce créneau') : 'Créneau disponible'}
                          </span>
                        ) : (
                          slotAppts.map((a) => {
                            const movable = isApptMovable(a);
                            return (
                              <div
                                key={a._id}
                                draggable={movable}
                                onDragStart={(e) => handleDragStartAppt(e, a)}
                                onDragEnd={handleDragEndAppt}
                                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs ${
                                  movable ? 'cursor-grab active:cursor-grabbing' : ''
                                } ${
                                  draggedAppt?._id === a._id || movingApptId === a._id ? 'opacity-50' : ''
                                } ${
                                  a.status === 'ANNULE'
                                    ? 'bg-slate-50 border-slate-200 text-slate-400 line-through dark:bg-slate-900/40 dark:border-slate-800'
                                    : 'bg-[#F3F7FB] border-slate-200 dark:bg-slate-900/70 dark:border-slate-700'
                                }`}
                              >
                                {movable && <GripVertical className="w-3.5 h-3.5 text-[#708197] shrink-0" />}
                                <span className="font-mono font-semibold text-[#073B70] dark:text-sky-300">
                                  {a.startTime}–{a.endTime}
                                </span>
                                <span className="font-semibold text-[#172B45] dark:text-white">
                                  {a.patientName}
                                </span>
                                <span className="text-[#708197] hidden md:inline">
                                  · {a.doctorName}
                                </span>
                                <AppointmentStatusBadge status={a.status} />
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {filtered.length === 0 ? (
            <EmptyState
              title="Aucun rendez-vous sur cette période"
              description="Planifiez une consultation ou une exploration cardiologique sans risque de double réservation."
              actionLabel={hasPerm(user, 'appointments:write') ? 'Nouveau rendez-vous' : undefined}
              onAction={hasPerm(user, 'appointments:write') ? () => openCreate() : undefined}
            />
          ) : (
        <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-xs text-[#708197] border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3 font-medium">Date & Horaire</th>
                  <th className="px-4 py-3 font-medium">Patient</th>
                  <th className="px-4 py-3 font-medium">Type & Motif</th>
                  <th className="px-4 py-3 font-medium">Médecin</th>
                  <th className="px-4 py-3 font-medium">Priorité / Statut</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filtered.map((a) => (
                  <tr key={a._id} className="hover:bg-[#EAF4FC]/30 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-mono text-xs tabular-nums whitespace-nowrap">
                      <div className="font-semibold text-[#172B45] dark:text-slate-100">
                        {formatDateFr(a.date)}
                      </div>
                      <div className="text-[#708197] flex items-center gap-1 mt-0.5">
                        <Clock className="w-3 h-3" /> {a.startTime} - {a.endTime}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[#172B45] dark:text-white">{a.patientName}</div>
                      <div className="text-xs font-mono text-[#708197]">{a.patientNumber}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs font-semibold text-[#073B70] dark:text-sky-300">
                        {APPOINTMENT_TYPE_LABELS[a.type]}
                      </div>
                      <div className="text-xs text-[#708197] truncate max-w-xs">{a.reason}</div>
                    </td>
                    <td className="px-4 py-3 text-xs">{a.doctorName}</td>
                    <td className="px-4 py-3 space-y-1">
                      <div>
                        <AppointmentStatusBadge status={a.status} />
                      </div>
                      {a.adminPriority === 'URGENCE_A_VALIDER' && (
                        <div>
                          <StatusBadge
                            label={a.urgencyValidatedByHealthPro ? 'Urgence validée' : 'Urgence à valider'}
                            tone={a.urgencyValidatedByHealthPro ? 'warning' : 'danger'}
                          />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap space-x-1.5">
                      {a.adminPriority === 'URGENCE_A_VALIDER' &&
                        !a.urgencyValidatedByHealthPro &&
                        hasPerm(user, 'medical:write') && (
                          <button
                            type="button"
                            onClick={() => validateUrgency(a)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#D71920] text-white text-xs font-medium"
                          >
                            <ShieldCheck className="w-3.5 h-3.5" /> Valider urgence
                          </button>
                        )}
                      {hasPerm(user, 'appointments:write') && a.status === 'EN_ATTENTE' && (
                        <button
                          type="button"
                          onClick={() => updateStatus(a, 'CONFIRME')}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50 text-xs font-medium"
                        >
                          <Check className="w-3.5 h-3.5" /> Confirmer
                        </button>
                      )}
                      {hasPerm(user, 'appointments:write') && a.status !== 'TERMINE' && a.status !== 'ANNULE' && (
                        <>
                          <button
                            type="button"
                            onClick={() => openEdit(a)}
                            className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs hover:bg-slate-50 dark:hover:bg-slate-800"
                          >
                            Reporter / Modifier
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              navigate(`/rendez-vous/${encodeURIComponent(a._id)}/annuler${baseQuery()}`)
                            }
                            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-[#D71920] hover:bg-red-50"
                            title="Annuler le rendez-vous"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
          )}
        </div>
      )}

      <Modal
        open={isCreateUrl || Boolean(isEditUrl && editingAppt)}
        onClose={closeFormModal}
        title={editingAppt ? 'Modifier / Reporter le rendez-vous' : 'Nouveau rendez-vous'}
        subtitle="Vérification automatique des disponibilités du médecin."
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {!editingAppt && (
              <div>
                <label className="block text-xs font-medium mb-1">Patient *</label>
                <select
                  required
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
            )}
            <div>
              <label className="block text-xs font-medium mb-1">Médecin *</label>
              <select
                required
                value={form.doctorId}
                onChange={(e) => setForm({ ...form, doctorId: e.target.value })}
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
              <label className="block text-xs font-medium mb-1">Type de rendez-vous *</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as AppointmentType })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              >
                {Object.entries(APPOINTMENT_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Priorité administrative</label>
              <select
                value={form.adminPriority}
                onChange={(e) => setForm({ ...form, adminPriority: e.target.value as any })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              >
                <option value="NORMALE">Normale</option>
                <option value="PRIORITAIRE">Prioritaire</option>
                <option value="URGENCE_A_VALIDER">Urgence (alerte & validation médicale)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
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
              <label className="block text-xs font-medium mb-1">Début *</label>
              <input
                type="time"
                required
                value={form.startTime}
                onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Fin *</label>
              <input
                type="time"
                required
                value={form.endTime}
                onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Motif du rendez-vous *</label>
            <input
              type="text"
              required
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="ex. Douleurs thoraciques, contrôle HTA..."
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>

          {(form.type === 'CONSULTATION_URGENTE' || form.adminPriority === 'URGENCE_A_VALIDER') && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-[#D71920] dark:text-red-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              Une alerte sera déclenchée pour validation par un professionnel de santé.
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={closeFormModal}
              className="px-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm rounded-lg bg-[#073B70] text-white font-medium disabled:opacity-50"
            >
              {saving ? 'Vérification...' : editingAppt ? 'Enregistrer' : 'Planifier le RDV'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        open={Boolean(isCancelUrl && cancelTarget)}
        title="Annuler ce rendez-vous ?"
        message={`Confirmez l'annulation du rendez-vous de ${cancelTarget?.patientName} le ${formatDateFr(cancelTarget?.date)} à ${cancelTarget?.startTime}.`}
        confirmLabel="Annuler le rendez-vous"
        danger
        loading={cancelling}
        onConfirm={handleCancel}
        onCancel={closeFormModal}
      />
    </div>
  );
};
