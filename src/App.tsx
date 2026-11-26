/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutShell, type NavModuleId } from './components/LayoutShell';
import { ToastContainer, type ToastMessage } from './components/UIPrimitives';
import { ClinicLogo } from './components/ClinicLogo';
import { apiFetch, hasAnyPerm, hasPerm, isRoleOnly, setMemoryCsrfToken, setSessionToken } from './lib/api';
import { resetLiveSyncConnection, useLiveSync } from './lib/useLiveSync';
import { isAuthPath, MODULE_BASE_PATHS, navigate, resolveModuleFromPath, useAppRoute } from './lib/router';
import type { PublicUser, SystemStatusResponse } from './shared/types';
import { InfrastructureSetupPage } from './pages/InfrastructureSetupPage';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { PatientPortalPage } from './pages/PatientPortalPage';
import { PatientsPage } from './pages/PatientsPage';
import { AppointmentsPage } from './pages/AppointmentsPage';
import { QueuePage } from './pages/QueuePage';
import { ConsultationsPage } from './pages/ConsultationsPage';
import { ExaminationsPage } from './pages/ExaminationsPage';
import { FollowUpsPage } from './pages/FollowUpsPage';
import { TasksPage } from './pages/TasksPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { FinancePage } from './pages/FinancePage';
import { StatisticsPage } from './pages/StatisticsPage';
import { AdminPage } from './pages/AdminPage';

function isModuleAllowed(user: PublicUser, module: NavModuleId): boolean {
  switch (module) {
    case 'patient-portal':
      return user.roles.includes('PATIENT');
    case 'dashboard':
      return !isRoleOnly(user, 'PATIENT');
    case 'queue':
      return hasAnyPerm(user, ['queue:manage', 'appointments:read']);
    case 'appointments':
      return hasPerm(user, 'appointments:read');
    case 'patients':
      return hasPerm(user, 'patients:read_admin');
    case 'consultations':
      return hasPerm(user, 'consultations:read');
    case 'examinations':
      return hasPerm(user, 'examinations:read');
    case 'follow-ups':
      return hasPerm(user, 'followups:read');
    case 'tasks':
      return hasPerm(user, 'tasks:read');
    case 'documents':
      return hasAnyPerm(user, ['documents:read_admin', 'documents:read_medical']);
    case 'finance':
      return hasAnyPerm(user, ['payments:read', 'services:manage']);
    case 'statistics':
      return hasAnyPerm(user, ['statistics:read_medical', 'statistics:read_admin']);
    case 'admin':
      return hasAnyPerm(user, ['users:manage', 'settings:manage', 'audit:read']);
    default:
      return false;
  }
}

