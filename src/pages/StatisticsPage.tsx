import React, { useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { EmptyState, StatCard, TableSkeleton } from '../components/UIPrimitives';
import type { PublicUser } from '../shared/types';
import { apiFetch, formatDateFr, formatFcfa, hasPerm } from '../lib/api';
import { buildQuerySuffix, navigate, useAppRoute } from '../lib/router';
import { useLiveSync } from '../lib/useLiveSync';

interface StatsPayload {
  range: { period: string; startDate: string; endDate: string };
  summary: {
    totalPatients: number;
    newPatients: number;
    consultationsCount: number;
    appointmentsCount: number;
    examsCount: number;
    absenceRate: number;
    followUpsCompleted: number;
    followUpsOverdue: number;
    paymentsCount: number;
    revenueFcfa: number;
  };
  charts: {
    examsByCategory: Array<{ name: string; value: number }>;
    revenueByDate: Array<{ date: string; amount: number }>;
    activityByDate: Array<{ date: string; consultations: number; appointments: number }>;
  };
}

type StatsPeriod = 'today' | 'week' | 'month' | 'year' | 'custom';

export const StatisticsPage: React.FC<{
  user: PublicUser;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
}> = ({ user, notify }) => {
  const route = useAppRoute();
  const todayIso = new Date().toISOString().slice(0, 10);
  const rawPeriod = route.query.get('periode');
  const period: StatsPeriod =
    rawPeriod === 'today' || rawPeriod === 'week' || rawPeriod === 'month' || rawPeriod === 'year' || rawPeriod === 'custom'
      ? rawPeriod
      : 'month';
  const startDate = route.query.get('debut') || '';
  const endDate = route.query.get('fin') || todayIso;

  const [data, setData] = useState<StatsPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const setStatsParams = (nextPeriod: StatsPeriod, nextStart = startDate, nextEnd = endDate) => {
    navigate(
      `/statistiques${buildQuerySuffix({
        periode: nextPeriod === 'month' ? undefined : nextPeriod,
        debut: nextPeriod === 'custom' ? nextStart || undefined : undefined,
        fin: nextPeriod === 'custom' && nextEnd !== todayIso ? nextEnd : undefined,
      })}`
    );
  };

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const qs = new URLSearchParams({ period });
      if (period === 'custom' && startDate && endDate) {
        qs.set('startDate', startDate);
        qs.set('endDate', endDate);
      }
      const res = await apiFetch<StatsPayload>(`/api/statistics?${qs.toString()}`);
      setData(res);
    } catch (err: any) {
      if (!silent) notify('error', err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (period !== 'custom' || (startDate && endDate)) {
      load();
    }
  }, [period, startDate, endDate]);

  useLiveSync(
    ['patient', 'appointment', 'consultation', 'examination', 'followup', 'payment', 'service'],
    () => {
      if (period !== 'custom' || (startDate && endDate)) {
        load(true);
      }
    }
  );

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
          {([
            ['today', "Aujourd'hui"],
            ['week', 'Cette semaine'],
            ['month', 'Ce mois'],
            ['year', 'Cette année'],
            ['custom', 'Période personnalisée'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setStatsParams(id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                period === id ? 'bg-white dark:bg-slate-900 text-[#073B70] dark:text-sky-300 shadow-xs' : 'text-[#708197]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {period === 'custom' && (
          <div className="flex items-center gap-2 text-xs">
            <input type="date" value={startDate} onChange={(e) => setStatsParams('custom', e.target.value, endDate)} className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" />
            <span>au</span>
            <input type="date" value={endDate} onChange={(e) => setStatsParams('custom', startDate, e.target.value)} className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" />
          </div>
        )}
      </div>

      {loading ? (
        <TableSkeleton rows={5} />
      ) : !data ? (
        <EmptyState title="Statistiques indisponibles" description="Réessayez ultérieurement." />
      ) : (
        <>
          <div className="text-xs text-[#708197]">
            Période analysée : {formatDateFr(data.range.startDate)} au {formatDateFr(data.range.endDate)}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <StatCard label="Patients enregistrés" value={data.summary.totalPatients} subtext={`+${data.summary.newPatients} nouveaux`} tone="primary" />
            <StatCard label="Consultations" value={data.summary.consultationsCount} />
            <StatCard label="Rendez-vous / Absence" value={data.summary.appointmentsCount} subtext={`Taux d'absence : ${data.summary.absenceRate}%`} />
            <StatCard label="Examens / Suivis" value={data.summary.examsCount} subtext={`${data.summary.followUpsCompleted} suivis clos · ${data.summary.followUpsOverdue} retard`} />
            {hasPerm(user, 'statistics:read_admin') && (
              <StatCard label="Recettes période" value={formatFcfa(data.summary.revenueFcfa)} subtext={`${data.summary.paymentsCount} paiements`} tone="success" />
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold mb-4">Consultations & Rendez-vous par date</h2>
              {data.charts.activityByDate.length === 0 ? (
                <div className="h-60 flex items-center justify-center text-xs text-[#708197]">
                  Aucune activité sur cette période.
                </div>
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.charts.activityByDate} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#708197' }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#708197' }} />
                      <Tooltip contentStyle={{ borderRadius: '8px', fontSize: '12px' }} />
                      <Area type="monotone" dataKey="appointments" name="Rendez-vous" stroke="#1265A3" fill="#EAF4FC" />
                      <Area type="monotone" dataKey="consultations" name="Consultations" stroke="#073B70" fill="#073B70" fillOpacity={0.18} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold mb-4">Examens cardiologiques par catégorie</h2>
              {data.charts.examsByCategory.length === 0 ? (
                <div className="h-60 flex items-center justify-center text-xs text-[#708197]">
                  Aucun examen prescrit sur cette période.
                </div>
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.charts.examsByCategory} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#708197' }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#708197' }} />
                      <Tooltip contentStyle={{ borderRadius: '8px', fontSize: '12px' }} />
                      <Bar dataKey="value" name="Examens" fill="#073B70" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
