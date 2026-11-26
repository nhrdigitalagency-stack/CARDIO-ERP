import { Resend } from 'resend';
import { getEnvConfig, isResendConfigured, isSupabaseConfigured } from '../config/env';
import { repository } from '../repositories/SupabaseRepository';
import { CLINIC_DEFAULTS } from '../../src/shared/constants';
import type { EmailDispatchLog } from '../../src/shared/types';
import { emitSyncEvent } from './eventBus';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isValidEmail(email: string | undefined | null): email is string {
  if (!email) return false;
  const trimmed = email.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

async function getClinicBranding() {
  try {
    if (isSupabaseConfigured()) {
      const settings = await repository.getClinicSettings();
      if (settings) {
        return {
          clinicName: settings.clinicName || CLINIC_DEFAULTS.clinicName,
          leadDoctorName: settings.leadDoctorName || CLINIC_DEFAULTS.leadDoctorName,
          phone: settings.phone || CLINIC_DEFAULTS.phone,
          email: settings.email || CLINIC_DEFAULTS.email,
          address: settings.address || CLINIC_DEFAULTS.address,
          city: settings.city || CLINIC_DEFAULTS.city,
          emailEnabled: settings.notificationChannels?.emailEnabled ?? true,
          senderEmail: settings.notificationChannels?.senderEmail,
        };
      }
    }
  } catch {
    // Fallback to defaults
  }
  return {
    clinicName: CLINIC_DEFAULTS.clinicName,
    leadDoctorName: CLINIC_DEFAULTS.leadDoctorName,
    phone: CLINIC_DEFAULTS.phone,
    email: CLINIC_DEFAULTS.email,
    address: CLINIC_DEFAULTS.address,
    city: CLINIC_DEFAULTS.city,
    emailEnabled: true,
    senderEmail: undefined,
  };
}

function buildClinicEmailLayout(params: {
  clinicName: string;
  leadDoctorName: string;
  phone: string;
  address: string;
  city: string;
  badge: string;
  title: string;
  greeting: string;
  paragraphs: string[];
  highlightRows?: Array<{ label: string; value: string }>;
  ctaLabel?: string;
  ctaUrl?: string;
  footerNote?: string;
}): { html: string; text: string } {
  const safeClinic = escapeHtml(params.clinicName);
  const safeTitle = escapeHtml(params.title);
  const safeBadge = escapeHtml(params.badge);
  const safeGreeting = escapeHtml(params.greeting);

  const highlightHtml = params.highlightRows?.length
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:20px 0;background:#F4F7FB;border:1px solid #DCE7F3;border-radius:8px;">
        ${params.highlightRows
          .map(
            (r) => `<tr>
              <td style="padding:10px 14px;font-size:13px;color:#5A6C84;border-bottom:1px solid #E6EEF7;width:40%;">${escapeHtml(r.label)}</td>
              <td style="padding:10px 14px;font-size:13px;font-weight:600;color:#172B45;border-bottom:1px solid #E6EEF7;">${escapeHtml(r.value)}</td>
            </tr>`
          )
          .join('')}
      </table>`
    : '';

  const ctaHtml =
    params.ctaLabel && params.ctaUrl
      ? `<div style="margin:24px 0 8px 0;">
          <a href="${escapeHtml(params.ctaUrl)}" style="display:inline-block;padding:12px 22px;background:#073B70;color:#FFFFFF;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">
            ${escapeHtml(params.ctaLabel)}
          </a>
        </div>`
      : '';

  const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8" /><title>${safeTitle}</title></head>
<body style="margin:0;padding:24px;background:#F4F7FB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#172B45;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto;background:#FFFFFF;border:1px solid #DCE7F3;border-radius:12px;overflow:hidden;">
    <tr>
      <td style="background:#073B70;padding:22px 28px;color:#FFFFFF;">
        <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#93C5FD;font-weight:600;">${safeBadge}</div>
        <div style="font-size:20px;font-weight:700;margin-top:4px;">${safeClinic}</div>
        <div style="font-size:12px;color:#CBD5E1;margin-top:2px;">Direction médicale : ${escapeHtml(params.leadDoctorName)}</div>
      </td>
    </tr>
    <tr>
      <td style="padding:28px;">
        <h1 style="margin:0 0 14px 0;font-size:18px;color:#073B70;">${safeTitle}</h1>
        <p style="margin:0 0 14px 0;font-size:14px;line-height:1.6;">${safeGreeting}</p>
        ${params.paragraphs
          .map((p) => `<p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;color:#334155;">${escapeHtml(p)}</p>`)
          .join('')}
        ${highlightHtml}
        ${ctaHtml}
        <p style="margin:20px 0 0 0;font-size:12px;color:#64748B;line-height:1.5;">
          ${escapeHtml(
            params.footerNote ||
              "Par respect du secret médical, cet e-mail ne contient aucune donnée clinique sensible. Pour toute question, contactez directement l'accueil du cabinet."
          )}
        </p>
      </td>
    </tr>
    <tr>
      <td style="background:#F8FAFC;padding:16px 28px;border-top:1px solid #E2E8F0;font-size:12px;color:#64748B;">
        <strong>${safeClinic}</strong><br />
        ${escapeHtml(params.address)} · ${escapeHtml(params.city)}<br />
        Tél. : ${escapeHtml(params.phone)}
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textLines = [
    `${params.clinicName} — ${params.title}`,
    '',
    params.greeting,
    '',
    ...params.paragraphs,
    '',
    ...(params.highlightRows || []).map((r) => `- ${r.label} : ${r.value}`),
    ...(params.ctaUrl ? ['', `${params.ctaLabel || 'Accéder'} : ${params.ctaUrl}`] : []),
    '',
    `Contact cabinet : ${params.phone} | ${params.address}, ${params.city}`,
  ];

  return { html, text: textLines.join('\n') };
}

