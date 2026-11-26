import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clipboard,
  ClipboardCheck,
  Cloud,
  Database,
  Mail,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import type { SystemStatusResponse } from '../shared/types';
import { ClinicLogo } from '../components/ClinicLogo';
import { CLINIC_DEFAULTS } from '../shared/constants';
import { apiFetch } from '../lib/api';

interface InfrastructureSetupPageProps {
  status: SystemStatusResponse;
  onConnected: () => Promise<void>;
  darkMode: boolean;
  onToggleDark: () => void;
}

const ENV_BLOCKS = [
  {
    title: '1. Supabase (PostgreSQL relationnel + RLS)',
    required: true,
    vars: [
      { key: 'SUPABASE_URL', hint: 'https://votre-projet.supabase.co' },
      { key: 'SUPABASE_SERVICE_ROLE_KEY', hint: 'Clé service_role (Settings → API)' },
      { key: 'SUPABASE_ANON_KEY', hint: 'Clé anon / public (optionnel côté serveur)' },
      { key: 'SESSION_SECRET', hint: 'Secret aléatoire 64 caractères (openssl rand -hex 32)' },
    ],
  },
  {
    title: '2. Cloudflare R2 (Stockage fichiers médicaux & logos)',
    required: false,
    vars: [
      { key: 'R2_ACCOUNT_ID', hint: 'Identifiant compte Cloudflare (32 caractères)' },
      { key: 'R2_ACCESS_KEY_ID', hint: 'Clé d’accès API R2 (Object Read & Write)' },
      { key: 'R2_SECRET_ACCESS_KEY', hint: 'Clé secrète API R2' },
      { key: 'R2_BUCKET_NAME', hint: 'Nom du bucket privé (ex: cardio-erp-documents)' },
    ],
  },
  {
    title: '3. Resend (Notifications e-mail & relances automatiques)',
    required: false,
    vars: [
      { key: 'RESEND_API_KEY', hint: 'Clé API Resend commençant par re_...' },
      { key: 'RESEND_FROM_EMAIL', hint: 'Cabinet Cardiologie Paris 16 <notifications@votre-domaine.cm>' },
      { key: 'APP_URL', hint: 'URL publique de votre application CARDIO ERP' },
    ],
  },
];

