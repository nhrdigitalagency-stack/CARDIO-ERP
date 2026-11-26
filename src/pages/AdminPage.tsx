import React, { useEffect, useState } from 'react';
import {
  BellRing,
  CheckCircle2,
  Cloud,
  Database,
  Download,
  Edit3,
  Mail,
  MessageSquare,
  Play,
  RefreshCw,
  Send,
  Shield,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  ConfirmModal,
  Modal,
  StatusBadge,
  TableSkeleton,
} from '../components/UIPrimitives';
import { ClinicLogo } from '../components/ClinicLogo';
import type {
  AuditLog,
  ClinicSettings,
  EmailDispatchLog,
  PublicUser,
  RoleCode,
  SystemStatusResponse,
} from '../shared/types';
import { ROLE_LABELS } from '../shared/constants';
import { apiFetch, formatDateTimeFr, getAuthHeaders, hasPerm } from '../lib/api';
import { buildQuerySuffix, navigate, useAppRoute } from '../lib/router';
import { useLiveSync } from '../lib/useLiveSync';

type AdminTab = 'users' | 'settings' | 'audit' | 'demo';

const TAB_TO_SLUG: Record<AdminTab, string> = {
  users: 'utilisateurs',
  settings: 'parametres',
  audit: 'audit',
  demo: 'demonstration',
};

const SLUG_TO_TAB: Record<string, AdminTab> = {
  utilisateurs: 'users',
  parametres: 'settings',
  audit: 'audit',
  demonstration: 'demo',
};

