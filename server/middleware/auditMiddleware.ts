import type { NextFunction, Request, Response } from 'express';
import { isSupabaseConfigured } from '../config/env';
import { repository } from '../repositories/SupabaseRepository';

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'resetpassword',
  'currentpassword',
  'newpassword',
  'confirmpassword',
  'token',
  'csrftoken',
  'secret',
]);

function extractAffectedDocIdFromPayload(body: any): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const candidateKeys = [
    'patient',
    'appointment',
    'consultation',
    'examination',
    'followUp',
    'task',
    'document',
    'payment',
    'service',
    'user',
    'settings',
    'item',
  ];
  for (const key of candidateKeys) {
    if (body[key] && typeof body[key] === 'object' && typeof body[key]._id === 'string') {
      return body[key]._id;
    }
  }
  if (typeof body._id === 'string') return body._id;
  if (typeof body.id === 'string') return body.id;
  return undefined;
}

function summarizeSafeBodyFields(body: any): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '';
  const keys = Object.keys(body)
    .filter((k) => !SENSITIVE_KEYS.has(k.toLowerCase()))
    .slice(0, 8);
  return keys.length > 0 ? ` · Champs: ${keys.join(', ')}` : '';
}

function inferResource(req: Request): { resourceType: string; resourceId?: string } {
  const cleanPath = (req.originalUrl || req.path || '').split('?')[0];
  const segments = cleanPath.replace(/^\/api\/?/, '').split('/').filter(Boolean);

  if (!segments.length) return { resourceType: 'system' };

  const root = segments[0];
  // Sub-resources under /patients/:id/*
  if (root === 'patients' && segments.length >= 3) {
    const sub = segments[2];
    if (sub === 'medications') return { resourceType: 'medication', resourceId: segments[3] || segments[1] };
    if (sub === 'allergies') return { resourceType: 'allergy', resourceId: segments[3] || segments[1] };
    if (sub === 'history') return { resourceType: 'medicalHistory', resourceId: segments[3] || segments[1] };
    if (sub === 'vitals') return { resourceType: 'vitalSigns', resourceId: segments[1] };
    if (sub === 'medical-record') return { resourceType: 'medicalRecord', resourceId: segments[1] };
    return { resourceType: 'patient', resourceId: segments[1] };
  }

  const map: Record<string, string> = {
    auth: 'auth',
    users: 'user',
    patients: 'patient',
    appointments: 'appointment',
    queue: 'appointment',
    consultations: 'consultation',
    examinations: 'examination',
    'follow-ups': 'followUp',
    tasks: 'task',
    documents: 'medicalDocument',
    notifications: 'notification',
    services: 'service',
    payments: 'payment',
    settings: 'clinicSettings',
    system: 'system',
  };

  const resourceType = map[root] || root;
  const nonIdSegments = new Set([
    'upload',
    'read-all',
    'check-duplicates',
    'login',
    'logout',
    'logo',
    'setup-demo',
    'bootstrap-demo',
    'reset-demo',
    'test-connections',
    'schema-sql',
    'test-email',
    'run-reminders',
    'email-logs',
    'forgot-password',
    'activate-patient',
    'change-password',
  ]);
  const candidateId = segments[1] && !nonIdSegments.has(segments[1]) ? segments[1] : undefined;

  return { resourceType, resourceId: candidateId };
}

/**
 * Automated compliance audit middleware:
 * Intercepts every API write request (POST, PATCH, PUT, DELETE) and records an immutable
 * entry in the Supabase `audit_logs` table with actor user ID, ISO timestamp, action details,
 * and affected document ID.
 */
export function automatedAuditMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!WRITE_METHODS.has(req.method)) {
    return next();
  }

  const originalJson = res.json.bind(res);
  res.json = ((payload: any) => {
    const affectedId = extractAffectedDocIdFromPayload(payload);
    if (affectedId && !res.locals.affectedDocId) {
      res.locals.affectedDocId = affectedId;
    }
    if (payload?.user?._id && !res.locals.resolvedActorUserId) {
      res.locals.resolvedActorUserId = payload.user._id;
    }
    return originalJson(payload);
  }) as Response['json'];

  res.on('finish', () => {
    if (!isSupabaseConfigured()) return;
    if ((req as any)._auditLogged) return;

    const { resourceType, resourceId: urlResourceId } = inferResource(req);
    const affectedDocId = (res.locals.affectedDocId as string | undefined) || urlResourceId;
    const status = res.statusCode;

    const severity: 'INFO' | 'WARNING' | 'SECURITY' =
      status === 401 || status === 403
        ? 'SECURITY'
        : status >= 400 || req.method === 'DELETE'
        ? 'WARNING'
        : 'INFO';

    const cleanPath = (req.originalUrl || req.path || '').split('?')[0];
    const action = `API_${req.method}_${resourceType.toUpperCase()}`;
    const docTag = affectedDocId ? ` · Doc: ${affectedDocId}` : '';
    const fieldSummary = summarizeSafeBodyFields(req.body);
    const details = `${req.method} ${cleanPath} -> HTTP ${status}${docTag}${fieldSummary}`;

    const actorUserId = req.user?._id || (res.locals.resolvedActorUserId as string | undefined);

    repository
      .appendAuditLog({
        actorUserId,
        actorName: req.user
          ? `${req.user.title ? req.user.title + ' ' : ''}${req.user.firstName} ${req.user.lastName}`.trim()
          : 'Anonyme / Non authentifié',
        actorRoles: req.user?.roles || [],
        action,
        resourceType,
        resourceId: affectedDocId,
        severity,
        details,
        ipAddress: req.clientIp,
        createdAt: new Date().toISOString(),
      })
      .catch((err) => {
        console.error('[AUTO_AUDIT_ERROR]', err?.message || err);
      });
  });

  return next();
}