export interface SendClinicEmailParams {
  to: string;
  recipientName?: string;
  subject: string;
  html: string;
  text: string;
  category: EmailDispatchLog['category'];
  relatedEntityId?: string;
  patientId?: string;
  reminderKey?: string;
  force?: boolean;
}

export async function sendClinicEmail(params: SendClinicEmailParams): Promise<{
  ok: boolean;
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  messageId?: string;
  error?: string;
}> {
  const now = new Date().toISOString();
  const cfg = getEnvConfig();

  if (!isValidEmail(params.to)) {
    return { ok: false, status: 'SKIPPED', error: 'Adresse e-mail destinataire absente ou invalide.' };
  }

  // Avoid sending to synthetic .test demo domains unless explicitly forced (e.g., manual test)
  if (!params.force && params.to.trim().toLowerCase().endsWith('.test')) {
    const skippedMsg = 'Adresse fictive (.test) ignorée pour préserver la réputation d’envoi Resend.';
    if (isSupabaseConfigured()) {
      await repository
        .createEmailDispatch({
          recipientEmail: params.to.trim(),
          recipientName: params.recipientName,
          subject: params.subject,
          category: params.category,
          status: 'SKIPPED',
          provider: 'RESEND',
          errorMessage: skippedMsg,
          relatedEntityId: params.relatedEntityId,
          patientId: params.patientId,
          reminderKey: params.reminderKey,
          createdAt: now,
        })
        .catch(() => undefined);
    }
    return { ok: false, status: 'SKIPPED', error: skippedMsg };
  }

  const branding = await getClinicBranding();

  if (!params.force && !branding.emailEnabled) {
    const msg = 'Notifications e-mail désactivées dans les paramètres du cabinet.';
    if (isSupabaseConfigured()) {
      await repository
        .createEmailDispatch({
          recipientEmail: params.to.trim(),
          recipientName: params.recipientName,
          subject: params.subject,
          category: params.category,
          status: 'SKIPPED',
          provider: 'RESEND',
          errorMessage: msg,
          relatedEntityId: params.relatedEntityId,
          patientId: params.patientId,
          reminderKey: params.reminderKey,
          createdAt: now,
        })
        .catch(() => undefined);
    }
    return { ok: false, status: 'SKIPPED', error: msg };
  }

  if (!isResendConfigured()) {
    const msg = 'Resend non configuré (RESEND_API_KEY manquant dans les variables serveur).';
    if (isSupabaseConfigured()) {
      await repository
        .createEmailDispatch({
          recipientEmail: params.to.trim(),
          recipientName: params.recipientName,
          subject: params.subject,
          category: params.category,
          status: 'SKIPPED',
          provider: 'RESEND',
          errorMessage: msg,
          relatedEntityId: params.relatedEntityId,
          patientId: params.patientId,
          reminderKey: params.reminderKey,
          createdAt: now,
        })
        .catch(() => undefined);
    }
    return { ok: false, status: 'SKIPPED', error: msg };
  }

  const fromAddress = (branding.senderEmail && branding.senderEmail.includes('@') ? branding.senderEmail : cfg.resendFromEmail).trim();

  try {
    const resend = new Resend(cfg.resendApiKey);
    const response = await resend.emails.send({
      from: fromAddress,
      to: [params.to.trim()],
      subject: params.subject,
      html: params.html,
      text: params.text,
    });

    if (response.error) {
      const errMsg = response.error.message || 'Erreur API Resend';
      if (isSupabaseConfigured()) {
        await repository
          .createEmailDispatch({
            recipientEmail: params.to.trim(),
            recipientName: params.recipientName,
            subject: params.subject,
            category: params.category,
            status: 'FAILED',
            provider: 'RESEND',
            errorMessage: errMsg,
            relatedEntityId: params.relatedEntityId,
            patientId: params.patientId,
            reminderKey: params.reminderKey,
            createdAt: now,
          })
          .catch(() => undefined);
        emitSyncEvent('notification');
      }
      return { ok: false, status: 'FAILED', error: errMsg };
    }

    const messageId = response.data?.id;
    if (isSupabaseConfigured()) {
      await repository
        .createEmailDispatch({
          recipientEmail: params.to.trim(),
          recipientName: params.recipientName,
          subject: params.subject,
          category: params.category,
          status: 'SENT',
          provider: 'RESEND',
          providerMessageId: messageId,
          relatedEntityId: params.relatedEntityId,
          patientId: params.patientId,
          reminderKey: params.reminderKey,
          createdAt: now,
        })
        .catch(() => undefined);
      emitSyncEvent('notification');
    }

    return { ok: true, status: 'SENT', messageId };
  } catch (err: any) {
    const errMsg = err?.message || 'Erreur réseau lors de l’envoi via Resend.';
    if (isSupabaseConfigured()) {
      await repository
        .createEmailDispatch({
          recipientEmail: params.to.trim(),
          recipientName: params.recipientName,
          subject: params.subject,
          category: params.category,
          status: 'FAILED',
          provider: 'RESEND',
          errorMessage: errMsg,
          relatedEntityId: params.relatedEntityId,
          patientId: params.patientId,
          reminderKey: params.reminderKey,
          createdAt: now,
        })
        .catch(() => undefined);
    }
    return { ok: false, status: 'FAILED', error: errMsg };
  }
}