export default function App() {
  const route = useAppRoute();
  const [systemStatus, setSystemStatus] = useState<SystemStatusResponse | null>(null);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [booting, setBooting] = useState(true);
  const [logoRefreshKey, setLogoRefreshKey] = useState(0);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const pendingDeepUrlRef = useRef<string | null>(null);

  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('cardio_erp_theme') === 'dark';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    try {
      localStorage.setItem('cardio_erp_theme', darkMode ? 'dark' : 'light');
    } catch {
      // ignore storage errors
    }
  }, [darkMode]);

  const notify = useCallback((type: 'success' | 'error' | 'info', text: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((prev) => [...prev.slice(-4), { id, type, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const refreshSystemAndSession = useCallback(async () => {
    setBooting(true);
    try {
      const status = await apiFetch<SystemStatusResponse>('/api/system/status');
      setSystemStatus(status);

      if (status.supabaseConfigured && status.supabaseConnected && status.supabaseSchemaReady) {
        try {
          const me = await apiFetch<{
            authenticated?: boolean;
            user: PublicUser | null;
            csrfToken?: string;
            sessionToken?: string;
          }>('/api/auth/me');
          if (me.authenticated && me.user) {
            if (me.sessionToken) setSessionToken(me.sessionToken);
            setMemoryCsrfToken(me.csrfToken);
            setUser(me.user);
          } else {
            setSessionToken(null);
            setMemoryCsrfToken(null);
            setUser(null);
          }
        } catch {
          setSessionToken(null);
          setMemoryCsrfToken(null);
          setUser(null);
        }
      } else {
        setSessionToken(null);
        setMemoryCsrfToken(null);
        setUser(null);
      }
    } catch (err: any) {
      setSystemStatus({
        supabaseConfigured: false,
        supabaseConnected: false,
        supabaseSchemaReady: false,
        supabaseError: err.message || 'Serveur CARDIO ERP indisponible.',
        r2Configured: false,
        r2Connected: false,
        resendConfigured: false,
        missingEnvVars: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
        sessionSecretConfigured: false,
        hasAnyUsers: false,
        hasDemoData: false,
      });
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    refreshSystemAndSession();
  }, [refreshSystemAndSession]);

  useEffect(() => {
    const onUnauthorized = () => {
      setSessionToken(null);
      setMemoryCsrfToken(null);
      resetLiveSyncConnection();
      setUser((prev) => {
        if (prev) {
          notify('info', 'Votre session a expiré. Veuillez vous reconnecter.');
        }
        return null;
      });
      navigate('/login', { replace: true });
    };
    window.addEventListener('cardio:unauthorized', onUnauthorized);
    return () => window.removeEventListener('cardio:unauthorized', onUnauthorized);
  }, [notify]);

  // Synchronize active user permissions/status and clinic branding across all logged-in sessions
  useLiveSync(['user', 'settings'], async () => {
    if (!user) return;
    setLogoRefreshKey((k) => k + 1);
    try {
      const me = await apiFetch<{
        authenticated?: boolean;
        user: PublicUser | null;
        csrfToken?: string;
        sessionToken?: string;
      }>('/api/auth/me');
      if (!me.authenticated || !me.user) {
        setSessionToken(null);
        setMemoryCsrfToken(null);
        resetLiveSyncConnection();
        setUser(null);
        navigate('/login', { replace: true });
        notify('info', 'Votre session a été mise à jour ou désactivée par un administrateur.');
        return;
      }
      if (me.sessionToken) setSessionToken(me.sessionToken);
      if (me.csrfToken) setMemoryCsrfToken(me.csrfToken);
      setUser(me.user);
    } catch {
      // Ignore transient network errors
    }
  });

  // Synchronize URL with auth/system state seamlessly (preserving deep links across login)
  useEffect(() => {
    if (booting || !systemStatus) return;

    const supabaseReady =
      systemStatus.supabaseConfigured && systemStatus.supabaseConnected && systemStatus.supabaseSchemaReady;

    if (!supabaseReady) {
      if (!route.pathname.startsWith('/configuration-systeme')) {
        if (!isAuthPath(route.pathname) && route.pathname !== '/') {
          pendingDeepUrlRef.current = `${route.pathname}${route.search}`;
        }
        navigate('/configuration-systeme', { replace: true });
      }
      return;
    }

    if (!user) {
      if (!route.pathname.startsWith('/login')) {
        if (!isAuthPath(route.pathname) && route.pathname !== '/') {
          pendingDeepUrlRef.current = `${route.pathname}${route.search}`;
        }
        navigate('/login', { replace: true });
      }
      return;
    }

    // Authenticated user
    const defaultPath = isRoleOnly(user, 'PATIENT')
      ? `/patient/${encodeURIComponent(user.patientId || 'moi')}`
      : '/tableau-de-bord';

    if (route.pathname === '/' || isAuthPath(route.pathname)) {
      const target = pendingDeepUrlRef.current || defaultPath;
      pendingDeepUrlRef.current = null;
      navigate(target, { replace: true });
      return;
    }

    const matchedModule = resolveModuleFromPath(route.pathname);
    if (!matchedModule || !isModuleAllowed(user, matchedModule)) {
      navigate(defaultPath, { replace: true });
    }
  }, [booting, systemStatus, user, route.pathname, route.search]);

  const handleLoginSuccess = (loggedUser: PublicUser) => {
    setUser(loggedUser);
    resetLiveSyncConnection();
    const defaultPath = isRoleOnly(loggedUser, 'PATIENT')
      ? `/patient/${encodeURIComponent(loggedUser.patientId || 'moi')}`
      : '/tableau-de-bord';
    const target = pendingDeepUrlRef.current || defaultPath;
    pendingDeepUrlRef.current = null;
    navigate(target, { replace: true });
  };

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Clear local session state regardless
    }
    pendingDeepUrlRef.current = null;
    setSessionToken(null);
    setMemoryCsrfToken(null);
    resetLiveSyncConnection();
    setUser(null);
    navigate('/login', { replace: true });
    notify('info', 'Session fermée.');
  };

  const handleNavigate = (module: NavModuleId, patientId?: string) => {
    if ((module as string) === 'users') {
      navigate('/administration/utilisateurs');
      return;
    }
    if (module === 'patients' && patientId) {
      navigate(`/patients/${encodeURIComponent(patientId)}`);
      return;
    }
    if (module === 'patient-portal' && user?.patientId) {
      navigate(`/patient/${encodeURIComponent(user.patientId)}`);
      return;
    }
    navigate(MODULE_BASE_PATHS[module] || '/tableau-de-bord');
  };

  if (booting || !systemStatus) {
    return (
      <div className="min-h-screen bg-[#F4F7FB] dark:bg-[#0B1320] flex flex-col items-center justify-center p-6 text-[#172B45] dark:text-slate-100">
        <div className="flex flex-col items-center gap-4">
          <ClinicLogo size="lg" />
          <div className="text-center">
            <div className="font-display font-bold text-lg text-[#073B70] dark:text-sky-300">
              CARDIO ERP
            </div>
            <div className="text-xs text-[#708197] dark:text-slate-400 mt-1">
              Initialisation sécurisée du cabinet médical...
            </div>
          </div>
        </div>
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </div>
    );
  }

  if (!systemStatus.supabaseConfigured || !systemStatus.supabaseConnected || !systemStatus.supabaseSchemaReady) {
    return (
      <>
        <InfrastructureSetupPage
          status={systemStatus}
          onConnected={refreshSystemAndSession}
          darkMode={darkMode}
          onToggleDark={() => setDarkMode((d) => !d)}
        />
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  if (!user) {
    return (
      <>
        <LoginPage
          systemStatus={systemStatus}
          onLoginSuccess={handleLoginSuccess}
          onSystemRefresh={refreshSystemAndSession}
          darkMode={darkMode}
          onToggleDark={() => setDarkMode((d) => !d)}
          notify={notify}
        />
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  const parsedModule = resolveModuleFromPath(route.pathname);
  const activeModule: NavModuleId =
    parsedModule && isModuleAllowed(user, parsedModule)
      ? parsedModule
      : isRoleOnly(user, 'PATIENT')
      ? 'patient-portal'
      : 'dashboard';

  const selectedPatientKey =
    activeModule === 'patients' && route.segments[1] && route.segments[1] !== 'nouveau'
      ? route.segments[1]
      : null;

  const renderModule = () => {
    switch (activeModule) {
      case 'patient-portal':
        return <PatientPortalPage user={user} notify={notify} />;
      case 'patients':
        return (
          <PatientsPage
            user={user}
            initialPatientId={selectedPatientKey}
            onClearInitialPatient={() => navigate('/patients')}
            notify={notify}
          />
        );
      case 'appointments':
        return <AppointmentsPage user={user} notify={notify} />;
      case 'queue':
        return <QueuePage user={user} notify={notify} />;
      case 'consultations':
        return <ConsultationsPage user={user} notify={notify} />;
      case 'examinations':
        return <ExaminationsPage user={user} notify={notify} />;
      case 'follow-ups':
        return <FollowUpsPage user={user} notify={notify} />;
      case 'tasks':
        return <TasksPage user={user} notify={notify} />;
      case 'documents':
        return <DocumentsPage user={user} notify={notify} />;
      case 'finance':
        return <FinancePage user={user} notify={notify} />;
      case 'statistics':
        return <StatisticsPage user={user} notify={notify} />;
      case 'admin':
        return (
          <AdminPage
            user={user}
            onLogoUpdated={() => setLogoRefreshKey((k) => k + 1)}
            notify={notify}
          />
        );
      case 'dashboard':
      default:
        return isRoleOnly(user, 'PATIENT') ? (
          <PatientPortalPage user={user} notify={notify} />
        ) : (
          <DashboardPage user={user} onNavigate={handleNavigate} />
        );
    }
  };

  return (
    <>
      <LayoutShell
        user={user}
        activeModule={activeModule}
        onNavigate={handleNavigate}
        onLogout={handleLogout}
        darkMode={darkMode}
        onToggleDark={() => setDarkMode((d) => !d)}
        logoRefreshKey={logoRefreshKey}
      >
        {renderModule()}
      </LayoutShell>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
