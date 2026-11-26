import React, { useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  Bell,
  Calendar,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  FileText,
  FolderHeart,
  HeartPulse,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Search,
  Settings,
  Stethoscope,
  Sun,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { ClinicLogo } from './ClinicLogo';
import { ROLE_LABELS } from '../shared/constants';
import type { NotificationItem, Patient, PublicUser } from '../shared/types';
import { apiFetch, formatDateTimeFr, hasAnyPerm, hasPerm, isRoleOnly } from '../lib/api';
import { useLiveSync } from '../lib/useLiveSync';

export type NavModuleId =
  | 'dashboard'
  | 'patients'
  | 'appointments'
  | 'queue'
  | 'consultations'
  | 'examinations'
  | 'follow-ups'
  | 'tasks'
  | 'documents'
  | 'finance'
  | 'statistics'
  | 'admin'
  | 'patient-portal';

type NavGroup = 'PILOTAGE' | 'CLINIQUE' | 'COORDINATION' | 'ADMINISTRATION';

interface NavItem {
  id: NavModuleId;
  label: string;
  group: NavGroup;
  icon: React.FC<{ className?: string }>;
  visible: (user: PublicUser) => boolean;
}

const GROUP_LABELS: Record<NavGroup, string> = {
  PILOTAGE: 'Pilotage',
  CLINIQUE: 'Parcours & Clinique',
  COORDINATION: 'Suivi & Coordination',
  ADMINISTRATION: 'Gestion & Audit',
};

const NAV_ITEMS: NavItem[] = [
  {
    id: 'dashboard',
    label: 'Tableau de bord',
    group: 'PILOTAGE',
    icon: LayoutDashboard,
    visible: (u) => !isRoleOnly(u, 'PATIENT'),
  },
  {
    id: 'patient-portal',
    label: 'Mon espace patient',
    group: 'PILOTAGE',
    icon: UserCheck,
    visible: (u) => u.roles.includes('PATIENT'),
  },
  {
    id: 'queue',
    label: "File d'attente",
    group: 'CLINIQUE',
    icon: Clock,
    visible: (u) => hasAnyPerm(u, ['queue:manage', 'appointments:read']),
  },
  {
    id: 'appointments',
    label: 'Rendez-vous',
    group: 'CLINIQUE',
    icon: Calendar,
    visible: (u) => hasPerm(u, 'appointments:read'),
  },
  {
    id: 'patients',
    label: 'Patients & Dossiers',
    group: 'CLINIQUE',
    icon: Users,
    visible: (u) => hasPerm(u, 'patients:read_admin'),
  },
  {
    id: 'consultations',
    label: 'Consultations',
    group: 'CLINIQUE',
    icon: Stethoscope,
    visible: (u) => hasPerm(u, 'consultations:read'),
  },
  {
    id: 'examinations',
    label: 'Examens cardio',
    group: 'CLINIQUE',
    icon: HeartPulse,
    visible: (u) => hasPerm(u, 'examinations:read'),
  },
  {
    id: 'follow-ups',
    label: 'Suivi des patients',
    group: 'COORDINATION',
    icon: Activity,
    visible: (u) => hasPerm(u, 'followups:read'),
  },
  {
    id: 'tasks',
    label: 'Tâches internes',
    group: 'COORDINATION',
    icon: CheckSquare,
    visible: (u) => hasPerm(u, 'tasks:read'),
  },
  {
    id: 'documents',
    label: 'Documents',
    group: 'COORDINATION',
    icon: FileText,
    visible: (u) => hasAnyPerm(u, ['documents:read_admin', 'documents:read_medical']),
  },
  {
    id: 'finance',
    label: 'Prestations & Paiements',
    group: 'ADMINISTRATION',
    icon: CreditCard,
    visible: (u) => hasAnyPerm(u, ['payments:read', 'services:manage']),
  },
  {
    id: 'statistics',
    label: 'Statistiques',
    group: 'ADMINISTRATION',
    icon: BarChart3,
    visible: (u) => hasAnyPerm(u, ['statistics:read_medical', 'statistics:read_admin']),
  },
  {
    id: 'admin',
    label: 'Administration',
    group: 'ADMINISTRATION',
    icon: Settings,
    visible: (u) => hasAnyPerm(u, ['users:manage', 'settings:manage', 'audit:read']),
  },
];

interface LayoutShellProps {
  user: PublicUser;
  activeModule: NavModuleId;
  onNavigate: (module: NavModuleId, selectedPatientId?: string) => void;
  onLogout: () => void;
  darkMode: boolean;
  onToggleDark: () => void;
  logoRefreshKey: number;
  children: React.ReactNode;
}

export const LayoutShell: React.FC<LayoutShellProps> = ({
  user,
  activeModule,
  onNavigate,
  onLogout,
  darkMode,
  onToggleDark,
  logoRefreshKey,
  children,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Patient[]>([]);
  const [searching, setSearching] = useState(false);

  const visibleItems = NAV_ITEMS.filter((i) => i.visible(user));
  const activeItem = visibleItems.find((i) => i.id === activeModule) || visibleItems[0];
  const groups = (['PILOTAGE', 'CLINIQUE', 'COORDINATION', 'ADMINISTRATION'] as NavGroup[]).filter((g) =>
    visibleItems.some((i) => i.group === g)
  );

  const loadNotifications = async () => {
    try {
      const res = await apiFetch<{ notifications: NotificationItem[] }>('/api/notifications');
      setNotifications(res.notifications || []);
    } catch {
      // Ignore transient error
    }
  };

  useEffect(() => {
    loadNotifications();
  }, [user._id]);

  useLiveSync(['notification'], loadNotifications);

  useEffect(() => {
    if (!hasPerm(user, 'patients:read_admin') || searchQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await apiFetch<{ patients: Patient[] }>(
          `/api/patients?search=${encodeURIComponent(searchQuery.trim())}`
        );
        setSearchResults(res.patients.slice(0, 6));
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [searchQuery, user]);

  const unreadCount = notifications.filter((n) => !n.readByUserIds.includes(user._id)).length;

  const markRead = async (n: NotificationItem) => {
    try {
      await apiFetch(`/api/notifications/${n._id}/read`, { method: 'POST' });
      setNotifications((prev) =>
        prev.map((item) =>
          item._id === n._id
            ? { ...item, readByUserIds: [...item.readByUserIds, user._id] }
            : item
        )
      );
      if (n.linkModule) {
        onNavigate(n.linkModule as NavModuleId);
        setNotifOpen(false);
      }
    } catch {
      // ignore
    }
  };

  const markAllRead = async () => {
    try {
      await apiFetch('/api/notifications/read-all', { method: 'POST' });
      setNotifications((prev) =>
        prev.map((item) => ({
          ...item,
          readByUserIds: item.readByUserIds.includes(user._id)
            ? item.readByUserIds
            : [...item.readByUserIds, user._id],
        }))
      );
    } catch {
      // ignore
    }
  };

  const SidebarContent = (
    <div className="flex flex-col h-full bg-[#073B70] dark:bg-[#0B1728] text-white select-none">
      <div className="flex items-center justify-between gap-2 px-4 h-16 border-b border-white/10">
        <div className="flex items-center gap-3 min-w-0">
          <ClinicLogo size="sm" refreshKey={logoRefreshKey} />
          {!collapsed && (
            <div className="min-w-0">
              <div className="font-display font-bold text-base tracking-tight truncate flex items-center gap-1.5">
                CARDIO <span className="text-[#FF6B70]">ERP</span>
              </div>
              <div className="text-[11px] text-sky-200/80 truncate">Paris 16 · Douala</div>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="hidden lg:inline-flex p-1.5 rounded-lg text-sky-200 hover:bg-white/10"
          aria-label={collapsed ? 'Déplier le menu' : 'Réduire le menu'}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="lg:hidden p-1.5 rounded-lg text-sky-200 hover:bg-white/10"
          aria-label="Fermer le menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 py-4 space-y-4">
        {groups.map((group) => {
          const items = visibleItems.filter((i) => i.group === group);
          return (
            <div key={group} className="space-y-1">
              {!collapsed && (
                <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sky-200/60">
                  {GROUP_LABELS[group]}
                </div>
              )}
              {items.map((item) => {
                const Icon = item.icon;
                const active = activeModule === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onNavigate(item.id);
                      setMobileOpen(false);
                    }}
                    title={collapsed ? item.label : undefined}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap ${
                      active
                        ? 'bg-white text-[#073B70] shadow-xs font-semibold'
                        : 'text-sky-100/85 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-[#D71920]' : 'text-sky-200/80'}`} />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="p-3 border-t border-white/10 bg-black/10">
        {!collapsed && (
          <div className="px-2.5 py-2 mb-2 rounded-lg bg-white/8 border border-white/10 text-xs">
            <div className="font-semibold truncate text-white">
              {user.title ? `${user.title} ` : ''}
              {user.firstName} {user.lastName}
            </div>
            <div className="text-[11px] text-sky-200/80 truncate mt-0.5">
              {user.roles.map((r) => ROLE_LABELS[r]).join(' · ')}
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={onLogout}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-sky-100 hover:bg-[#D71920] hover:text-white"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          {!collapsed && <span>Déconnexion</span>}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-[#F3F7FB] dark:bg-[#0B1320] text-[#172B45] dark:text-slate-100">
      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:block shrink-0 transition-all duration-200 border-r border-slate-200 dark:border-slate-800 ${
          collapsed ? 'w-[76px]' : 'w-[264px]'
        }`}
      >
        <div className="sticky top-0 h-screen">{SidebarContent}</div>
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-[274px] h-full shadow-2xl">{SidebarContent}</div>
          <div className="flex-1 bg-slate-950/55" onClick={() => setMobileOpen(false)} />
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 h-16 bg-white/95 dark:bg-[#131E30]/95 backdrop-blur border-b border-slate-200/90 dark:border-slate-800 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-[#172B45] dark:text-slate-200"
              aria-label="Ouvrir le menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <div className="text-base font-bold font-display text-[#073B70] dark:text-white truncate">
                {activeItem?.label || 'CARDIO ERP'}
              </div>
              <div className="hidden sm:block text-[11px] text-[#708197] dark:text-slate-400 truncate">
                Cabinet Médical de Cardiologie Paris 16
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 sm:gap-3">
            {/* Global Patient Quick Search (Staff only) */}
            {hasPerm(user, 'patients:read_admin') && (
              <div className="relative hidden md:block w-64 lg:w-80">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Rechercher patient (Nom, PAT-...)"
                  className="w-full pl-9 pr-3 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F3F7FB] dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1265A3]"
                />
                {searchQuery.trim().length >= 2 && (
                  <div className="absolute left-0 right-0 mt-1.5 bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden z-40">
                    {searching ? (
                      <div className="p-3 text-xs text-[#708197]">Recherche en cours...</div>
                    ) : searchResults.length === 0 ? (
                      <div className="p-3 text-xs text-[#708197]">Aucun patient trouvé.</div>
                    ) : (
                      <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {searchResults.map((p) => (
                          <button
                            key={p._id}
                            type="button"
                            onClick={() => {
                              setSearchQuery('');
                              setSearchResults([]);
                              onNavigate('patients', p.patientNumber || p._id);
                            }}
                            className="w-full text-left px-3.5 py-2.5 hover:bg-[#EAF4FC]/70 dark:hover:bg-slate-800 flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-[#172B45] dark:text-slate-100 truncate">
                                {p.firstName} {p.lastName}
                              </div>
                              <div className="text-[11px] text-[#708197] font-mono">
                                {p.patientNumber} · {p.phone}
                              </div>
                            </div>
                            <FolderHeart className="w-4 h-4 text-[#1265A3] shrink-0" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Theme toggle */}
            <button
              type="button"
              onClick={onToggleDark}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-[#708197] dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label={darkMode ? 'Passer au thème clair' : 'Passer au thème sombre'}
              title={darkMode ? 'Thème clair' : 'Thème sombre'}
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {/* Notifications popover */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen(!notifOpen)}
                className="relative p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-[#708197] dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#D71920] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                    {unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl z-40 overflow-hidden">
                  <div className="px-4 py-3 bg-[#F8FBFE] dark:bg-[#0F1827] border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <span className="text-sm font-semibold text-[#073B70] dark:text-white">
                      Alertes & Notifications
                    </span>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={markAllRead}
                        className="text-xs text-[#1265A3] dark:text-sky-400 hover:underline font-medium"
                      >
                        Tout marquer comme lu
                      </button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                    {notifications.length === 0 ? (
                      <div className="p-6 text-center text-xs text-[#708197]">
                        Aucune alerte pour le moment.
                      </div>
                    ) : (
                      notifications.map((n) => {
                        const isRead = n.readByUserIds.includes(user._id);
                        const isUrgentAlert =
                          n.eventType === 'TACHE_EN_RETARD' ||
                          n.eventType === 'URGENCE_SIGNALEE' ||
                          n.eventType === 'SUIVI_A_EFFECTUER';
                        return (
                          <button
                            key={n._id}
                            type="button"
                            onClick={() => markRead(n)}
                            className={`w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 ${
                              !isRead ? 'bg-[#EAF4FC]/55 dark:bg-[#073B70]/25' : ''
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span
                                className={`text-xs font-semibold ${
                                  isUrgentAlert && !isRead
                                    ? 'text-[#D71920] dark:text-red-300'
                                    : 'text-[#172B45] dark:text-slate-100'
                                }`}
                              >
                                {n.title}
                              </span>
                              {!isRead && (
                                <span className="text-[10px] font-bold text-[#D71920] shrink-0">
                                  Nouveau
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-[#708197] dark:text-slate-400 mt-0.5 line-clamp-2">
                              {n.message}
                            </p>
                            <div className="text-[10px] text-[#708197] mt-1 tabular-nums">
                              {formatDateTimeFr(n.createdAt)}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">{children}</main>
      </div>
    </div>
  );
};
