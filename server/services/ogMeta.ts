import type { Request } from 'express';
import { CLINIC_DEFAULTS } from '../../src/shared/constants';
import { repository } from '../repositories/SupabaseRepository';
import { isSupabaseConfigured } from '../config/env';

interface CachedClinicMeta {
  clinicName: string;
  leadDoctorName: string;
  city: string;
  slogan: string;
  phone: string;
  email: string;
  address: string;
  fetchedAt: number;
}

let clinicMetaCache: CachedClinicMeta | null = null;
const CACHE_TTL_MS = 15_000;

export function invalidateClinicMetaCache(): void {
  clinicMetaCache = null;
}

async function getClinicMeta(): Promise<CachedClinicMeta> {
  const now = Date.now();
  if (clinicMetaCache && now - clinicMetaCache.fetchedAt < CACHE_TTL_MS) {
    return clinicMetaCache;
  }

  let data = { ...CLINIC_DEFAULTS };
  if (isSupabaseConfigured()) {
    try {
      const settings = await repository.getClinicSettings();
      if (settings) {
        data = {
          ...CLINIC_DEFAULTS,
          clinicName: settings.clinicName || CLINIC_DEFAULTS.clinicName,
          leadDoctorName: settings.leadDoctorName || CLINIC_DEFAULTS.leadDoctorName,
          specialty: settings.specialty || CLINIC_DEFAULTS.specialty,
          city: settings.city || CLINIC_DEFAULTS.city,
          phone: settings.phone || CLINIC_DEFAULTS.phone,
          email: settings.email || CLINIC_DEFAULTS.email,
          address: settings.address || CLINIC_DEFAULTS.address,
          slogan: settings.slogan || CLINIC_DEFAULTS.slogan,
        };
      }
    } catch {
      // Fall back silently to official defaults so bots always get clean metadata
    }
  }

  clinicMetaCache = {
    clinicName: data.clinicName,
    leadDoctorName: data.leadDoctorName,
    city: data.city,
    slogan: data.slogan,
    phone: data.phone,
    email: data.email,
    address: data.address,
    fetchedAt: now,
  };
  return clinicMetaCache;
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function resolvePublicBaseUrl(req: Request): string {
  const envUrl = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (envUrl && /^https?:\/\//i.test(envUrl) && !envUrl.includes('MY_APP_URL')) {
    return envUrl;
  }
  const forwardedProto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim();
  const proto = forwardedProto || req.protocol || 'https';
  const forwardedHost = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim();
  const host = forwardedHost || req.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

function getNonPhiSectionLabel(pathname: string): string {
  const clean = pathname.toLowerCase();
  if (clean.startsWith('/login/activation-patient')) return 'Activation Espace Patient';
  if (clean.startsWith('/login/mot-de-passe-oublie')) return 'Récupération de mot de passe';
  if (clean.startsWith('/login')) return 'Connexion sécurisée';
  if (clean.startsWith('/patient/')) return 'Espace Patient';
  if (clean.startsWith('/patients')) return 'Dossiers Patients';
  if (clean.startsWith('/rendez-vous')) return 'Rendez-vous';
  if (clean.startsWith('/file-attente')) return "File d'attente";
  if (clean.startsWith('/consultations')) return 'Consultations cardiologiques';
  if (clean.startsWith('/examens')) return 'Examens cardiaques';
  if (clean.startsWith('/suivis')) return 'Suivis des patients';
  if (clean.startsWith('/taches')) return 'Tâches de coordination';
  if (clean.startsWith('/documents')) return 'Documents médicaux';
  if (clean.startsWith('/finances')) return 'Facturation & Prestations';
  if (clean.startsWith('/statistiques')) return 'Statistiques';
  if (clean.startsWith('/administration')) return 'Administration';
  if (clean.startsWith('/configuration-systeme')) return 'Configuration infrastructure';
  if (clean.startsWith('/tableau-de-bord')) return 'Tableau de bord';
  return 'CARDIO ERP';
}

function upsertMetaTag(html: string, attrName: 'property' | 'name', attrValue: string, content: string): string {
  const escapedContent = escapeHtmlAttr(content);
  const regex = new RegExp(
    `<meta\\b[^>]*\\b${attrName}=["']${attrValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`,
    'i'
  );
  const tag = `<meta ${attrName}="${attrValue}" content="${escapedContent}" />`;
  if (regex.test(html)) {
    return html.replace(regex, tag);
  }
  return html.replace('</head>', `    ${tag}\n  </head>`);
}

function upsertLinkTag(html: string, rel: string, href: string): string {
  const escapedHref = escapeHtmlAttr(href);
  const regex = new RegExp(`<link\\b[^>]*\\brel=["']${rel}["'][^>]*>`, 'i');
  const tag = `<link rel="${rel}" href="${escapedHref}" />`;
  if (regex.test(html)) {
    return html.replace(regex, tag);
  }
  return html.replace('</head>', `    ${tag}\n  </head>`);
}

export async function renderHtmlWithOpenGraph(rawHtml: string, req: Request): Promise<string> {
  const meta = await getClinicMeta();
  const baseUrl = resolvePublicBaseUrl(req);
  const canonicalUrl = `${baseUrl}${req.originalUrl || '/'}`;
  const ogLogoUrl = `${baseUrl}/api/settings/logo?og=1`;

  const section = getNonPhiSectionLabel(req.path || '/');
  const title = section === 'CARDIO ERP'
    ? `CARDIO ERP — ${meta.clinicName}`
    : `${section} — CARDIO ERP | ${meta.clinicName}`;

  const description = `« ${meta.slogan} » — ${meta.clinicName} (${meta.leadDoctorName} · ${meta.city}).`;

  let html = rawHtml;
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtmlAttr(title)}</title>`);
  html = upsertMetaTag(html, 'name', 'description', description);
  html = upsertMetaTag(html, 'property', 'og:site_name', meta.clinicName);
  html = upsertMetaTag(html, 'property', 'og:title', title);
  html = upsertMetaTag(html, 'property', 'og:description', description);
  html = upsertMetaTag(html, 'property', 'og:url', canonicalUrl);
  html = upsertMetaTag(html, 'property', 'og:image', ogLogoUrl);
  html = upsertMetaTag(html, 'property', 'og:image:secure_url', ogLogoUrl);
  html = upsertMetaTag(html, 'property', 'og:image:alt', `Logo officiel — ${meta.clinicName}`);
  html = upsertMetaTag(html, 'name', 'twitter:title', title);
  html = upsertMetaTag(html, 'name', 'twitter:description', description);
  html = upsertMetaTag(html, 'name', 'twitter:image', ogLogoUrl);
  html = upsertLinkTag(html, 'canonical', canonicalUrl);

  return html;
}
