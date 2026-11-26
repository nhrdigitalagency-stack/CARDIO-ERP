import { ROLE_PERMISSIONS } from '../shared/constants';
import type { Permission, PublicUser, RoleCode } from '../shared/types';

const SESSION_STORAGE_KEY = 'cardio_erp_session_token';
let memoryCsrfToken: string | null = null;
let memorySessionToken: string | null = null;

function readStoredSessionToken(): string | null {
  if (memorySessionToken) return memorySessionToken;
  try {
    const stored = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (stored) {
      memorySessionToken = stored;
      return stored;
    }
  } catch {
    // Sandboxed iframe may disallow sessionStorage; memory token still works
  }
  return null;
}

export function setSessionToken(token: string | null | undefined) {
  memorySessionToken = token || null;
  try {
    if (token) {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, token);
    } else {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // Ignore storage restriction
  }
}

export function getSessionToken(): string | null {
  return readStoredSessionToken();
}

export function getAuthHeaders(): Record<string, string> {
  const token = readStoredSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function setMemoryCsrfToken(token: string | null | undefined) {
  memoryCsrfToken = token || null;
}

export function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[2]) : null;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  data?: any;

  constructor(message: string, status: number, code?: string, data?: any) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export async function apiFetch<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});

  const sessionToken = readStoredSessionToken();
  if (sessionToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${sessionToken}`);
  }

  if (!(options.body instanceof FormData) && !headers.has('Content-Type') && method !== 'GET') {
    headers.set('Content-Type', 'application/json');
  }

  if (method !== 'GET' && method !== 'HEAD') {
    const csrf = getCookie('cardio_erp_csrf') || memoryCsrfToken;
    if (csrf) {
      headers.set('X-CSRF-Token', csrf);
    }
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    const msg = typeof data === 'object' && data?.error ? data.error : `Erreur HTTP ${res.status}`;
    if (res.status === 401 && !url.startsWith('/api/auth/')) {
      setSessionToken(null);
      setMemoryCsrfToken(null);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('cardio:unauthorized'));
      }
    }
    throw new ApiError(msg, res.status, data?.code, data);
  }

  return data as T;
}

export async function downloadProtectedFile(url: string, fallbackFileName = 'document'): Promise<void> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    let msg = `Téléchargement impossible (HTTP ${res.status})`;
    try {
      const errJson = await res.json();
      if (errJson?.error) msg = errJson.error;
    } catch {
      // Ignore JSON parse error
    }
    throw new ApiError(msg, res.status);
  }

  const disposition = res.headers.get('content-disposition') || '';
  const nameMatch = disposition.match(/filename="?([^";]+)"?/i);
  const fileName = nameMatch ? decodeURIComponent(nameMatch[1]) : fallbackFileName;

  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
}

export function hasPerm(user: PublicUser | null | undefined, perm: Permission): boolean {
  if (!user) return false;
  for (const role of user.roles) {
    if (ROLE_PERMISSIONS[role]?.includes(perm)) return true;
  }
  return false;
}

export function hasAnyPerm(user: PublicUser | null | undefined, perms: Permission[]): boolean {
  return perms.some((p) => hasPerm(user, p));
}

export function isRoleOnly(user: PublicUser | null | undefined, role: RoleCode): boolean {
  return Boolean(user && user.roles.length === 1 && user.roles[0] === role);
}

export function formatFcfa(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return 'Non configuré';
  return `${new Intl.NumberFormat('fr-FR').format(amount)} FCFA`;
}

export function calculateAge(birthDate: string | undefined): string {
  if (!birthDate) return '—';
  const dob = new Date(birthDate);
  if (Number.isNaN(dob.getTime())) return '—';
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return `${age} ans`;
}

export function formatDateFr(dateStr: string | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTimeFr(dateStr: string | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
