import { Router } from 'express';
import { z } from 'zod';
import { getEnvConfig } from '../config/env';
import { repository } from '../repositories/SupabaseRepository';
import {
  checkLoginRateLimit,
  clearFailedLogins,
  CSRF_COOKIE_NAME,
  generateCsrfToken,
  hashPassword,
  recordFailedLogin,
  revokeSessionToken,
  sanitizeUser,
  SESSION_COOKIE_NAME,
  signSessionToken,
  verifyPassword,
} from '../services/security';
import { extractBearerToken, logAuditSafe, requireAuth, requireSupabaseConfigured } from '../middleware/auth';
import { sendStaffAlertEmail } from '../services/emailService';
import { CLINIC_DEFAULTS } from '../../src/shared/constants';

export const authRouter = Router();

const loginSchema = z.object({
  identifier: z.string().min(2, "Identifiant ou e-mail requis"),
  password: z.string().min(4, 'Mot de passe requis'),
});

const forgotSchema = z.object({
  email: z.string().email('Adresse e-mail invalide'),
});

const activatePatientSchema = z.object({
  email: z.string().email('Adresse e-mail invalide'),
  patientNumber: z.string().min(4, 'Numéro patient requis (ex: PAT-00001)'),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date de naissance invalide'),
  password: z.string().min(8, 'Le mot de passe doit contenir au moins 8 caractères'),
});

function isHttpsRequest(req: import('express').Request): boolean {
  return req.secure || req.headers['x-forwarded-proto'] === 'https' || getEnvConfig().isProduction;
}

function getCookieOptions(req: import('express').Request, httpOnly: boolean) {
  const https = isHttpsRequest(req);
  return {
    httpOnly,
    secure: https,
    sameSite: (https ? 'none' : 'lax') as 'none' | 'lax',
    partitioned: https,
    maxAge: 1000 * 60 * 60 * 12,
    path: '/',
  };
}

authRouter.post('/login', requireSupabaseConfigured, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Données invalides' });
  }

  const { identifier, password } = parsed.data;
  const rateKey = `${req.clientIp}:${identifier.toLowerCase().trim()}`;
  const rateCheck = checkLoginRateLimit(rateKey);
  if (!rateCheck.allowed) {
    await logAuditSafe(
      req,
      'LOGIN_BLOCKED_RATE_LIMIT',
      'auth',
      identifier,
      'SECURITY',
      `Tentatives répétées bloquées (${rateCheck.retryAfterSeconds}s)`
    );
    return res.status(429).json({
      error: `Trop de tentatives échouées. Réessayez dans ${Math.ceil((rateCheck.retryAfterSeconds || 60) / 60)} minute(s).`,
    });
  }

  try {
    const user = await repository.findUserByIdentifier(identifier);
    if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      const fail = recordFailedLogin(rateKey);
      await logAuditSafe(
        req,
        'LOGIN_FAILED',
        'auth',
        identifier,
        'SECURITY',
        `Échec d'authentification pour "${identifier}"`
      );
      return res.status(401).json({
        error: fail.locked
          ? 'Compte temporairement verrouillé suite à plusieurs échecs.'
          : 'Identifiant ou mot de passe incorrect.',
      });
    }

    if (!user.isActive) {
      await logAuditSafe(req, 'LOGIN_DISABLED_ACCOUNT', 'auth', user._id, 'SECURITY', 'Tentative sur compte désactivé');
      return res.status(403).json({ error: 'Ce compte utilisateur est désactivé. Contactez un administrateur.' });
    }

    clearFailedLogins(rateKey);
    const now = new Date().toISOString();
    const updatedUser = await repository.updateUser(user._id, { lastLoginAt: now, updatedAt: now });
    const publicUser = sanitizeUser(updatedUser);

    const sessionToken = signSessionToken(publicUser);
    const csrfToken = generateCsrfToken();

    res.cookie(SESSION_COOKIE_NAME, sessionToken, getCookieOptions(req, true));
    res.cookie(CSRF_COOKIE_NAME, csrfToken, getCookieOptions(req, false));

    req.user = publicUser;
    await logAuditSafe(req, 'LOGIN_SUCCESS', 'auth', publicUser._id, 'INFO', 'Connexion réussie');

    return res.json({ user: publicUser, csrfToken, sessionToken });
  } catch (err: any) {
    return res.status(500).json({ error: 'Erreur serveur lors de la connexion.' });
  }
});

authRouter.post('/logout', async (req, res) => {
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];
  const bearerToken = extractBearerToken(req);
  if (cookieToken) revokeSessionToken(cookieToken);
  if (bearerToken && bearerToken !== cookieToken) revokeSessionToken(bearerToken);
  await logAuditSafe(req, 'LOGOUT', 'auth', req.user?._id, 'INFO', 'Déconnexion utilisateur');
  const https = isHttpsRequest(req);
  const clearOpts = {
    path: '/',
    secure: https,
    sameSite: (https ? 'none' : 'lax') as 'none' | 'lax',
    partitioned: https,
  };
  res.clearCookie(SESSION_COOKIE_NAME, clearOpts);
  res.clearCookie(CSRF_COOKIE_NAME, clearOpts);
  return res.json({ ok: true });
});

