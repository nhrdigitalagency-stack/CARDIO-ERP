import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getEnvConfig } from '../config/env';
import { ROLE_PERMISSIONS } from '../../src/shared/constants';
import type { Permission, PublicUser, RoleCode, User } from '../../src/shared/types';

export const SESSION_COOKIE_NAME = 'cardio_erp_session';
export const CSRF_COOKIE_NAME = 'cardio_erp_csrf';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 heures

export interface SessionPayload {
  userId: string;
  roles: RoleCode[];
  patientId?: string;
  exp: number;
  jti: string;
}

// In-memory revoked token list & active login attempt rate limiter
const revokedJtis = new Set<string>();
const loginAttempts = new Map<string, { count: number; firstAttemptAt: number; lockedUntil?: number }>();

const MAX_LOGIN_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LOCK_DURATION_MS = 10 * 60 * 1000;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

export function signSessionToken(user: PublicUser): string {
  const { sessionSecret } = getEnvConfig();
  const payload: SessionPayload = {
    userId: user._id,
    roles: user.roles,
    patientId: user.patientId,
    exp: Date.now() + SESSION_TTL_MS,
    jti: crypto.randomUUID(),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', sessionSecret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string | undefined): SessionPayload | null {
  if (!token || !token.includes('.')) return null;
  const [encoded, sig] = token.split('.');
  if (!encoded || !sig) return null;

  const { sessionSecret } = getEnvConfig();
  const expectedSig = crypto.createHmac('sha256', sessionSecret).update(encoded).digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload.userId || !payload.exp || Date.now() > payload.exp) {
      return null;
    }
    if (revokedJtis.has(payload.jti)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function revokeSessionToken(token: string | undefined): void {
  const payload = verifySessionToken(token);
  if (payload?.jti) {
    revokedJtis.add(payload.jti);
  }
}

export function generateCsrfToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

export function checkLoginRateLimit(key: string): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const record = loginAttempts.get(key);
  if (!record) return { allowed: true };

  if (record.lockedUntil && now < record.lockedUntil) {
    return { allowed: false, retryAfterSeconds: Math.ceil((record.lockedUntil - now) / 1000) };
  }

  if (now - record.firstAttemptAt > ATTEMPT_WINDOW_MS) {
    loginAttempts.delete(key);
    return { allowed: true };
  }

  return { allowed: true };
}

export function recordFailedLogin(key: string): { locked: boolean; remainingAttempts: number } {
  const now = Date.now();
  const existing = loginAttempts.get(key);
  if (!existing || now - existing.firstAttemptAt > ATTEMPT_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, firstAttemptAt: now });
    return { locked: false, remainingAttempts: MAX_LOGIN_ATTEMPTS - 1 };
  }

  existing.count += 1;
  if (existing.count >= MAX_LOGIN_ATTEMPTS) {
    existing.lockedUntil = now + LOCK_DURATION_MS;
    loginAttempts.set(key, existing);
    return { locked: true, remainingAttempts: 0 };
  }

  loginAttempts.set(key, existing);
  return { locked: false, remainingAttempts: Math.max(0, MAX_LOGIN_ATTEMPTS - existing.count) };
}

export function clearFailedLogins(key: string): void {
  loginAttempts.delete(key);
}

export function getPermissionsForRoles(roles: RoleCode[]): Set<Permission> {
  const perms = new Set<Permission>();
  for (const role of roles) {
    const list = ROLE_PERMISSIONS[role] || [];
    for (const p of list) {
      perms.add(p);
    }
  }
  return perms;
}

export function hasPermission(roles: RoleCode[], permission: Permission): boolean {
  return getPermissionsForRoles(roles).has(permission);
}

export function hasAnyPermission(roles: RoleCode[], permissions: Permission[]): boolean {
  const userPerms = getPermissionsForRoles(roles);
  return permissions.some((p) => userPerms.has(p));
}

export function sanitizeUser(user: User): PublicUser {
  const { passwordHash: _removed, ...rest } = user;
  return rest;
}
