import React, { useEffect } from 'react';
import {
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Hourglass,
  Info,
  Stethoscope,
  UserCheck,
  UserX,
  X,
  XCircle,
} from 'lucide-react';
import type { AppointmentStatus } from '../shared/types';
import { APPOINTMENT_STATUS_LABELS } from '../shared/constants';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  text: string;
}

export const ToastContainer: React.FC<{
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}> = ({ toasts, onDismiss }) => {
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto flex items-start gap-3 px-4 py-3.5 rounded-xl border shadow-lg text-sm bg-white dark:bg-[#131E30] ${
            t.type === 'success'
              ? 'border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
              : t.type === 'error'
              ? 'border-[#D71920]/35 dark:border-[#D71920]/50 text-[#D71920] dark:text-red-300'
              : 'border-slate-200 dark:border-slate-700 text-[#172B45] dark:text-slate-100'
          }`}
        >
          {t.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" />
          ) : t.type === 'error' ? (
            <XCircle className="w-4 h-4 mt-0.5 text-[#D71920] shrink-0" />
          ) : (
            <Info className="w-4 h-4 mt-0.5 text-[#1265A3] shrink-0" />
          )}
          <span className="flex-1 leading-snug font-medium">{t.text}</span>
          <button
            type="button"
            onClick={() => onDismiss(t.id)}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            aria-label="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};

export type StatusTone = 'neutral' | 'info' | 'active' | 'success' | 'warning' | 'danger';

export const StatusBadge: React.FC<{
  label: string;
  tone?: StatusTone;
  icon?: React.ReactNode;
}> = ({ label, tone = 'neutral', icon }) => {
  const styles: Record<StatusTone, string> = {
    neutral:
      'bg-slate-100 text-slate-700 border-slate-200/90 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    info: 'bg-[#EAF4FC] text-[#073B70] border-[#1265A3]/25 dark:bg-[#073B70]/40 dark:text-sky-200 dark:border-sky-800',
    active:
      'bg-[#073B70] text-white border-[#073B70] shadow-xs dark:bg-[#1265A3] dark:text-white dark:border-sky-500',
    success:
      'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800',
    warning:
      'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800',
    danger:
      'bg-red-50 text-[#D71920] border-red-200 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-semibold border whitespace-nowrap shrink-0 ${styles[tone]}`}
    >
      {icon && <span className="inline-flex shrink-0">{icon}</span>}
      {label}
    </span>
  );
};

export const AppointmentStatusBadge: React.FC<{ status: AppointmentStatus }> = ({ status }) => {
  const config: Record<AppointmentStatus, { tone: StatusTone; icon: React.ReactNode }> = {
    EN_ATTENTE: {
      tone: 'neutral',
      icon: <Clock className="w-3.5 h-3.5" />,
    },
    CONFIRME: {
      tone: 'info',
      icon: <CalendarCheck className="w-3.5 h-3.5" />,
    },
    PATIENT_ARRIVE: {
      tone: 'warning',
      icon: <UserCheck className="w-3.5 h-3.5" />,
    },
    EN_ATTENTE_CONSULTATION: {
      tone: 'warning',
      icon: <Hourglass className="w-3.5 h-3.5" />,
    },
    EN_CONSULTATION: {
      tone: 'active',
      icon: <Stethoscope className="w-3.5 h-3.5" />,
    },
    TERMINE: {
      tone: 'success',
      icon: <CheckCircle2 className="w-3.5 h-3.5" />,
    },
    ANNULE: {
      tone: 'danger',
      icon: <XCircle className="w-3.5 h-3.5" />,
    },
    ABSENT: {
      tone: 'danger',
      icon: <UserX className="w-3.5 h-3.5" />,
    },
  };

  const entry = config[status] || config.EN_ATTENTE;
  return (
    <StatusBadge
      label={APPOINTMENT_STATUS_LABELS[status] || status}
      tone={entry.tone}
      icon={entry.icon}
    />
  );
};

export const AlertBeacon: React.FC<{ tone?: 'danger' | 'warning'; title?: string }> = ({
  tone = 'danger',
  title,
}) => (
  <span className="relative inline-flex h-2.5 w-2.5 shrink-0" title={title}>
    <span
      className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
        tone === 'warning' ? 'bg-amber-500' : 'bg-[#D71920]'
      }`}
    />
    <span
      className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
        tone === 'warning' ? 'bg-amber-600' : 'bg-[#D71920]'
      }`}
    />
  </span>
);