authRouter.get('/me', requireSupabaseConfigured, async (req, res) => {
  const settings = await repository.getClinicSettings().catch(() => null);
  const clinicInfo = settings || {
    clinicName: CLINIC_DEFAULTS.clinicName,
    leadDoctorName: CLINIC_DEFAULTS.leadDoctorName,
    specialty: CLINIC_DEFAULTS.specialty,
    city: CLINIC_DEFAULTS.city,
    phone: CLINIC_DEFAULTS.phone,
    email: CLINIC_DEFAULTS.email,
    address: CLINIC_DEFAULTS.address,
    slogan: CLINIC_DEFAULTS.slogan,
  };

  if (!req.user) {
    return res.status(200).json({ authenticated: false, user: null, clinicInfo });
  }

  // Ensure CSRF cookie is synced for active session
  let csrfToken = req.cookies?.[CSRF_COOKIE_NAME];
  if (!csrfToken) {
    csrfToken = generateCsrfToken();
    res.cookie(CSRF_COOKIE_NAME, csrfToken, getCookieOptions(req, false));
  }

  const activeToken = extractBearerToken(req) || req.cookies?.[SESSION_COOKIE_NAME] || signSessionToken(req.user);
  return res.json({ authenticated: true, user: req.user, csrfToken, sessionToken: activeToken, clinicInfo });
});

authRouter.post('/forgot-password', requireSupabaseConfigured, async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'E-mail invalide' });
  }
  // Never reveal whether email exists; record internal notification + Resend alert for admins
  try {
    const user = await repository.findUserByIdentifier(parsed.data.email);
    if (user) {
      await repository.createNotification({
        recipientRoles: ['ADMIN'],
        eventType: 'NOUVEAU_RDV',
        title: 'Demande de réinitialisation de mot de passe',
        message: `L'utilisateur ${user.firstName} ${user.lastName} (${user.email}) a demandé une assistance mot de passe.`,
        linkModule: 'admin',
        relatedEntityId: user._id,
        readByUserIds: [],
        channel: 'INTERNE',
        createdAt: new Date().toISOString(),
      });
      const allUsers = await repository.listUsers();
      const admins = allUsers.filter((u) => u.isActive && u.roles.includes('ADMIN') && u.email);
      for (const admin of admins) {
        sendStaffAlertEmail({
          recipientEmail: admin.email,
          recipientName: `${admin.firstName} ${admin.lastName}`,
          title: 'Demande de réinitialisation de mot de passe',
          message: `L'utilisateur ${user.firstName} ${user.lastName} (${user.email}) a demandé une assistance mot de passe depuis l'écran de connexion.`,
          category: 'SECURITE',
          linkPath: '/administration/utilisateurs',
          relatedEntityId: user._id,
        }).catch(() => undefined);
      }
    }
    await logAuditSafe(
      req,
      'PASSWORD_RESET_REQUESTED',
      'auth',
      parsed.data.email,
      'SECURITY',
      `Demande de récupération mot de passe reçue pour ${parsed.data.email}`
    );
  } catch {
    // Silent to avoid account enumeration
  }
  return res.json({
    ok: true,
    message:
      "Si un compte correspond à cette adresse e-mail, une demande sécurisée a été transmise à l'administrateur du cabinet pour réinitialisation.",
  });
});

// Patient portal activation (only for patients pre-registered & invited by staff)
authRouter.post('/activate-patient', requireSupabaseConfigured, async (req, res) => {
  const parsed = activatePatientSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Données invalides' });
  }

  const { email, patientNumber, birthDate, password } = parsed.data;
  const patients = await repository.listPatients({ search: patientNumber });
  const target = patients.find(
    (p) =>
      p.patientNumber.toUpperCase() === patientNumber.trim().toUpperCase() &&
      p.birthDate === birthDate &&
      (p.email || '').toLowerCase() === email.toLowerCase()
  );

  if (!target || !target.portalInvited) {
    return res.status(403).json({
      error: "Aucune invitation active trouvée pour ces informations. Veuillez contacter l'accueil du cabinet.",
    });
  }

  const existingUser = await repository.findUserByIdentifier(email);
  if (existingUser) {
    return res.status(409).json({ error: 'Un compte portail existe déjà pour cette adresse e-mail.' });
  }

  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);
  const user = await repository.createUser({
    email: email.toLowerCase(),
    username: target.patientNumber.toLowerCase(),
    firstName: target.firstName,
    lastName: target.lastName,
    phone: target.phone,
    roles: ['PATIENT'],
    patientId: target._id,
    isActive: true,
    isDemo: target.isDemo,
    passwordHash,
    createdAt: now,
    updatedAt: now,
  });

  await repository.updatePatient(target._id, { portalActivated: true, updatedAt: now });
  await logAuditSafe(req, 'PATIENT_PORTAL_ACTIVATED', 'patient', target._id, 'INFO', `Activation espace patient ${target.patientNumber}`);

  return res.status(201).json({
    ok: true,
    message: 'Votre espace patient est activé. Vous pouvez maintenant vous connecter.',
    username: user.username,
  });
});

authRouter.post('/change-password', requireSupabaseConfigured, requireAuth, async (req, res) => {
  const schema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8, 'Minimum 8 caractères'),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Données invalides' });
  }

  const user = await repository.findUserById(req.user!._id);
  if (!user || !user.passwordHash || !(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
    return res.status(400).json({ error: 'Mot de passe actuel incorrect.' });
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await repository.updateUser(user._id, { passwordHash, updatedAt: new Date().toISOString() });
  await logAuditSafe(req, 'PASSWORD_CHANGED', 'user', user._id, 'SECURITY', 'Changement de mot de passe');
  return res.json({ ok: true });
});