export async function sendAppointmentEmail(params: {
  mode: 'CONFIRMATION' | 'REMINDER_J1';
  patientId: string;
  patientName: string;
  patientEmail?: string;
  doctorName: string;
  date: string;
  startTime: string;
  typeLabel: string;
  appointmentId: string;
  reminderKey?: string;
}) {
  if (!isValidEmail(params.patientEmail)) return { ok: false, status: 'SKIPPED' as const };
  const branding = await getClinicBranding();
  const cfg = getEnvConfig();
  const isReminder = params.mode === 'REMINDER_J1';

  const { html, text } = buildClinicEmailLayout({
    ...branding,
    badge: isReminder ? 'Rappel de rendez-vous (J-1)' : 'Confirmation de rendez-vous',
    title: isReminder
      ? `Rappel : votre rendez-vous de demain à ${params.startTime}`
      : `Votre rendez-vous du ${params.date} est enregistré`,
    greeting: `Bonjour ${params.patientName},`,
    paragraphs: isReminder
      ? [
          'Nous vous rappelons votre rendez-vous prévu demain au cabinet de cardiologie.',
          'Merci de vous présenter 10 minutes avant l’horaire indiqué, muni(e) de vos anciens examens et ordonnances en cours.',
        ]
      : [
          'Votre rendez-vous au cabinet de cardiologie a bien été enregistré.',
          'En cas d’empêchement, nous vous remercions de prévenir le secrétariat au plus tôt.',
        ],
    highlightRows: [
      { label: 'Prestation', value: params.typeLabel },
      { label: 'Date', value: params.date },
      { label: 'Horaire', value: params.startTime },
      { label: 'Praticien', value: params.doctorName },
    ],
    ctaLabel: 'Accéder à mon espace patient',
    ctaUrl: `${cfg.appUrl}/login`,
  });

  return sendClinicEmail({
    to: params.patientEmail,
    recipientName: params.patientName,
    subject: isReminder
      ? `Rappel RDV demain ${params.startTime} — ${branding.clinicName}`
      : `Confirmation RDV le ${params.date} à ${params.startTime} — ${branding.clinicName}`,
    html,
    text,
    category: isReminder ? 'RDV_RAPPEL_J1' : 'RDV_CONFIRMATION',
    relatedEntityId: params.appointmentId,
    patientId: params.patientId,
    reminderKey: params.reminderKey,
  });
}