export const InfrastructureSetupPage: React.FC<InfrastructureSetupPageProps> = ({
  status,
  onConnected,
  darkMode,
  onToggleDark,
}) => {
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [schemaSql, setSchemaSql] = useState<string>('');
  const [showSql, setShowSql] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  useEffect(() => {
    apiFetch<{ sql: string }>('/api/system/schema-sql')
      .then((res) => setSchemaSql(res.sql))
      .catch(() => undefined);
  }, []);

  const handleTest = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const res = await apiFetch<{
        ok: boolean;
        supabase: { ok: boolean; schemaReady?: boolean; error?: string };
        r2: { configured: boolean; ok: boolean; error?: string };
        resend: { configured: boolean };
      }>('/api/system/test-connections', { method: 'POST' });

      if (res.ok) {
        setMessage({
          type: 'success',
          text: 'Supabase connecté et schéma RLS détecté ! Redirection vers la connexion...',
        });
        await onConnected();
      } else {
        setMessage({
          type: 'error',
          text: res.supabase.error || 'Connexion Supabase ou schéma SQL incomplet.',
        });
        await onConnected();
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Échec du test de connexion.' });
    } finally {
      setTesting(false);
    }
  };

  const handleCopySql = async () => {
    if (!schemaSql) return;
    try {
      await navigator.clipboard.writeText(schemaSql);
      setCopiedSql(true);
      setTimeout(() => setCopiedSql(false), 2500);
    } catch {
      setShowSql(true);
    }
  };

  const supabaseOk = status.supabaseConfigured && status.supabaseConnected && status.supabaseSchemaReady;

  return (
    <div className="min-h-screen bg-[#F4F7FB] dark:bg-[#0B1320] text-[#172B45] dark:text-slate-100 flex flex-col">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0F1827] px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ClinicLogo size="md" />
            <div>
              <div className="font-display font-bold text-lg text-[#073B70] dark:text-sky-300">
                CARDIO ERP
              </div>
              <div className="text-xs text-[#708197] dark:text-slate-400">
                {CLINIC_DEFAULTS.clinicName} · Architecture Supabase + Cloudflare R2 + Resend
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onToggleDark}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            {darkMode ? 'Mode clair' : 'Mode sombre'}
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Top Hero Diagnostics Card */}
        <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-[#EAF4FC] dark:bg-[#073B70]/40 text-[#073B70] dark:text-sky-300 flex items-center justify-center shrink-0">
                <Database className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-[#073B70] dark:text-white">
                  Configuration de l'infrastructure Supabase, Cloudflare R2 & Resend
                </h1>
                <p className="text-sm text-[#708197] dark:text-slate-400 mt-1 max-w-2xl">
                  CARDIO ERP est connecté directement à votre base PostgreSQL <strong>Supabase (avec RLS)</strong>, stocke vos fichiers médicaux sur <strong>Cloudflare R2</strong> et envoie vos notifications et relances automatiques via <strong>Resend</strong>.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleTest}
              disabled={testing}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#073B70] hover:bg-[#1265A3] text-white text-sm font-medium transition-colors disabled:opacity-60 shrink-0"
            >
              <RefreshCw className={`w-4 h-4 ${testing ? 'animate-spin' : ''}`} />
              {testing ? 'Vérification...' : 'Tester les connexions'}
            </button>
          </div>

          {/* 3-Service Status Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Supabase */}
            <div
              className={`p-4 rounded-xl border ${
                supabaseOk
                  ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900'
                  : 'bg-red-50/70 dark:bg-red-950/30 border-red-200 dark:border-red-900'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold text-sm">
                  <Database className="w-4 h-4 text-[#073B70] dark:text-sky-300" />
                  Supabase + RLS
                </div>
                {supabaseOk ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-[#D71920]" />
                )}
              </div>
              <p className="text-xs text-[#708197] dark:text-slate-300 mt-2">
                {supabaseOk
                  ? 'Connecté et tables relationnelles prêtes.'
                  : !status.supabaseConfigured
                  ? 'Variables SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY manquantes.'
                  : !status.supabaseSchemaReady
                  ? status.supabaseError || 'Base joignable mais le script supabase/schema.sql doit être exécuté.'
                  : status.supabaseError || 'Connexion Supabase échouée.'}
              </p>
            </div>

            {/* Cloudflare R2 */}
            <div
              className={`p-4 rounded-xl border ${
                status.r2Connected
                  ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900'
                  : 'bg-amber-50/70 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold text-sm">
                  <Cloud className="w-4 h-4 text-[#1265A3] dark:text-sky-300" />
                  Cloudflare R2
                </div>
                {status.r2Connected ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                )}
              </div>
              <p className="text-xs text-[#708197] dark:text-slate-300 mt-2">
                {status.r2Connected
                  ? `Bucket "${status.r2BucketName}" opérationnel.`
                  : !status.r2Configured
                  ? 'Non configuré — requis pour le téléversement des documents médicaux et du logo.'
                  : status.r2Error || 'Échec de connexion au bucket R2.'}
              </p>
            </div>

            {/* Resend */}
            <div
              className={`p-4 rounded-xl border ${
                status.resendConfigured
                  ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900'
                  : 'bg-amber-50/70 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold text-sm">
                  <Mail className="w-4 h-4 text-[#D71920]" />
                  Resend & Relances
                </div>
                {status.resendConfigured ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                )}
              </div>
              <p className="text-xs text-[#708197] dark:text-slate-300 mt-2">
                {status.resendConfigured
                  ? `Prêt (${status.resendFromEmail || 'expéditeur configuré'}).`
                  : 'Variable RESEND_API_KEY manquante — requise pour les e-mails et relances automatiques.'}
              </p>
            </div>
          </div>

          {message && (
            <div
              className={`p-4 rounded-xl text-sm flex items-start gap-3 ${
                message.type === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-900'
                  : 'bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-900'
              }`}
            >
              {message.type === 'success' ? (
                <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              )}
              <span>{message.text}</span>
            </div>
          )}
        </div>

        {/* Step 1: SQL Schema + RLS */}
        <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-[#073B70] dark:text-white flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#1265A3]" />
                Étape A : Créer les 23 tables relationnelles et politiques RLS dans Supabase
              </h2>
              <p className="text-xs text-[#708197] dark:text-slate-400 mt-0.5">
                Ouvrez votre projet Supabase → <strong>SQL Editor</strong> → <strong>New Query</strong>, collez le script <code className="font-mono">supabase/schema.sql</code> puis cliquez sur <strong>Run</strong>.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowSql((s) => !s)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                {showSql ? 'Masquer le SQL' : 'Afficher le script SQL'}
              </button>
              <button
                type="button"
                onClick={handleCopySql}
                disabled={!schemaSql}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#073B70] hover:bg-[#1265A3] text-white text-xs font-medium disabled:opacity-50"
              >
                {copiedSql ? <ClipboardCheck className="w-3.5 h-3.5" /> : <Clipboard className="w-3.5 h-3.5" />}
                {copiedSql ? 'Script SQL copié !' : 'Copier supabase/schema.sql'}
              </button>
            </div>
          </div>

          {showSql && schemaSql && (
            <pre className="p-4 rounded-xl bg-slate-950 text-slate-100 text-[11px] font-mono overflow-x-auto max-h-96 leading-relaxed">
              {schemaSql}
            </pre>
          )}
        </div>

        {/* Step 2: Environment Secrets */}
        <div className="bg-white dark:bg-[#131E30] border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5">
          <div>
            <h2 className="text-sm font-bold text-[#073B70] dark:text-white">
              Étape B : Variables d'environnement serveur (Secrets)
            </h2>
            <p className="text-xs text-[#708197] dark:text-slate-400 mt-0.5">
              Renseignez ces clés uniquement côté serveur (dans <strong>Settings → Secrets</strong> ou votre fichier <code className="font-mono">.env</code>). Elles ne sont jamais exposées au navigateur.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {ENV_BLOCKS.map((block) => (
              <div
                key={block.title}
                className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-[#F8FBFE] dark:bg-[#0F1827] space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-bold text-[#073B70] dark:text-sky-300">{block.title}</h3>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${
                      block.required
                        ? 'bg-red-100 text-[#D71920] dark:bg-red-950/60 dark:text-red-300'
                        : 'bg-sky-100 text-[#1265A3] dark:bg-sky-950/60 dark:text-sky-300'
                    }`}
                  >
                    {block.required ? 'Requis' : 'Recommandé'}
                  </span>
                </div>
                <div className="space-y-2">
                  {block.vars.map((v) => {
                    const missing = status.missingEnvVars.includes(v.key);
                    return (
                      <div key={v.key} className="text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <code className="font-mono font-semibold text-[11px] text-[#172B45] dark:text-slate-200">
                            {v.key}
                          </code>
                          {block.required && (
                            <span
                              className={`text-[10px] font-medium ${
                                missing ? 'text-[#D71920]' : 'text-emerald-600 dark:text-emerald-400'
                              }`}
                            >
                              {missing ? 'Manquant' : 'Défini'}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-[#708197] dark:text-slate-400">{v.hint}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
};
