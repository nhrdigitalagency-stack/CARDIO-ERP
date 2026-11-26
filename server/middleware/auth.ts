import type { NextFunction, Request, Response } from 'express';
import { isSupabaseConfigured } from '../config/env';
import { repository } from '../repositories/SupabaseRepository';
import {
  CSRF_COOKIE_NAME,
  hasAnyPermission,
  hasPermission,
  sanitizeUser,
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from '../services/security';
import type { Permission, PublicUser } from '../../src/shared/types';

declare global {
  namespace Express {
    interface Request {
      user?: PublicUser;
      clientIp?: string;
      authSource?: 'cookie' | 'bearer';
    }
  }
}

export function requireSupabaseConfigured(_req: Request, res: Response, next: NextFunction) {
  if (!isSupabaseConfigured()) {
    return res.status(503).json({
      error: 'Base de données Supabase non configurée. Veuillez renseigner SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY.',
      code: 'SUPABASE_NOT_CONFIGURED',
    });
  }
  return next();
}

export function extractBearerToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    return token || undefined;
  }
  return undefined;
}

export async function authenticateRequest(req: Request, _res: Response, next: NextFunction) {
  req.clientIp =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    'unknown';

  if (!isSupabaseConfigured()) {
    return next();
  }

  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];
  const bearerToken = extractBearerToken(req);

  let payload = verifySessionToken(cookieToken);
  let source: 'cookie' | 'bearer' | undefined = payload ? 'cookie' : undefined;

  if (!payload && bearerToken) {
    payload = verifySessionToken(bearerToken);
    if (payload) {
      source = 'bearer';
    }
  }

  if (!payload) {
    return next();
  }

  try {
    const user = await repository.findUserById(payload.userId);
    if (user && user.isActive) {
      req.user = sanitizeUser(user);
      req.authSource = source;
    }
  } catch {
    // Let downstream requireAuth handle unauthenticated state
  }
  return next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentification requise. Veuillez vous connecter.',
      code: 'UNAUTHORIZED',
    });
  }
  return next();
}

export function requireCsrf(req: Request, res: Response, next: NextFunction) {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) return next();

  // Non-ambient Authorization: Bearer header cannot be forged by cross-site CSRF
  if (req.authSource === 'bearer') {
    return next();
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.headers['x-csrf-token'];
  if (!cookieToken || typeof headerToken !== 'string' || cookieToken !== headerToken) {
    return res.status(403).json({
      error: 'Jeton CSRF invalide ou manquant. Rechargez la page et réessayez.',
      code: 'CSRF_INVALID',
    });
  }
  return next();
}

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentification requise.', code: 'UNAUTHORIZED' });
    }
    if (!hasPermission(req.user.roles, permission)) {
      logAuditSafe(req, 'ACCESS_DENIED', 'RBAC', permission, 'SECURITY', `Permission refusée : ${permission}`);
      return res.status(403).json({
        error: 'Accès refusé : vous ne disposez pas des droits nécessaires pour cette action.',
        code: 'FORBIDDEN',
      });
    }
    return next();
  };
}

export function requireAnyPermission(permissions: Permission[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentification requise.', code: 'UNAUTHORIZED' });
    }
    if (!hasAnyPermission(req.user.roles, permissions)) {
      logAuditSafe(
        req,
        'ACCESS_DENIED',
        'RBAC',
        permissions.join(','),
        'SECURITY',
        `Accès refusé aux permissions : ${permissions.join(', ')}`
      );
      return res.status(403).json({
        error: 'Accès refusé : autorisations insuffisantes.',
        code: 'FORBIDDEN',
      });
    }
    return next();
  };
}

export async function logAuditSafe(
  req: Request,
  action: string,
  resourceType: string,
  resourceId: string | undefined,
  severity: 'INFO' | 'WARNING' | 'SECURITY',
  details: string
): Promise<void> {
  try {
    (req as any)._auditLogged = true;
    if (!isSupabaseConfigured()) return;
    const cleanPath = (req.originalUrl || req.path || '').split('?')[0];
    const reqTag = req.method && cleanPath ? `[${req.method} ${cleanPath}]` : '';
    const enrichedDetails = reqTag && !details.includes(reqTag) ? `${details} ${reqTag}` : details;

    await repository.appendAuditLog({
      actorUserId: req.user?._id,
      actorName: req.user
        ? `${req.user.title ? req.user.title + ' ' : ''}${req.user.firstName} ${req.user.lastName}`.trim()
        : 'Anonyme',
      actorRoles: req.user?.roles || [],
      action,
      resourceType,
      resourceId,
      severity,
      details: enrichedDetails,
      ipAddress: req.clientIp,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[AUDIT_LOG_ERROR]', err);
  }
}
