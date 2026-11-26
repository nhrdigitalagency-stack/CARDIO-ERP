import { useEffect, useState } from 'react';
import type { NavModuleId } from '../components/LayoutShell';

export interface AppRouteState {
  pathname: string;
  search: string;
  segments: string[];
  query: URLSearchParams;
}

const ROUTE_CHANGE_EVENT = 'cardio:routechange';

function normalizePathname(raw: string): string {
  const withoutTrailing = raw.replace(/\/+$/, '');
  return withoutTrailing || '/';
}

export function getRouteState(): AppRouteState {
  const pathname = normalizePathname(window.location.pathname || '/');
  const search = window.location.search || '';
  const segments = pathname === '/' ? [] : pathname.slice(1).split('/').map((s) => decodeURIComponent(s));
  return {
    pathname,
    search,
    segments,
    query: new URLSearchParams(search),
  };
}

export function navigate(to: string, options?: { replace?: boolean }): void {
  const target = to.startsWith('/') ? to : `/${to}`;
  const current = `${normalizePathname(window.location.pathname || '/')}${window.location.search || ''}`;
  const [rawPath, rawSearch] = target.split('?');
  const normalizedTarget = `${normalizePathname(rawPath)}${rawSearch ? `?${rawSearch}` : ''}`;

  if (current === normalizedTarget) return;

  if (options?.replace) {
    window.history.replaceState(null, '', normalizedTarget);
  } else {
    window.history.pushState(null, '', normalizedTarget);
  }
  window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
}

export function useAppRoute(): AppRouteState {
  const [route, setRoute] = useState<AppRouteState>(() => getRouteState());

  useEffect(() => {
    const sync = () => setRoute(getRouteState());
    window.addEventListener('popstate', sync);
    window.addEventListener(ROUTE_CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(ROUTE_CHANGE_EVENT, sync);
    };
  }, []);

  return route;
}

export const MODULE_BASE_PATHS: Record<NavModuleId, string> = {
  dashboard: '/tableau-de-bord',
  'patient-portal': '/patient',
  queue: '/file-attente',
  appointments: '/rendez-vous',
  patients: '/patients',
  consultations: '/consultations',
  examinations: '/examens',
  'follow-ups': '/suivis',
  tasks: '/taches',
  documents: '/documents',
  finance: '/finances',
  statistics: '/statistiques',
  admin: '/administration',
};

export function resolveModuleFromPath(pathname: string): NavModuleId | null {
  const first = normalizePathname(pathname).slice(1).split('/')[0]?.toLowerCase() || '';
  switch (first) {
    case 'tableau-de-bord':
      return 'dashboard';
    case 'patient':
      return 'patient-portal';
    case 'file-attente':
      return 'queue';
    case 'rendez-vous':
      return 'appointments';
    case 'patients':
      return 'patients';
    case 'consultations':
      return 'consultations';
    case 'examens':
      return 'examinations';
    case 'suivis':
      return 'follow-ups';
    case 'taches':
      return 'tasks';
    case 'documents':
      return 'documents';
    case 'finances':
      return 'finance';
    case 'statistiques':
      return 'statistics';
    case 'administration':
      return 'admin';
    default:
      return null;
  }
}

export function isAuthPath(pathname: string): boolean {
  const first = normalizePathname(pathname).slice(1).split('/')[0]?.toLowerCase() || '';
  return first === 'login' || first === 'configuration-systeme';
}

export type PatientTabKey =
  | 'overview'
  | 'personal'
  | 'histories'
  | 'allergies'
  | 'medications'
  | 'consultations'
  | 'vitals'
  | 'examinations'
  | 'results'
  | 'prescriptions'
  | 'appointments'
  | 'followups'
  | 'documents'
  | 'payments'
  | 'audit';

export const PATIENT_TAB_TO_SLUG: Record<PatientTabKey, string> = {
  overview: 'resume',
  personal: 'infos-personnelles',
  histories: 'antecedents',
  allergies: 'allergies',
  medications: 'traitements',
  consultations: 'consultations',
  vitals: 'constantes',
  examinations: 'examens',
  results: 'resultats',
  prescriptions: 'prescriptions',
  appointments: 'rendez-vous',
  followups: 'suivis',
  documents: 'documents',
  payments: 'paiements',
  audit: 'historique',
};

export const PATIENT_SLUG_TO_TAB: Record<string, PatientTabKey> = Object.fromEntries(
  Object.entries(PATIENT_TAB_TO_SLUG).map(([k, v]) => [v, k as PatientTabKey])
) as Record<string, PatientTabKey>;

export function buildQuerySuffix(params: Record<string, string | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      sp.set(k, String(v));
    }
  }
  const str = sp.toString();
  return str ? `?${str}` : '';
}