export async function sendFollowUpReminderEmail(params: {
  recipientEmail?: string;
  recipientName: string;
  isPatientRecipient: boolean;
  patientId: string;
  patientName: string;
  followUpId: string;
  followUpTypeLabel: string;
  dueDate: string;
  reason: string;
  reminderKey?: string;
  force?: boolean;
}) {
  if (!isValidEmail(params.recipientEmail)) return { ok: false, status: 'SKIPPED' as const };
  const branding = await getClinicBranding();
  const cfg = getEnvConfig();

  const { html, text } = buildClinicEmailLayout({
    ...branding,
    badge: params.isPatientRecipient ? 'Rappel de suivi cardiologique' : 'Relance interne · Suivi patient',
    title: params.isPatientRecipient
      ? 'Rappel de votre suivi au cabinet de cardiologie'
      : `Suivi à traiter : ${params.patientName}`,
    greeting: `Bonjour ${params.recipientName},`,
    paragraphs: params.isPatientRecipient
      ? [
          'Dans le cadre de votre suivi au sein de notre cabinet de cardiologie, nous vous invitons à prendre contact avec le secrétariat afin de planifier ou confirmer votre prochain contrôle.',
          'Notre équipe reste disponible par téléphone ou via votre espace patient sécurisé.',
        ]
      : [
          `Un suivi patient arrive à échéance ou est en retard et requiert votre action dans CARDIO ERP.`,
          `Motif opérationnel : ${params.reason}`,
        ],
    highlightRows: params.isPatientRecipient
      ? [
          { label: 'Objet', value: params.followUpTypeLabel },
          { label: 'Échéance recommandée', value: params.dueDate },
          { label: 'Téléphone secrétariat', value: branding.phone },
        ]
      : [
          { label: 'Patient', value: params.patientName },
          { label: 'Type de suivi', value: params.followUpTypeLabel },
          { label: 'Date prévue', value: params.dueDate },
        ],
    ctaLabel: params.isPatientRecipient ? 'Ouvrir mon espace patient' : 'Ouvrir le module Suivis',
    ctaUrl: params.isPatientRecipient ? `${cfg.appUrl}/login` : `${cfg.appUrl}/suivis/en-retard`,
  });

  return sendClinicEmail({
    to: params.recipientEmail,
    recipientName: params.recipientName,
    subject: params.isPatientRecipient
      ? `Rappel de suivi cardiologique — ${branding.clinicName}`
      : `[Relance Suivi] ${params.patientName} (échéance ${params.dueDate})`,
    html,
    text,
    category: 'SUIVI_RELANCE',
    relatedEntityId: params.followUpId,
    patientId: params.patientId,
    reminderKey: params.reminderKey,
    force: params.force,
  });
}

export async function sendExamValidatedEmail(params: {
  patientId: string;
  patientName: string;
  patientEmail?: string;
  examNumber: string;
  examTypeLabel: string;
  examinationId: string;
}) {
  if (!isValidEmail(params.patientEmail)) return { ok: false, status: 'SKIPPED' as const };
  const branding = await getClinicBranding();
  const cfg = getEnvConfig();

  const { html, text } = buildClinicEmailLayout({
    ...branding,
    badge: 'Résultat disponible',
    title: 'Votre compte rendu d’examen est disponible',
    greeting: `Bonjour ${params.patientName},`,
    paragraphs: [
      'Votre cardiologue a validé votre compte rendu d’examen et l’a mis à disposition dans votre espace patient sécurisé.',
      'Par mesure de confidentialité médicale, le contenu du compte rendu n’est jamais envoyé directement par e-mail.',
    ],
    highlightRows: [
      { label: 'Examen', value: params.examTypeLabel },
      { label: 'Référence', value: params.examNumber },
    ],
    ctaLabel: 'Consulter mon compte rendu',
    ctaUrl: `${cfg.appUrl}/login`,
  });

  return sendClinicEmail({
    to: params.patientEmail,
    recipientName: params.patientName,
    subject: `Compte rendu disponible (${params.examNumber}) — ${branding.clinicName}`,
    html,
    text,
    category: 'EXAMEN_VALIDE',
    relatedEntityId: params.examinationId,
    patientId: params.patientId,
  });
}

