import { Router } from 'express';
import { z } from 'zod';
import { repository } from '../repositories/SupabaseRepository';
import { hashPassword, sanitizeUser } from '../services/security';
import {
  logAuditSafe,
  requireAnyPermission,
  requireAuth,
  requireCsrf,
  requirePermission,
  requireSupabaseConfigured,
} from '../middleware/auth';
import { ROLE_PERMISSIONS } from '../../src/shared/constants';
import type { RoleCode } from '../../src/shared/types';
import { emitSyncEvent } from '../services/eventBus';

export const usersRouter = Router();

usersRouter.use(requireSupabaseConfigured, requireAuth, requireCsrf);

const roleEnum = z.enum(['ADMIN', 'MEDECIN', 'ACCUEIL', 'PATIENT']);

const createUserSchema = z.object({
  email: z.string().email('E-mail invalide'),
  username: z.string().min(3, 'Identifiant minimum 3 caractères'),
  firstName: z.string().min(2, 'Prénom requis'),
  lastName: z.string().min(2, 'Nom requis'),
  title: z.string().optional(),
  specialty: z.string().optional(),
  phone: z.string().optional(),
  roles: z.array(roleEnum).min(1, 'Au moins un rôle requis'),
  patientId: z.string().optional(),
  password: z.string().min(8, 'Mot de passe minimum 8 caractères'),
});

const updateUserSchema = z.object({
  firstName: z.string().min(2).optional(),
  lastName: z.string().min(2).optional(),
  title: z.string().optional(),
  specialty: z.string().optional(),
  phone: z.string().optional(),
  roles: z.array(roleEnum).min(1).optional(),
  isActive: z.boolean().optional(),
  patientId: z.string().nullable().optional(),
  resetPassword: z.string().min(8).optional(),
});

// List doctors for appointment/consultation assignment (available to staff & patient portal)
usersRouter.get('/doctors', requireAnyPermission(['appointments:read', 'consultations:read', 'users:manage', 'portal:access']), async (_req, res) => {
  const users = await repository.listUsers();
  const doctors = users
    .filter((u) => u.isActive && u.roles.includes('MEDECIN'))
    .map((u) => {
      const safe = sanitizeUser(u);
      return {
        _id: safe._id,
        _type: safe._type,
        firstName: safe.firstName,
        lastName: safe.lastName,
        title: safe.title,
        specialty: safe.specialty,
        roles: safe.roles,
        isActive: safe.isActive,
      };
    });
  res.json({ doctors });
});

// List staff users for task/follow-up assignment
usersRouter.get('/staff', requireAnyPermission(['tasks:read', 'followups:read', 'users:manage']), async (_req, res) => {
  const users = await repository.listUsers();
  const staff = users
    .filter((u) => u.isActive && u.roles.some((r) => r === 'ADMIN' || r === 'MEDECIN' || r === 'ACCUEIL'))
    .map(sanitizeUser);
  res.json({ staff });
});

usersRouter.get('/', requirePermission('users:manage'), async (_req, res) => {
  const users = await repository.listUsers();
  res.json({ users: users.map(sanitizeUser) });
});

usersRouter.post('/', requirePermission('users:manage'), async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Données invalides' });
  }

  const existingEmail = await repository.findUserByIdentifier(parsed.data.email);
  const existingUsername = await repository.findUserByIdentifier(parsed.data.username);
  if (existingEmail || existingUsername) {
    return res.status(409).json({ error: 'Un compte avec cet e-mail ou identifiant existe déjà.' });
  }

  const now = new Date().toISOString();
  const passwordHash = await hashPassword(parsed.data.password);
  const created = await repository.createUser({
    email: parsed.data.email,
    username: parsed.data.username,
    firstName: parsed.data.firstName,
    lastName: parsed.data.lastName,
    title: parsed.data.title,
    specialty: parsed.data.specialty,
    phone: parsed.data.phone,
    roles: parsed.data.roles,
    patientId: parsed.data.patientId,
    isActive: true,
    isDemo: false,
    passwordHash,
    createdAt: now,
    updatedAt: now,
  });

  await logAuditSafe(
    req,
    'USER_CREATED',
    'user',
    created._id,
    'SECURITY',
    `Création compte ${created.email} (Rôles: ${created.roles.join(', ')})`
  );
  emitSyncEvent('user');

  return res.status(201).json({ user: sanitizeUser(created) });
});

usersRouter.patch('/:id', requirePermission('users:manage'), async (req, res) => {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Données invalides' });
  }

  const existing = await repository.findUserById(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Utilisateur introuvable.' });
  }

  // Prevent admin from locking themselves out of ADMIN role or deactivating themselves
  if (existing._id === req.user!._id) {
    if (parsed.data.isActive === false) {
      return res.status(400).json({ error: 'Vous ne pouvez pas désactiver votre propre compte actif.' });
    }
    if (parsed.data.roles && !parsed.data.roles.includes('ADMIN')) {
      return res.status(400).json({ error: 'Vous ne pouvez pas retirer votre propre rôle Administrateur.' });
    }
  }

  const patch: Record<string, any> = {
    updatedAt: new Date().toISOString(),
  };
  if (parsed.data.firstName !== undefined) patch.firstName = parsed.data.firstName;
  if (parsed.data.lastName !== undefined) patch.lastName = parsed.data.lastName;
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.specialty !== undefined) patch.specialty = parsed.data.specialty;
  if (parsed.data.phone !== undefined) patch.phone = parsed.data.phone;
  if (parsed.data.roles !== undefined) patch.roles = parsed.data.roles;
  if (parsed.data.isActive !== undefined) patch.isActive = parsed.data.isActive;
  if (parsed.data.patientId !== undefined) patch.patientId = parsed.data.patientId || undefined;
  if (parsed.data.resetPassword) {
    patch.passwordHash = await hashPassword(parsed.data.resetPassword);
  }

  const updated = await repository.updateUser(existing._id, patch);
  await logAuditSafe(
    req,
    'USER_UPDATED',
    'user',
    updated._id,
    'SECURITY',
    `Mise à jour utilisateur ${updated.email} (Actif: ${updated.isActive}, Rôles: ${updated.roles.join(', ')})`
  );
  emitSyncEvent('user');

  return res.json({ user: sanitizeUser(updated) });
});

usersRouter.get('/roles', requirePermission('users:manage'), async (_req, res) => {
  const roles = await repository.listRoles();
  if (roles.length) return res.json({ roles });

  const codes: RoleCode[] = ['ADMIN', 'MEDECIN', 'ACCUEIL', 'PATIENT'];
  return res.json({
    roles: codes.map((code) => ({
      _id: `role-${code.toLowerCase()}`,
      _type: 'role',
      code,
      name: code,
      description: '',
      permissions: ROLE_PERMISSIONS[code],
    })),
  });
});