export const StatCard: React.FC<{
  label: string;
  value: string | number;
  subtext?: string;
  tone?: 'default' | 'primary' | 'danger' | 'warning' | 'success';
  icon?: React.ReactNode;
  alertPulse?: boolean;
  onClick?: () => void;
}> = ({ label, value, subtext, tone = 'default', icon, alertPulse = false, onClick }) => {
  const accentText =
    tone === 'danger'
      ? 'text-[#D71920] dark:text-red-400'
      : tone === 'warning'
      ? 'text-amber-700 dark:text-amber-400'
      : tone === 'success'
      ? 'text-emerald-700 dark:text-emerald-400'
      : tone === 'primary'
      ? 'text-[#073B70] dark:text-sky-300'
      : 'text-[#172B45] dark:text-slate-100';

  const iconBg =
    tone === 'danger'
      ? 'bg-red-50 text-[#D71920] dark:bg-red-950/50 dark:text-red-300'
      : tone === 'warning'
      ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
      : tone === 'success'
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
      : 'bg-[#EAF4FC] text-[#073B70] dark:bg-[#073B70]/40 dark:text-sky-300';

  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`text-left w-full bg-white dark:bg-[#131E30] border rounded-xl p-4.5 transition-colors ${
        alertPulse
          ? tone === 'warning'
            ? 'border-amber-300 dark:border-amber-700 ring-1 ring-amber-400/30'
            : 'border-red-300 dark:border-red-800 ring-1 ring-[#D71920]/25'
          : 'border-slate-200/90 dark:border-slate-800'
      } ${
        onClick ? 'hover:border-[#1265A3]/60 hover:bg-[#F8FBFE] dark:hover:bg-[#162338] cursor-pointer' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {alertPulse && <AlertBeacon tone={tone === 'warning' ? 'warning' : 'danger'} />}
          <div className="text-xs font-medium text-[#708197] dark:text-slate-400 truncate">{label}</div>
        </div>
        {icon && (
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>
            {icon}
          </div>
        )}
      </div>
      <div className={`mt-2 text-2xl font-bold tracking-tight tabular-nums font-display ${accentText}`}>
        {value}
      </div>
      {subtext && (
        <div className="mt-1.5 text-xs text-[#708197] dark:text-slate-400 truncate">{subtext}</div>
      )}
    </Tag>
  );
};

export const Modal: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  maxWidth?: string;
  children: React.ReactNode;
}> = ({ open, onClose, title, subtitle, maxWidth = 'max-w-2xl', children }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/55 backdrop-blur-[2px]">
      <div
        className={`w-full ${maxWidth} max-h-[90vh] flex flex-col bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl overflow-hidden`}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-4 bg-[#F8FBFE] dark:bg-[#0F1827] border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-base font-bold text-[#073B70] dark:text-white font-display">{title}</h2>
            {subtitle && (
              <p className="text-xs text-[#708197] dark:text-slate-400 mt-0.5">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800"
            aria-label="Fermer la fenêtre"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
};

export const ConfirmModal: React.FC<{
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({
  open,
  title,
  message,
  confirmLabel = 'Confirmer',
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}) => (
  <Modal open={open} onClose={onCancel} title={title} maxWidth="max-w-md">
    <div className="flex items-start gap-3">
      <div
        className={`p-2.5 rounded-lg shrink-0 ${
          danger ? 'bg-red-50 text-[#D71920] dark:bg-red-950/50' : 'bg-[#EAF4FC] text-[#073B70]'
        }`}
      >
        <AlertTriangle className="w-5 h-5" />
      </div>
      <p className="text-sm text-[#172B45] dark:text-slate-200 leading-relaxed">{message}</p>
    </div>
    <div className="mt-6 flex items-center justify-end gap-3">
      <button
        type="button"
        onClick={onCancel}
        disabled={loading}
        className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-[#172B45] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
      >
        Annuler
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={loading}
        className={`px-4 py-2 text-sm font-medium rounded-lg text-white ${
          danger ? 'bg-[#D71920] hover:bg-red-700' : 'bg-[#073B70] hover:bg-[#1265A3]'
        } disabled:opacity-50`}
      >
        {loading ? 'Traitement...' : confirmLabel}
      </button>
    </div>
  </Modal>
);

export const EmptyState: React.FC<{
  title: string;
  description: string;
  icon?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}> = ({ title, description, icon, actionLabel, onAction }) => (
  <div className="border border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-10 text-center bg-white/80 dark:bg-[#131E30]/70">
    {icon && (
      <div className="w-11 h-11 rounded-xl bg-[#EAF4FC] dark:bg-[#073B70]/40 text-[#073B70] dark:text-sky-300 flex items-center justify-center mx-auto mb-3">
        {icon}
      </div>
    )}
    <h3 className="text-base font-semibold text-[#172B45] dark:text-slate-100">{title}</h3>
    <p className="mt-1.5 text-sm text-[#708197] dark:text-slate-400 max-w-md mx-auto leading-relaxed">
      {description}
    </p>
    {actionLabel && onAction && (
      <button
        type="button"
        onClick={onAction}
        className="mt-4 px-4 py-2 text-sm font-medium rounded-lg bg-[#073B70] hover:bg-[#1265A3] text-white"
      >
        {actionLabel}
      </button>
    )}
  </div>
);

export const TableSkeleton: React.FC<{ rows?: number }> = ({ rows = 5 }) => (
  <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
    <div className="divide-y divide-slate-100 dark:divide-slate-800">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-5 py-4 flex items-center gap-4 animate-pulse">
          <div className="h-4 w-24 bg-slate-200 dark:bg-slate-700 rounded" />
          <div className="h-4 w-48 bg-slate-200 dark:bg-slate-700 rounded" />
          <div className="h-4 w-28 bg-slate-100 dark:bg-slate-800 rounded ml-auto" />
        </div>
      ))}
    </div>
  </div>
);