export async function sendPatientPortalInviteEmail(params: {
  patientId: string;
  patientName: string;
  patientNumber: string;
  patientEmail?: string;
}) {
  if (!isValidEmail(params.patientEmail)) return { ok: false, status: 'SKIPPED' as const };
  const branding = await getClinicBranding();
  const cfg = getEnvConfig();

  const { html, text } = buildClinicEmailLayout({
    ...branding,
    badge: 'Invitation Espace Patient',
    title: 'Activez votre espace patient sécurisé',
    greeting: `Bonjour ${params.patientName},`,
    paragraphs: [
      'Le secrétariat du cabinet vous invite à activer votre espace patient CARDIO ERP afin de consulter vos rendez-vous et télécharger vos comptes rendus validés.',
      'Lors de l’activation, utilisez votre adresse e-mail, votre date de naissance et votre numéro de dossier ci-dessous.',
    ],
    highlightRows: [
      { label: 'Numéro de dossier', value: params.patientNumber },
      { label: 'E-mail associé', value: params.patientEmail },
    ],
    ctaLabel: 'Activer mon espace patient',
    ctaUrl: `${cfg.appUrl}/login/activation-patient`,
  });

  return sendClinicEmail({
    to: params.patientEmail,
    recipientName: params.patientName,
    subject: `Activation de votre espace patient — ${branding.clinicName}`,
    html,
    text,
    category: 'PORTAIL_INVITATION',
    relatedEntityId: params.patientId,
    patientId: params.patientId,
  });
}

export async function sendStaffAlertEmail(params: {
  recipientEmail?: string;
  recipientName: string;
  title: string;
  message: string;
  category: EmailDispatchLog['category'];
  linkPath?: string;
  relatedEntityId?: string;
  reminderKey?: string;
  force?: boolean;
}) {
  if (!isValidEmail(params.recipientEmail)) return { ok: false, status: 'SKIPPED' as const };
  const branding = await getClinicBranding();
  const cfg = getEnvConfig();

  const { html, text } = buildClinicEmailLayout({
    ...branding,
    badge: 'Alerte CARDIO ERP',
    title: params.title,
    greeting: `Bonjour ${params.recipientName},`,
    paragraphs: [params.message],
    ctaLabel: 'Ouvrir CARDIO ERP',
    ctaUrl: `${cfg.appUrl}${params.linkPath || '/tableau-de-bord'}`,
  });

  return sendClinicEmail({
    to: params.recipientEmail,
    recipientName: params.recipientName,
    subject: `[CARDIO ERP] ${params.title}`,
    html,
    text,
    category: params.category,
    relatedEntityId: params.relatedEntityId,
    reminderKey: params.reminderKey,
    force: params.force,
  });
}

export async function sendTestEmail(toEmail: string, actorName: string) {
  const branding = await getClinicBranding();
  const cfg = getEnvConfig();

  const { html, text } = buildClinicEmailLayout({
    ...branding,
    badge: 'Test de connexion Resend',
    title: 'Passerelle e-mail Resend opérationnelle',
    greeting: `Bonjour ${actorName},`,
    paragraphs: [
      'Ceci est un e-mail de vérification envoyé en temps réel depuis votre serveur CARDIO ERP via l’API Resend.',
      'Les notifications transactionnelles et les relances automatiques (rendez-vous J-1, suivis en retard, comptes rendus validés) sont prêtes à fonctionner.',
    ],
    highlightRows: [
      { label: 'Base de données', value: 'Supabase PostgreSQL + RLS' },
      { label: 'Stockage fichiers', value: 'Cloudflare R2 (S3 privé)' },
      { label: 'Service E-mail', value: 'Resend API (actif)' },
      { label: 'Date / Heure', value: new Date().toLocaleString('fr-FR') },
    ],
    ctaLabel: 'Retourner dans CARDIO ERP',
    ctaUrl: `${cfg.appUrl}/administration/parametres`,
  });

  return sendClinicEmail({
    to: toEmail,
    recipientName: actorName,
    subject: `Test Resend réussi — ${branding.clinicName}`,
    html,
    text,
    category: 'TEST',
    force: true,
  });
}
