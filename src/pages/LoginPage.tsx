import React, { useState } from 'react';
import {
  Database,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  ShieldAlert,
  UserCheck,
} from 'lucide-react';
import { ClinicLogo } from '../components/ClinicLogo';
import { Modal } from '../components/UIPrimitives';
import { CLINIC_DEFAULTS } from '../shared/constants';
import type { PublicUser, SystemStatusResponse } from '../shared/types';
import { apiFetch, setMemoryCsrfToken, setSessionToken } from '../lib/api';
import { navigate, useAppRoute } from '../lib/router';

interface LoginPageProps {
  systemStatus: SystemStatusResponse;
  onLoginSuccess: (user: PublicUser) => void;
  onSystemRefresh: () => Promise<void>;
  darkMode: boolean;
  onToggleDark: () => void;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  systemStatus,
  onLoginSuccess,
  onSystemRefresh,
  darkMode,
  onToggleDark,
  notify,
}) => {
  const route = useAppRoute();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [bootstrapping, setBootstrapping] = useState(false);
  const [adminForm, setAdminForm] = useState({
    title: 'Dr',
    firstName: '',
    lastName: '',
    email: '',
    username: '',
    password: '',
  });

  const forgotOpen = route.pathname === '/login/mot-de-passe-oublie';
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSubmitting, setForgotSubmitting] = useState(false);

  const activateOpen = route.pathname === '/login/activation-patient';
  const [actForm, setActForm] = useState({
    email: '',
    patientNumber: '',
    birthDate: '',
    password: '',
  });
  const [actSubmitting, setActSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch<{ user: PublicUser; csrfToken?: string; sessionToken?: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier, password }),
      });
      setSessionToken(res.sessionToken);
      setMemoryCsrfToken(res.csrfToken);
      notify('success', `Bienvenue, ${res.user.firstName} ${res.user.lastName}`);
      onLoginSuccess(res.user);
    } catch (err: any) {
      setError(err.message || 'Identifiant ou mot de passe incorrect.');
    } finally {
      setLoading(false);
    }
  };

  const handleBootstrapAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBootstrapping(true);
    setError('');
    try {
      const res = await apiFetch<{ ok: boolean; email: string; username: string }>('/api/system/bootstrap-admin', {
        method: 'POST',
        body: JSON.stringify(adminForm),
      });
      notify('success', 'Compte administrateur initial créé avec succès. Connectez-vous pour démarrer.');
      setIdentifier(res.email || adminForm.email);
      setPassword('');
      await onSystemRefresh();
    } catch (err: any) {
      setError(err.message || "Impossible de créer le compte administrateur initial.");
    } finally {
      setBootstrapping(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotSubmitting(true);
    try {
      const res = await apiFetch<{ message: string }>('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: forgotEmail }),
      });
      notify('info', res.message);
      navigate('/login');
      setForgotEmail('');
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setForgotSubmitting(false);
    }
  };

  const handleActivateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActSubmitting(true);
    try {
      const res = await apiFetch<{ message: string; username: string }>('/api/auth/activate-patient', {
        method: 'POST',
        body: JSON.stringify(actForm),
      });
      notify('success', res.message);
      setIdentifier(actForm.email);
      navigate('/login');
    } catch (err: any) {
      notify('error', err.message);
    } finally {
      setActSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F4F7FB] dark:bg-[#0B1320] flex flex-col justify-between p-4 sm:p-6">
      <div className="flex justify-end max-w-5xl w-full mx-auto">
        <button
          type="button"
          onClick={onToggleDark}
          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#131E30] text-[#172B45] dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          {darkMode ? 'Thème clair' : 'Thème sombre'}
        </button>
      </div>

      <div className="max-w-5xl w-full mx-auto my-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        {/* Left Clinic Identity Panel */}
        <div className="lg:col-span-5 bg-[#073B70] text-white rounded-2xl p-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3.5">
              <ClinicLogo size="lg" />
              <div>
                <div className="font-display font-bold text-2xl tracking-tight">CARDIO ERP</div>
                <div className="text-xs text-sky-200">Système de gestion cardiologique</div>
              </div>
            </div>

            <div className="mt-8 space-y-2">
              <h1 className="text-xl font-bold leading-snug text-balance">
                {CLINIC_DEFAULTS.clinicName}
              </h1>
              <p className="text-sm text-sky-100/90">
                Direction médicale : {CLINIC_DEFAULTS.leadDoctorName} — {CLINIC_DEFAULTS.specialty}
              </p>
              <p className="text-xs text-sky-200/80 leading-relaxed pt-2">
                « {CLINIC_DEFAULTS.slogan} »
              </p>
            </div>
          </div>

          <div className="mt-10 pt-6 border-t border-white/15 space-y-1.5 text-xs text-sky-100/85">
            <div>{CLINIC_DEFAULTS.address}</div>
            <div>{CLINIC_DEFAULTS.city}</div>
            <div className="font-mono pt-1">
              {CLINIC_DEFAULTS.phone} · {CLINIC_DEFAULTS.email}
            </div>
          </div>
        </div>

        {/* Right Authentication Form */}
        <div className="lg:col-span-7 bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-2xl p-8 flex flex-col justify-center">
          <div>
            <h2 className="text-2xl font-bold text-[#172B45] dark:text-white">
              {!systemStatus.hasAnyUsers ? 'Configuration du compte administrateur' : 'Connexion sécurisée'}
            </h2>
            <p className="text-sm text-[#708197] dark:text-slate-400 mt-1">
              {!systemStatus.hasAnyUsers
                ? 'Créez le premier compte direction / médecin administrateur pour initialiser le cabinet.'
                : 'Accédez à votre espace professionnel ou portail patient.'}
            </p>
          </div>

          {error && (
            <div className="mt-5 p-3.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 flex items-center gap-2.5 text-sm text-[#D71920] dark:text-red-300">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!systemStatus.hasAnyUsers ? (
            <form onSubmit={handleBootstrapAdmin} className="mt-6 space-y-4">
              <div className="p-3.5 rounded-xl bg-[#EAF4FC] dark:bg-[#073B70]/35 border border-[#1265A3]/30 flex items-start gap-3">
                <Database className="w-5 h-5 text-[#073B70] dark:text-sky-300 shrink-0 mt-0.5" />
                <div className="text-xs text-[#073B70] dark:text-sky-100">
                  <div className="font-semibold">Base Supabase connectée — Première mise en service</div>
                  <p className="mt-0.5 opacity-90">
                    Ce formulaire n'est accessible qu'une seule fois. Dès ce compte créé, la gestion des autres comptes se fait depuis l'espace Administration.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Titre</label>
                  <input
                    type="text"
                    value={adminForm.title}
                    onChange={(e) => setAdminForm({ ...adminForm, title: e.target.value })}
                    placeholder="Dr"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Prénom *</label>
                  <input
                    type="text"
                    required
                    value={adminForm.firstName}
                    onChange={(e) => setAdminForm({ ...adminForm, firstName: e.target.value })}
                    placeholder="Paulin"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Nom *</label>
                  <input
                    type="text"
                    required
                    value={adminForm.lastName}
                    onChange={(e) => setAdminForm({ ...adminForm, lastName: e.target.value })}
                    placeholder="MBAPPE"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Adresse e-mail professionnelle *</label>
                  <input
                    type="email"
                    required
                    value={adminForm.email}
                    onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })}
                    placeholder="direction@cardiologie-paris16.cm"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Identifiant de connexion *</label>
                  <input
                    type="text"
                    required
                    value={adminForm.username}
                    onChange={(e) => setAdminForm({ ...adminForm, username: e.target.value })}
                    placeholder="dr.mbappe"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Mot de passe (minimum 8 caractères) *</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={adminForm.password}
                  onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })}
                  placeholder="Choisissez un mot de passe robuste"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={bootstrapping}
                className="w-full py-2.5 px-4 rounded-lg bg-[#073B70] hover:bg-[#1265A3] text-white font-medium text-sm transition-colors disabled:opacity-50"
              >
                {bootstrapping ? 'Initialisation en cours...' : 'Créer le compte administrateur initial'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#172B45] dark:text-slate-200 mb-1.5">
                  Nom d’utilisateur ou adresse e-mail
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="ex. dr.mbappe ou direction@cardiologie-paris16.cm"
                    className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-[#172B45] dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1265A3]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#172B45] dark:text-slate-200 mb-1.5">
                  Mot de passe
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full pl-10 pr-11 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-[#172B45] dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1265A3]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
                    aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs pt-1">
                <button
                  type="button"
                  onClick={() => navigate('/login/mot-de-passe-oublie')}
                  className="text-[#1265A3] dark:text-sky-400 hover:underline font-medium"
                >
                  Mot de passe oublié ?
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/login/activation-patient')}
                  className="inline-flex items-center gap-1 text-[#073B70] dark:text-sky-300 hover:underline font-medium"
                >
                  <UserCheck className="w-3.5 h-3.5" />
                  Activer mon espace patient
                </button>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-lg bg-[#073B70] hover:bg-[#1265A3] text-white font-medium text-sm transition-colors disabled:opacity-50"
              >
                {loading ? 'Authentification en cours...' : 'Se connecter à CARDIO ERP'}
              </button>
            </form>
          )}
        </div>
      </div>

      <footer className="max-w-5xl w-full mx-auto text-center text-xs text-[#708197] dark:text-slate-500">
        CARDIO ERP · {CLINIC_DEFAULTS.clinicName} · Plateforme de gestion cardiologique sécurisée
      </footer>

      <Modal
        open={forgotOpen}
        onClose={() => navigate('/login')}
        title="Récupération sécurisée du mot de passe"
        subtitle="Une demande de réinitialisation sera transmise à l'administrateur du cabinet."
        maxWidth="max-w-md"
      >
        <form onSubmit={handleForgotSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">Adresse e-mail du compte</label>
            <input
              type="email"
              required
              value={forgotEmail}
              onChange={(e) => setForgotEmail(e.target.value)}
              placeholder="nom@domaine.cm"
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => navigate('/login')}
              className="px-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={forgotSubmitting}
              className="px-4 py-2 text-sm rounded-lg bg-[#073B70] text-white font-medium disabled:opacity-50"
            >
              {forgotSubmitting ? 'Envoi...' : 'Transmettre la demande'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={activateOpen}
        onClose={() => navigate('/login')}
        title="Activer votre espace personnel patient"
        subtitle="Réservé aux patients ayant reçu une invitation de l'accueil du cabinet."
        maxWidth="max-w-md"
      >
        <form onSubmit={handleActivateSubmit} className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium mb-1">Numéro de dossier patient</label>
            <input
              type="text"
              required
              value={actForm.patientNumber}
              onChange={(e) => setActForm({ ...actForm, patientNumber: e.target.value })}
              placeholder="PAT-00001"
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Adresse e-mail communiquée à l'accueil</label>
            <input
              type="email"
              required
              value={actForm.email}
              onChange={(e) => setActForm({ ...actForm, email: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Date de naissance</label>
            <input
              type="date"
              required
              value={actForm.birthDate}
              onChange={(e) => setActForm({ ...actForm, birthDate: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Choisir un mot de passe (min. 8 caractères)</label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                minLength={8}
                value={actForm.password}
                onChange={(e) => setActForm({ ...actForm, password: e.target.value })}
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => navigate('/login')}
              className="px-4 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={actSubmitting}
              className="px-4 py-2 text-sm rounded-lg bg-[#073B70] text-white font-medium disabled:opacity-50"
            >
              {actSubmitting ? 'Activation...' : 'Activer mon compte'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