export const AdminPage: React.FC<{
  user: PublicUser;
  onLogoUpdated: () => void;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
}> = ({ user, onLogoUpdated, notify }) => {
  const route = useAppRoute();
  const isRoot = route.segments[0] === 'administration';
  const seg1 = route.segments[1] || '';
  const seg2 = route.segments[2] || '';
  const seg3 = route.segments[3] || '';

  const defaultTab: AdminTab = hasPerm(user, 'users:manage')
    ? 'users'
    : hasPerm(user, 'settings:manage')
    ? 'settings'
    : 'audit';
  const requestedTab: AdminTab = SLUG_TO_TAB[seg1] || defaultTab;
  const tab: AdminTab = (() => {
    if (requestedTab === 'users' && !hasPerm(user, 'users:manage')) return defaultTab;
    if ((requestedTab === 'settings' || requestedTab === 'demo') && !hasPerm(user, 'settings:manage')) return defaultTab;
    if (requestedTab === 'audit' && !hasPerm(user, 'audit:read')) return defaultTab;
    return requestedTab;
  })();

  const isCreateUserUrl = isRoot && seg1 === 'utilisateurs' && seg2 === 'nouveau';
  const urlEditUserId = isRoot && seg1 === 'utilisateurs' && seg2 && seg2 !== 'nouveau' && seg3 === 'modifier' ? seg2 : null;
  const isResetDemoUrl = isRoot && seg1 === 'demonstration' && seg2 === 'reinitialiser';
  const severityFilter = route.query.get('gravite') || 'ALL';

  const [users, setUsers] = useState<PublicUser[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [settings, setSettings] = useState<ClinicSettings | null>(null);
  const [infraStatus, setInfraStatus] = useState<SystemStatusResponse | null>(null);
  const [emailLogs, setEmailLogs] = useState<EmailDispatchLog[]>([]);
  const [testEmailTo, setTestEmailTo] = useState(user.email || '');
  const [sendingTestEmail, setSendingTestEmail] = useState(false);
  const [testWhatsAppPhone, setTestWhatsAppPhone] = useState(user.phone || '');
  const [sendingTestWhatsApp, setSendingTestWhatsApp] = useState(false);
  const [runningReminders, setRunningReminders] = useState(false);
  const [loading, setLoading] = useState(true);

  const [saving, setSaving] = useState(false);
  const [userForm, setUserForm] = useState({
    firstName: '',
    lastName: '',
    title: '',
    specialty: '',
    email: '',
    username: '',
    phone: '',
    roles: ['ACCUEIL'] as RoleCode[],
    password: '',
  });

  const [editTarget, setEditTarget] = useState<PublicUser | null>(null);
  const [editForm, setEditForm] = useState({
    firstName: '',
    lastName: '',
    title: '',
    specialty: '',
    phone: '',
    roles: ['ACCUEIL'] as RoleCode[],
    isActive: true,
    resetPassword: '',
  });

  const [resetting, setResetting] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [exportingAudit, setExportingAudit] = useState(false);

  const setTab = (next: AdminTab) => {
    navigate(`/administration/${TAB_TO_SLUG[next]}`);
  };

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [uRes, sRes, aRes, statusRes, mailRes] = await Promise.all([
        hasPerm(user, 'users:manage') ? apiFetch<{ users: PublicUser[] }>('/api/users') : Promise.resolve({ users: [] }),
        hasPerm(user, 'settings:manage') ? apiFetch<{ settings: ClinicSettings }>('/api/settings') : Promise.resolve({ settings: null }),
        hasPerm(user, 'audit:read')
          ? apiFetch<{ logs: AuditLog[] }>(`/api/audit-logs?severity=${severityFilter}`)
          : Promise.resolve({ logs: [] }),
        apiFetch<SystemStatusResponse>('/api/system/status').catch(() => null),
        hasPerm(user, 'settings:manage') || hasPerm(user, 'audit:read')
          ? apiFetch<{ logs: EmailDispatchLog[] }>('/api/notifications/email-logs').catch(() => ({ logs: [] }))
          : Promise.resolve({ logs: [] }),
      ]);
      setUsers(uRes.users);
      setSettings(sRes.settings);
      setAuditLogs(aRes.logs);
      if (statusRes) setInfraStatus(statusRes);
      setEmailLogs(mailRes.logs || []);
    } catch (err: any) {
      if (!silent) notify('error', err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [severityFilter]);

  useLiveSync(['user', 'settings', 'audit', 'notification'], () => load(true));

  // Sync URL -> create user, edit user, reset demo modals & canonical tab redirect
  useEffect(() => {
    if (!isRoot) return;
    if (tab !== requestedTab || !seg1) {
      navigate(`/administration/${TAB_TO_SLUG[tab]}`, { replace: true });
      return;
    }

    if (isCreateUserUrl) {
      if (!hasPerm(user, 'users:manage')) {
        navigate(`/administration/${TAB_TO_SLUG[defaultTab]}`, { replace: true });
        return;
      }
      setEditTarget(null);
      return;
    }

    if (urlEditUserId) {
      if (!hasPerm(user, 'users:manage')) {
        navigate(`/administration/${TAB_TO_SLUG[defaultTab]}`, { replace: true });
        return;
      }
      const match = users.find((u) => u._id === urlEditUserId);
      if (match) {
        setEditTarget(match);
        setEditForm({
          firstName: match.firstName,
          lastName: match.lastName,
          title: match.title || '',
          specialty: match.specialty || '',
          phone: match.phone || '',
          roles: match.roles,
          isActive: match.isActive,
          resetPassword: '',
        });
      } else if (!loading) {
        navigate('/administration/utilisateurs', { replace: true });
      }
      return;
    }

    if (isResetDemoUrl && !hasPerm(user, 'settings:manage')) {
      navigate(`/administration/${TAB_TO_SLUG[defaultTab]}`, { replace: true });
      return;
    }

    setEditTarget(null);
  }, [isRoot, seg1, tab, requestedTab, isCreateUserUrl, urlEditUserId, isResetDemoUrl, users, loading]);

  const handleDownloadBackup = async () => {
    setBackingUp(true);
    try {
      const res = await fetch('/api/admin/backup', { credentials: 'include', headers: getAuthHeaders() });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Échec de l’export de sauvegarde.' }));
        throw new Error(errData.error || 'Échec de l’export de sauvegarde.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cardio-erp-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify('success', 'Sauvegarde JSON exportée avec succès.');
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setBackingUp(false);
    }
  };

  const handleExportAuditCsv = async () => {
    setExportingAudit(true);
    try {
      const qs = severityFilter && severityFilter !== 'ALL' ? `?severity=${encodeURIComponent(severityFilter)}` : '';
      const res = await fetch(`/api/audit-logs/export${qs}`, { credentials: 'include', headers: getAuthHeaders() });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Échec de l’export CSV du journal.' }));
        throw new Error(errData.error || 'Échec de l’export CSV du journal.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cardio-erp-audit-journal-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify('success', "Journal d'audit exporté au format CSV.");
      await load(true);
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setExportingAudit(false);
    }
  };

  const toggleRole = (role: RoleCode) => {
    setUserForm((prev) => ({
      ...prev,
      roles: prev.roles.includes(role) ? prev.roles.filter((r) => r !== role) : [...prev.roles, role],
    }));
  };

  const toggleEditRole = (role: RoleCode) => {
    setEditForm((prev) => ({
      ...prev,
      roles: prev.roles.includes(role) ? prev.roles.filter((r) => r !== role) : [...prev.roles, role],
    }));
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userForm.roles.length) {
      notify('error', 'Sélectionnez au moins un rôle.');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify(userForm),
      });
      notify('success', 'Compte utilisateur créé.');
      setUserForm({
        firstName: '',
        lastName: '',
        title: '',
        specialty: '',
        email: '',
        username: '',
        phone: '',
        roles: ['ACCUEIL'],
        password: '',
      });
      navigate('/administration/utilisateurs');
      await load();
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    if (!editForm.roles.length) {
      notify('error', 'Sélectionnez au moins un rôle.');
      return;
    }
    if (editForm.resetPassword && editForm.resetPassword.length < 8) {
      notify('error', 'Le nouveau mot de passe doit contenir au moins 8 caractères.');
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/users/${editTarget._id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          firstName: editForm.firstName,
          lastName: editForm.lastName,
          title: editForm.title,
          specialty: editForm.specialty,
          phone: editForm.phone,
          roles: editForm.roles,
          isActive: editForm.isActive,
          ...(editForm.resetPassword.trim() ? { resetPassword: editForm.resetPassword.trim() } : {}),
        }),
      });
      notify('success', 'Compte utilisateur mis à jour.');
      navigate('/administration/utilisateurs');
      await load();
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleUserActive = async (target: PublicUser) => {
    try {
      await apiFetch(`/api/users/${target._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !target.isActive }),
      });
      notify('success', target.isActive ? 'Compte désactivé.' : 'Compte activé.');
      await load();
    } catch (err: any) {
      notify('error', err.message);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    try {
      await apiFetch('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          clinicName: settings.clinicName,
          leadDoctorName: settings.leadDoctorName,
          specialty: settings.specialty,
          city: settings.city,
          phone: settings.phone,
          email: settings.email,
          address: settings.address,
          slogan: settings.slogan,
          archivingPolicyYears: settings.archivingPolicyYears,
          notificationChannels: settings.notificationChannels,
        }),
      });
      notify('success', 'Paramètres du cabinet enregistrés.');
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (file: File | undefined) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('logo', file);
    try {
      await apiFetch('/api/settings/logo', { method: 'POST', body: fd });
      notify('success', 'Logo du cabinet mis à jour.');
      onLogoUpdated();
    } catch (err: any) {
      notify('error', err.message);
    }
  };

  const handleResetDemo = async () => {
    setResetting(true);
    try {
      await apiFetch('/api/system/reset-demo', { method: 'POST' });
      notify('success', 'Données de démonstration réinitialisées sans toucher aux données de production.');
      navigate('/administration/demonstration');
      await load();
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setResetting(false);
    }
  };

  const handleSendTestEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testEmailTo.trim()) return;
    setSendingTestEmail(true);
    try {
      const res = await apiFetch<{ ok: boolean; providerMessageId?: string }>('/api/notifications/test-email', {
        method: 'POST',
        body: JSON.stringify({ to: testEmailTo.trim() }),
      });
      notify(
        'success',
        `E-mail de test envoyé via Resend (${res.providerMessageId ? `ID: ${res.providerMessageId}` : 'confirmé'}).`
      );
      await load(true);
    } catch (err: any) {
      notify('error', err.message || "Échec de l'envoi via Resend.");
    } finally {
      setSendingTestEmail(false);
    }
  };

  const handleSendTestWhatsApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testWhatsAppPhone.trim()) return;
    setSendingTestWhatsApp(true);
    try {
      const res = await apiFetch<{ ok: boolean; provider?: string; providerMessageId?: string }>(
        '/api/notifications/test-whatsapp',
        {
          method: 'POST',
          body: JSON.stringify({ phone: testWhatsAppPhone.trim() }),
        }
      );
      notify(
        'success',
        `Message WhatsApp de test envoyé (${res.provider === 'WHATSAPP_CALLMEBOT' ? 'CallMeBot' : 'Cloud API'}${
          res.providerMessageId ? ` · ID: ${res.providerMessageId}` : ''
        }).`
      );
      await load(true);
    } catch (err: any) {
      notify('error', err.message || "Échec de l'envoi WhatsApp.");
    } finally {
      setSendingTestWhatsApp(false);
    }
  };

  const handleRunRemindersNow = async () => {
    setRunningReminders(true);
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
        `Relances exécutées : ${s.emailsSent} e-mail(s) Resend, ${s.whatsappSent || 0} WhatsApp envoyés (${s.appointmentsReminded} RDV J-1, ${s.followUpsReminded} suivi(s), ${s.tasksEscalated} tâche(s), ${s.examsEscalated} examen(s)).`
      );
      await load(true);
    } catch (err: any) {
      notify('error', err.message || "Impossible d'exécuter les relances automatiques.");
    } finally {
      setRunningReminders(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg w-fit">
        {hasPerm(user, 'users:manage') && (
          <button type="button" onClick={() => setTab('users')} className={`px-3 py-1.5 rounded-md text-xs font-medium ${tab === 'users' ? 'bg-white dark:bg-slate-900 text-[#073B70] dark:text-sky-300 shadow-xs' : 'text-[#708197]'}`}>
            Utilisateurs & Rôles
          </button>
        )}
        {hasPerm(user, 'settings:manage') && (
          <button type="button" onClick={() => setTab('settings')} className={`px-3 py-1.5 rounded-md text-xs font-medium ${tab === 'settings' ? 'bg-white dark:bg-slate-900 text-[#073B70] dark:text-sky-300 shadow-xs' : 'text-[#708197]'}`}>
            Paramètres, Logo & Canaux
          </button>
        )}
        {hasPerm(user, 'audit:read') && (
          <button type="button" onClick={() => setTab('audit')} className={`px-3 py-1.5 rounded-md text-xs font-medium ${tab === 'audit' ? 'bg-white dark:bg-slate-900 text-[#073B70] dark:text-sky-300 shadow-xs' : 'text-[#708197]'}`}>
            Journal d'activité & Sécurité
          </button>
        )}
        {hasPerm(user, 'settings:manage') && (
          <button type="button" onClick={() => setTab('demo')} className={`px-3 py-1.5 rounded-md text-xs font-medium ${tab === 'demo' ? 'bg-white dark:bg-slate-900 text-[#073B70] dark:text-sky-300 shadow-xs' : 'text-[#708197]'}`}>
            Environnement Démo
          </button>
        )}
      </div>

      {loading ? (
        <TableSkeleton rows={5} />
      ) : tab === 'users' ? (
        <div className="space-y-4">
          <div className="flex justify-between items-center bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Users className="w-4 h-4 text-[#1265A3]" />
              Comptes du personnel et accès portail ({users.length})
            </div>
            <button
              type="button"
              onClick={() => navigate('/administration/utilisateurs/nouveau')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#073B70] text-white text-xs font-medium"
            >
              <UserPlus className="w-4 h-4" />
              Créer un utilisateur
            </button>
          </div>

          <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 dark:bg-slate-900/60 text-xs text-[#708197] border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-4 py-3 font-medium">Utilisateur</th>
                    <th className="px-4 py-3 font-medium">E-mail / Identifiant</th>
                    <th className="px-4 py-3 font-medium">Rôles</th>
                    <th className="px-4 py-3 font-medium">Statut</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {users.map((u) => (
                    <tr key={u._id}>
                      <td className="px-4 py-3">
                        <div className="font-semibold">{u.title ? `${u.title} ` : ''}{u.firstName} {u.lastName}</div>
                        <div className="text-xs text-[#708197]">{u.specialty || '—'}</div>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono">
                        <div>{u.email}</div>
                        <div className="text-[#708197]">@{u.username}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {u.roles.map((r) => (
                            <StatusBadge key={r} label={ROLE_LABELS[r]} tone="info" />
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge label={u.isActive ? 'Actif' : 'Désactivé'} tone={u.isActive ? 'success' : 'danger'} />
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap space-x-1.5">
                        <button
                          type="button"
                          onClick={() => navigate(`/administration/utilisateurs/${encodeURIComponent(u._id)}/modifier`)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                        >
                          <Edit3 className="w-3 h-3" /> Modifier
                        </button>
                        {u._id !== user._id && (
                          <button
                            type="button"
                            onClick={() => toggleUserActive(u)}
                            className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                          >
                            {u.isActive ? 'Désactiver' : 'Réactiver'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : tab === 'settings' && settings ? (
        <div className="space-y-6">
          {/* Live Infrastructure Status Bar (Supabase + R2 + Resend + WhatsApp) */}
          {infraStatus && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <Database className="w-4 h-4 text-[#073B70] dark:text-sky-300 mt-0.5 shrink-0" />
                  <div>
                    <div className="text-xs font-bold">Supabase PostgreSQL + RLS</div>
                    <div className="text-[11px] text-[#708197] mt-0.5">
                      {infraStatus.supabaseConnected && infraStatus.supabaseSchemaReady
                        ? 'Base relationnelle et politiques RLS actives'
                        : infraStatus.supabaseError || 'Configuration requise'}
                    </div>
                  </div>
                </div>
                <StatusBadge
                  label={infraStatus.supabaseConnected && infraStatus.supabaseSchemaReady ? 'Connecté' : 'Inactif'}
                  tone={infraStatus.supabaseConnected && infraStatus.supabaseSchemaReady ? 'success' : 'danger'}
                />
              </div>

              <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <Cloud className="w-4 h-4 text-[#1265A3] dark:text-sky-300 mt-0.5 shrink-0" />
                  <div>
                    <div className="text-xs font-bold">Cloudflare R2</div>
                    <div className="text-[11px] text-[#708197] mt-0.5">
                      {infraStatus.r2Connected
                        ? `Bucket : ${infraStatus.r2BucketName}`
                        : infraStatus.r2Error || 'Variables R2_* à configurer'}
                    </div>
                  </div>
                </div>
                <StatusBadge
                  label={infraStatus.r2Connected ? 'Connecté' : 'Non configuré'}
                  tone={infraStatus.r2Connected ? 'success' : 'warning'}
                />
              </div>

              <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <Mail className="w-4 h-4 text-[#D71920] mt-0.5 shrink-0" />
                  <div>
                    <div className="text-xs font-bold">Resend (E-mails & Relances)</div>
                    <div className="text-[11px] text-[#708197] mt-0.5 truncate max-w-[180px]">
                      {infraStatus.resendConfigured
                        ? infraStatus.resendFromEmail || 'Clé API active'
                        : 'Variable RESEND_API_KEY manquante'}
                    </div>
                  </div>
                </div>
                <StatusBadge
                  label={infraStatus.resendConfigured ? 'Actif' : 'Non configuré'}
                  tone={infraStatus.resendConfigured ? 'success' : 'warning'}
                />
              </div>

              <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <MessageSquare className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                  <div>
                    <div className="text-xs font-bold">WhatsApp Automatique</div>
                    <div className="text-[11px] text-[#708197] mt-0.5">
                      {infraStatus.whatsappConfigured
                        ? infraStatus.whatsappProvider === 'callmebot'
                          ? 'Passerelle CallMeBot active'
                          : 'Meta WhatsApp Cloud API active'
                        : 'WHATSAPP_* ou CALLMEBOT_* requis'}
                    </div>
                  </div>
                </div>
                <StatusBadge
                  label={infraStatus.whatsappConfigured ? 'Actif' : 'À configurer'}
                  tone={infraStatus.whatsappConfigured ? 'success' : 'warning'}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <form onSubmit={handleSaveSettings} className="lg:col-span-8 bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
              <h2 className="text-sm font-semibold">Identité du cabinet & Politique d'archivage</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Nom de l'établissement</label>
                  <input type="text" value={settings.clinicName} onChange={(e) => setSettings({ ...settings, clinicName: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Médecin responsable</label>
                  <input type="text" value={settings.leadDoctorName} onChange={(e) => setSettings({ ...settings, leadDoctorName: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Téléphone</label>
                  <input type="text" value={settings.phone} onChange={(e) => setSettings({ ...settings, phone: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">E-mail</label>
                  <input type="email" value={settings.email} onChange={(e) => setSettings({ ...settings, email: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium mb-1">Adresse complète</label>
                  <input type="text" value={settings.address} onChange={(e) => setSettings({ ...settings, address: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
                <h3 className="text-sm font-semibold">Notifications Resend & Moteur de relances automatiques</h3>
                <p className="text-xs text-[#708197]">
                  Aucune donnée médicale sensible (diagnostic, résultat clinique) n'est jamais transmise dans les e-mails externes.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <label className="flex items-center gap-2 p-3 rounded-lg border border-slate-200 dark:border-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.notificationChannels.emailEnabled}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          notificationChannels: {
                            ...settings.notificationChannels,
                            emailEnabled: e.target.checked,
                          },
                        })
                      }
                    />
                    Activer les notifications e-mail (Resend)
                  </label>
                  <label className="flex items-center gap-2 p-3 rounded-lg border border-slate-200 dark:border-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.notificationChannels.autoRemindersEnabled !== false}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          notificationChannels: {
                            ...settings.notificationChannels,
                            autoRemindersEnabled: e.target.checked,
                          },
                        })
                      }
                    />
                    Activer les relances automatiques (toutes les 15 min)
                  </label>
                  <label className="flex items-center gap-2 p-3 rounded-lg border border-slate-200 dark:border-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.notificationChannels.smsEnabled}
                      onChange={(e) => setSettings({ ...settings, notificationChannels: { ...settings.notificationChannels, smsEnabled: e.target.checked } })}
                    />
                    Passerelle SMS (optionnelle)
                  </label>
                  <label className="flex items-center gap-2 p-3 rounded-lg border border-slate-200 dark:border-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.notificationChannels.whatsappEnabled}
                      onChange={(e) => setSettings({ ...settings, notificationChannels: { ...settings.notificationChannels, whatsappEnabled: e.target.checked } })}
                    />
                    WhatsApp Business (optionnel)
                  </label>
                </div>
              </div>

              <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-[#073B70] hover:bg-[#1265A3] text-white text-sm font-medium disabled:opacity-60">
                {saving ? 'Enregistrement...' : 'Enregistrer les paramètres'}
              </button>
            </form>

            <div className="lg:col-span-4 space-y-4">
              <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
                <h2 className="text-sm font-semibold">Logo du cabinet (Cloudflare R2)</h2>
                <div className="flex items-center gap-4">
                  <ClinicLogo size="lg" />
                  <div className="text-xs text-[#708197]">
                    Stocké de manière sécurisée dans votre bucket Cloudflare R2.
                  </div>
                </div>
                <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800">
                  <Upload className="w-4 h-4 text-[#1265A3]" />
                  Téléverser le logo original
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(e) => handleLogoUpload(e.target.files?.[0])} />
                </label>
              </div>

              {/* Resend & WhatsApp Test + Manual Reminder Trigger */}
              <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <BellRing className="w-4 h-4 text-[#D71920]" />
                  Tests Resend, WhatsApp & Relances auto
                </div>
                <form onSubmit={handleSendTestEmail} className="space-y-2">
                  <label className="block text-xs font-medium">Envoyer un e-mail de test (Resend)</label>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      required
                      value={testEmailTo}
                      onChange={(e) => setTestEmailTo(e.target.value)}
                      placeholder="destinataire@domaine.cm"
                      className="flex-1 min-w-0 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                    />
                    <button
                      type="submit"
                      disabled={sendingTestEmail}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#073B70] hover:bg-[#1265A3] text-white text-xs font-medium disabled:opacity-50 shrink-0"
                    >
                      <Send className="w-3.5 h-3.5" />
                      {sendingTestEmail ? '...' : 'Tester'}
                    </button>
                  </div>
                </form>

                <form onSubmit={handleSendTestWhatsApp} className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <label className="block text-xs font-medium">Envoyer un WhatsApp de test</label>
                  <div className="flex gap-2">
                    <input
                      type="tel"
                      required
                      value={testWhatsAppPhone}
                      onChange={(e) => setTestWhatsAppPhone(e.target.value)}
                      placeholder="+2376XXXXXXXX"
                      className="flex-1 min-w-0 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                    />
                    <button
                      type="submit"
                      disabled={sendingTestWhatsApp}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-medium disabled:opacity-50 shrink-0"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      {sendingTestWhatsApp ? '...' : 'Tester'}
                    </button>
                  </div>
                </form>

                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
                  <div className="text-xs text-[#708197]">
                    Déclenche immédiatement les rappels RDV J-1, suivis du jour/en retard, tâches et examens (E-mail Resend + WhatsApp).
                  </div>
                  <button
                    type="button"
                    disabled={runningReminders}
                    onClick={handleRunRemindersNow}
                    className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg border border-[#1265A3] text-[#073B70] dark:text-sky-300 hover:bg-[#EAF4FC]/60 dark:hover:bg-slate-800 text-xs font-semibold disabled:opacity-50"
                  >
                    <Play className="w-3.5 h-3.5" />
                    {runningReminders ? 'Exécution des relances...' : 'Exécuter les relances maintenant'}
                  </button>
                  {infraStatus?.lastReminderRunAt && (
                    <div className="text-[11px] font-mono text-[#708197]">
                      Dernier cycle : {formatDateTimeFr(infraStatus.lastReminderRunAt)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Unified Resend & WhatsApp Dispatch Log Table */}
          <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <CheckCircle2 className="w-4 h-4 text-[#1265A3]" />
                Historique des envois Resend & WhatsApp ({emailLogs.length})
              </div>
              <button
                type="button"
                onClick={() => load(true)}
                className="inline-flex items-center gap-1 text-xs text-[#1265A3] hover:underline"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Actualiser
              </button>
            </div>
            {emailLogs.length === 0 ? (
              <div className="p-6 text-center text-xs text-[#708197]">
                Aucun envoi enregistré pour le moment. Utilisez « Tester » ou « Exécuter les relances maintenant » pour vérifier la délivrabilité.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 dark:bg-slate-900/60 text-[#708197] border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Date</th>
                      <th className="px-4 py-2.5 font-medium">Canal</th>
                      <th className="px-4 py-2.5 font-medium">Destinataire</th>
                      <th className="px-4 py-2.5 font-medium">Catégorie</th>
                      <th className="px-4 py-2.5 font-medium">Objet</th>
                      <th className="px-4 py-2.5 font-medium">Statut</th>
                      <th className="px-4 py-2.5 font-medium">ID / Détail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {emailLogs.slice(0, 30).map((log) => (
                      <tr key={log._id}>
                        <td className="px-4 py-2.5 font-mono text-[11px] whitespace-nowrap tabular-nums">
                          {formatDateTimeFr(log.createdAt)}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusBadge
                            label={
                              log.provider === 'WHATSAPP_CLOUD_API'
                                ? 'WhatsApp API'
                                : log.provider === 'WHATSAPP_CALLMEBOT'
                                ? 'CallMeBot'
                                : 'Resend'
                            }
                            tone={log.provider === 'RESEND' ? 'info' : 'success'}
                          />
                        </td>
                        <td className="px-4 py-2.5 font-mono">{log.recipientEmail}</td>
                        <td className="px-4 py-2.5">
                          <StatusBadge label={log.category} tone="neutral" />
                        </td>
                        <td className="px-4 py-2.5 max-w-xs truncate">{log.subject}</td>
                        <td className="px-4 py-2.5">
                          <StatusBadge
                            label={log.status}
                            tone={log.status === 'SENT' ? 'success' : log.status === 'FAILED' ? 'danger' : 'warning'}
                          />
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[11px] text-[#708197] max-w-xs truncate">
                          {log.providerMessageId || log.errorMessage || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : tab === 'audit' ? (
        <div className="space-y-4">
          <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Shield className="w-4 h-4 text-[#D71920]" />
              Journal d'audit & Événements de sécurité (Append-Only)
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <select
                value={severityFilter}
                onChange={(e) =>
                  navigate(
                    `/administration/audit${buildQuerySuffix({
                      gravite: e.target.value === 'ALL' ? undefined : e.target.value,
                    })}`
                  )
                }
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
              >
                <option value="ALL">Toutes gravités</option>
                <option value="SECURITY">Sécurité uniquement</option>
                <option value="WARNING">Avertissements</option>
                <option value="INFO">Informations</option>
              </select>
              <button
                type="button"
                disabled={exportingAudit}
                onClick={handleExportAuditCsv}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#073B70] hover:bg-[#1265A3] text-white text-xs font-medium disabled:opacity-60"
              >
                <Download className="w-3.5 h-3.5" />
                {exportingAudit ? 'Export en cours...' : 'Exporter Journal'}
              </button>
            </div>
          </div>
          <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {auditLogs.map((log) => (
                <div key={log._id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <div>
                    <div className="flex items-center gap-2">
                      <StatusBadge
                        label={log.severity}
                        tone={log.severity === 'SECURITY' ? 'danger' : log.severity === 'WARNING' ? 'warning' : 'neutral'}
                      />
                      <span className="font-mono font-semibold">{log.action}</span>
                      <span className="text-[#708197]">· {log.resourceType}</span>
                    </div>
                    <div className="mt-1 text-[#172B45] dark:text-slate-200">{log.details}</div>
                    <div className="text-[11px] text-[#708197]">Par {log.actorName} · IP {log.ipAddress || '—'}</div>
                  </div>
                  <div className="font-mono text-[11px] text-[#708197] tabular-nums whitespace-nowrap">
                    {formatDateTimeFr(log.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <Download className="w-5 h-5 text-[#073B70] dark:text-sky-300 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-base font-bold">Sauvegarde et restauration des données</h2>
                <p className="text-sm text-[#708197] mt-1 max-w-2xl">
                  Exportez un instantané JSON complet des dossiers administratifs, rendez-vous, examens, suivis, tâches, prestations, encaissements et du journal d'audit. La restauration s'effectue via les sauvegardes PostgreSQL Supabase et votre bucket Cloudflare R2 (conservation légale configurée : {settings?.archivingPolicyYears || 20} ans).
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={backingUp}
              onClick={handleDownloadBackup}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#073B70] hover:bg-[#1265A3] text-white text-sm font-medium disabled:opacity-60"
            >
              <Download className="w-4 h-4" />
              {backingUp ? 'Préparation de la sauvegarde...' : 'Télécharger sauvegarde (JSON)'}
            </button>
          </div>

          <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <Database className="w-5 h-5 text-[#D71920] shrink-0 mt-0.5" />
              <div>
                <h2 className="text-base font-bold">Réinitialiser les données fictives de démonstration</h2>
                <p className="text-sm text-[#708197] mt-1 max-w-2xl">
                  Cette action supprime uniquement les documents marqués comme démonstration (<code className="font-mono text-xs">isDemo == true</code>) et recrée les 3 comptes employés fictifs, 5 patients fictifs, 5 rendez-vous, 3 consultations, 5 examens, 4 suivis et 5 tâches. Vos données réelles de production et le journal d'audit sont intégralement préservés.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate('/administration/demonstration/reinitialiser')}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#D71920] hover:bg-red-700 text-white text-sm font-medium"
            >
              <RefreshCw className="w-4 h-4" />
              Réinitialiser l'environnement de démonstration
            </button>
          </div>
        </div>
      )}

      {/* Create User Modal */}
      <Modal open={isCreateUserUrl} onClose={() => navigate('/administration/utilisateurs')} title="Créer un compte utilisateur">
        <form onSubmit={handleCreateUser} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Titre</label>
              <input type="text" placeholder="Dr / Mme / M." value={userForm.title} onChange={(e) => setUserForm({ ...userForm, title: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Prénom *</label>
              <input type="text" required value={userForm.firstName} onChange={(e) => setUserForm({ ...userForm, firstName: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Nom *</label>
              <input type="text" required value={userForm.lastName} onChange={(e) => setUserForm({ ...userForm, lastName: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">E-mail *</label>
              <input type="email" required value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Identifiant *</label>
              <input type="text" required value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Spécialité / Poste</label>
              <input type="text" value={userForm.specialty} onChange={(e) => setUserForm({ ...userForm, specialty: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Mot de passe initial (min. 8 car.) *</label>
              <input type="password" required minLength={8} value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5">Rôles attribués (cumul autorisé, ex. Médecin + Administrateur)</label>
            <div className="flex flex-wrap gap-2">
              {(['ADMIN', 'MEDECIN', 'ACCUEIL'] as RoleCode[]).map((r) => (
                <label key={r} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs cursor-pointer">
                  <input type="checkbox" checked={userForm.roles.includes(r)} onChange={() => toggleRole(r)} />
                  {ROLE_LABELS[r]}
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => navigate('/administration/utilisateurs')} className="px-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700">Annuler</button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-[#073B70] text-white font-medium">Créer le compte</button>
          </div>
        </form>
      </Modal>

      {/* Edit User Modal */}
      <Modal
        open={Boolean(urlEditUserId && editTarget)}
        onClose={() => navigate('/administration/utilisateurs')}
        title={`Modifier — ${editTarget?.firstName || ''} ${editTarget?.lastName || ''}`}
        subtitle={`@${editTarget?.username || ''} · ${editTarget?.email || ''}`}
      >
        <form onSubmit={handleEditUser} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Titre</label>
              <input type="text" placeholder="Dr / Mme / M." value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Prénom *</label>
              <input type="text" required value={editForm.firstName} onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Nom *</label>
              <input type="text" required value={editForm.lastName} onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Spécialité / Poste</label>
              <input type="text" value={editForm.specialty} onChange={(e) => setEditForm({ ...editForm, specialty: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Téléphone</label>
              <input type="text" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5">Rôles attribués (cumul autorisé)</label>
            <div className="flex flex-wrap gap-2">
              {(['ADMIN', 'MEDECIN', 'ACCUEIL'] as RoleCode[]).map((r) => (
                <label key={r} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs cursor-pointer">
                  <input type="checkbox" checked={editForm.roles.includes(r)} onChange={() => toggleEditRole(r)} />
                  {ROLE_LABELS[r]}
                </label>
              ))}
            </div>
          </div>
          {editTarget?._id !== user._id && (
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={editForm.isActive} onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })} />
              Compte actif (autoriser la connexion)
            </label>
          )}
          <div>
            <label className="block text-xs font-medium mb-1">Réinitialiser le mot de passe (optionnel, min. 8 car.)</label>
            <input
              type="password"
              minLength={8}
              value={editForm.resetPassword}
              onChange={(e) => setEditForm({ ...editForm, resetPassword: e.target.value })}
              placeholder="Laisser vide pour conserver le mot de passe actuel"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => navigate('/administration/utilisateurs')} className="px-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700">Annuler</button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-[#073B70] text-white font-medium">
              {saving ? 'Enregistrement...' : 'Enregistrer les modifications'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        open={isResetDemoUrl}
        title="Réinitialiser les données de démonstration ?"
        message="Tous les enregistrements marqués comme démonstration seront remplacés par le jeu de données fictives initial. Vos dossiers de production resteront intacts."
        confirmLabel="Réinitialiser"
        danger
        loading={resetting}
        onConfirm={handleResetDemo}
        onCancel={() => navigate('/administration/demonstration')}
      />
    </div>
  );
};
