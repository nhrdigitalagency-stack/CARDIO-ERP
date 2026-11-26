import { getEnvConfig, isSupabaseConfigured, isWhatsAppConfigured } from '../config/env';
import { repository } from '../repositories/SupabaseRepository';
import { CLINIC_DEFAULTS } from '../../src/shared/constants';
import type { EmailDispatchLog } from '../../src/shared/types';
import { emitSyncEvent } from './eventBus';

export interface SendWhatsAppResult {
  ok: boolean;
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  provider?: 'WHATSAPP_CLOUD_API' | 'WHATSAPP_CALLMEBOT';
  messageId?: string;
  error?: string;
}

let lastCallMeBotAt = 0;

async function respectCallMeBotRateLimit(): Promise<void> {
  const minGapMs = 2300;
  const elapsed = Date.now() - lastCallMeBotAt;
  if (elapsed < minGapMs) {
    await new Promise((resolve) => setTimeout(resolve, minGapMs - elapsed));
  }
  lastCallMeBotAt = Date.now();
}

export function normalizeWhatsAppPhone(raw: string | undefined | null, defaultCountryCode = '237'): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/[^\d+]/g, '');
  if (!cleaned) return null;

  let digits = cleaned;
  if (digits.startsWith('+')) {
    digits = digits.slice(1);
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0') && digits.length === 10 && defaultCountryCode === '33') {
    digits = `33${digits.slice(1)}`;
  } else if (digits.length === 9 && /^[26]/.test(digits)) {
    digits = `${defaultCountryCode}${digits}`;
  }

  digits = digits.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

function isFictionalDemoPhone(digits: string): boolean {
  // Demo seed uses +237 600 00 00 xx and +237 600 11 22 xx
  return /^237600(0000|1122)\d{2}$/.test(digits);
}

async function getClinicWhatsAppSettings() {
  try {
    if (isSupabaseConfigured()) {
      const settings = await repository.getClinicSettings();
      if (settings) {
        return {
          clinicName: settings.clinicName || CLINIC_DEFAULTS.clinicName,
          phone: settings.phone || CLINIC_DEFAULTS.phone,
          address: settings.address || CLINIC_DEFAULTS.address,
          city: settings.city || CLINIC_DEFAULTS.city,
          whatsappEnabled: settings.notificationChannels?.whatsappEnabled ?? true,
        };
      }
    }
  } catch {
    // Fallback to defaults
  }
  return {
    clinicName: CLINIC_DEFAULTS.clinicName,
    phone: CLINIC_DEFAULTS.phone,
    address: CLINIC_DEFAULTS.address,
    city: CLINIC_DEFAULTS.city,
    whatsappEnabled: true,
  };
}

async function recordWhatsAppLog(entry: Omit<EmailDispatchLog, '_id' | '_type' | 'createdAt'>) {
  if (!isSupabaseConfigured()) return;
  try {
    await repository.createEmailDispatch({
      ...entry,
      createdAt: new Date().toISOString(),
    });
    emitSyncEvent('notification');
  } catch (err) {
    console.error('[WHATSAPP_LOG_ERROR]', err);
  }
}

export async function sendClinicWhatsApp(params: {
  toPhone?: string;
  recipientName?: string;
  subject: string;
  messageText: string;
  category: EmailDispatchLog['category'];
  relatedEntityId?: string;
  patientId?: string;
  reminderKey?: string;
  force?: boolean;
  isPatientRecipient?: boolean;
}): Promise<SendWhatsAppResult> {
  const cfg = getEnvConfig();
  const providerTag: 'WHATSAPP_CLOUD_API' | 'WHATSAPP_CALLMEBOT' =
    cfg.whatsappProvider === 'callmebot' ? 'WHATSAPP_CALLMEBOT' : 'WHATSAPP_CLOUD_API';

  const normalizedTo = normalizeWhatsAppPhone(params.toPhone, cfg.whatsappDefaultCountryCode);

  if (!isWhatsAppConfigured()) {
    await recordWhatsAppLog({
      recipientEmail: normalizedTo || params.toPhone || 'n/a',
      recipientName: params.recipientName,
      subject: params.subject,
      category: params.category,
      status: 'SKIPPED',
      provider: providerTag,
      errorMessage:
        'WhatsApp non configuré (renseignez WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN ou CALLMEBOT_API_KEY + CALLMEBOT_PHONE).',
      relatedEntityId: params.relatedEntityId,
      patientId: params.patientId,
      reminderKey: params.reminderKey,
    });
    return {
      ok: false,
      status: 'SKIPPED',
      provider: providerTag,
      error: 'Passerelle WhatsApp non configurée dans les variables serveur.',
    };
  }

  const clinic = await getClinicWhatsAppSettings();
  if (!params.force && !clinic.whatsappEnabled) {
    return { ok: false, status: 'SKIPPED', provider: providerTag, error: 'Canal WhatsApp désactivé dans les paramètres.' };
  }

  if (params.reminderKey && !params.force && isSupabaseConfigured()) {
    const alreadySent = await repository.hasReminderBeenSent(params.reminderKey);
    if (alreadySent) {
      return { ok: false, status: 'SKIPPED', provider: providerTag, error: 'Relance WhatsApp déjà envoyée.' };
    }
  }

  // Provider 1: Meta WhatsApp Cloud API (Official, supports sending to ANY patient phone number)
  if (cfg.whatsappProvider === 'cloud_api') {
    if (!normalizedTo) {
      return { ok: false, status: 'SKIPPED', provider: 'WHATSAPP_CLOUD_API', error: 'Numéro WhatsApp destinataire invalide.' };
    }

    if (!params.force && isFictionalDemoPhone(normalizedTo)) {
      await recordWhatsAppLog({
        recipientEmail: `+${normalizedTo}`,
        recipientName: params.recipientName,
        subject: params.subject,
        category: params.category,
        status: 'SKIPPED',
        provider: 'WHATSAPP_CLOUD_API',
        errorMessage: 'Numéro fictif de démonstration (+237 600...) ignoré.',
        relatedEntityId: params.relatedEntityId,
        patientId: params.patientId,
        reminderKey: params.reminderKey,
      });
      return { ok: false, status: 'SKIPPED', provider: 'WHATSAPP_CLOUD_API', error: 'Numéro fictif de démonstration ignoré.' };
    }

    const endpoint = `https://graph.facebook.com/${encodeURIComponent(cfg.whatsappApiVersion)}/${encodeURIComponent(cfg.whatsappPhoneNumberId)}/messages`;

    const payload: Record<string, any> =
      cfg.whatsappTemplateName && params.isPatientRecipient
        ? {
            messaging_product: 'whatsapp',
            to: normalizedTo,
            type: 'template',
            template: {
              name: cfg.whatsappTemplateName,
              language: { code: cfg.whatsappTemplateLang || 'fr' },
              components: [
                {
                  type: 'body',
                  parameters: [{ type: 'text', text: params.messageText.slice(0, 900) }],
                },
              ],
            },
          }
        : {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: normalizedTo,
            type: 'text',
            text: { preview_url: false, body: params.messageText.slice(0, 4000) },
          };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.whatsappAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as any;

      if (!res.ok) {
        const errMsg = data?.error?.message || `Erreur Meta WhatsApp Cloud API (HTTP ${res.status})`;
        await recordWhatsAppLog({
          recipientEmail: `+${normalizedTo}`,
          recipientName: params.recipientName,
          subject: params.subject,
          category: params.category,
          status: 'FAILED',
          provider: 'WHATSAPP_CLOUD_API',
          errorMessage: errMsg,
          relatedEntityId: params.relatedEntityId,
          patientId: params.patientId,
          reminderKey: params.reminderKey,
        });
        return { ok: false, status: 'FAILED', provider: 'WHATSAPP_CLOUD_API', error: errMsg };
      }

      const msgId = data?.messages?.[0]?.id || undefined;
      await recordWhatsAppLog({
        recipientEmail: `+${normalizedTo}`,
        recipientName: params.recipientName,
        subject: params.subject,
        category: params.category,
        status: 'SENT',
        provider: 'WHATSAPP_CLOUD_API',
        providerMessageId: msgId,
        relatedEntityId: params.relatedEntityId,
        patientId: params.patientId,
        reminderKey: params.reminderKey,
      });
      return { ok: true, status: 'SENT', provider: 'WHATSAPP_CLOUD_API', messageId: msgId };
    } catch (err: any) {
      const errMsg = err?.message || 'Erreur réseau vers Meta WhatsApp Cloud API.';
      await recordWhatsAppLog({
        recipientEmail: `+${normalizedTo}`,
        recipientName: params.recipientName,
        subject: params.subject,
        category: params.category,
        status: 'FAILED',
        provider: 'WHATSAPP_CLOUD_API',
        errorMessage: errMsg,
        relatedEntityId: params.relatedEntityId,
        patientId: params.patientId,
        reminderKey: params.reminderKey,
      });
      return { ok: false, status: 'FAILED', provider: 'WHATSAPP_CLOUD_API', error: errMsg };
    }
  }

  // Provider 2: CallMeBot (Free / quick cabinet alerts to registered CallMeBot number)
  const targetCallMeBotPhone = normalizeWhatsAppPhone(cfg.callmebotPhone, cfg.whatsappDefaultCountryCode);
  if (!targetCallMeBotPhone) {
    return {
      ok: false,
      status: 'FAILED',
      provider: 'WHATSAPP_CALLMEBOT',
      error: 'CALLMEBOT_PHONE invalide.',
    };
  }

  // For CallMeBot, messages are delivered to the authorized cabinet WhatsApp number with recipient context
  const callMeBotText =
    params.isPatientRecipient && normalizedTo && normalizedTo !== targetCallMeBotPhone
      ? `[Relance Patient -> +${normalizedTo}]\n${params.messageText}`
      : params.messageText;

  try {
    await respectCallMeBotRateLimit();
    const qs = new URLSearchParams({
      phone: targetCallMeBotPhone,
      text: callMeBotText.slice(0, 1500),
      apikey: cfg.callmebotApiKey,
    });
    const res = await fetch(`https://api.callmebot.com/whatsapp.php?${qs.toString()}`);
    const bodyText = await res.text();
    const ok = res.ok && !/error|invalid|banned/i.test(bodyText);

    if (!ok) {
      const errMsg = bodyText.slice(0, 200) || `Erreur CallMeBot (HTTP ${res.status})`;
      await recordWhatsAppLog({
        recipientEmail: `+${targetCallMeBotPhone}`,
        recipientName: params.recipientName,
        subject: params.subject,
        category: params.category,
        status: 'FAILED',
        provider: 'WHATSAPP_CALLMEBOT',
        errorMessage: errMsg,
        relatedEntityId: params.relatedEntityId,
        patientId: params.patientId,
        reminderKey: params.reminderKey,
      });
      return { ok: false, status: 'FAILED', provider: 'WHATSAPP_CALLMEBOT', error: errMsg };
    }

    await recordWhatsAppLog({
      recipientEmail: `+${targetCallMeBotPhone}`,
      recipientName: params.recipientName,
      subject: params.subject,
      category: params.category,
      status: 'SENT',
      provider: 'WHATSAPP_CALLMEBOT',
      providerMessageId: `callmebot-${Date.now()}`,
      relatedEntityId: params.relatedEntityId,
      patientId: params.patientId,
      reminderKey: params.reminderKey,
    });
    return { ok: true, status: 'SENT', provider: 'WHATSAPP_CALLMEBOT', messageId: `callmebot-${Date.now()}` };
  } catch (err: any) {
    const errMsg = err?.message || 'Erreur réseau vers CallMeBot.';
    await recordWhatsAppLog({
      recipientEmail: `+${targetCallMeBotPhone}`,
      recipientName: params.recipientName,
      subject: params.subject,
      category: params.category,
      status: 'FAILED',
      provider: 'WHATSAPP_CALLMEBOT',
      errorMessage: errMsg,
      relatedEntityId: params.relatedEntityId,
      patientId: params.patientId,
      reminderKey: params.reminderKey,
    });
    return { ok: false, status: 'FAILED', provider: 'WHATSAPP_CALLMEBOT', error: errMsg };
  }
}

// ============================================================================
// HIGH-LEVEL CONFIDENTIAL CLINIC WHATSAPP HELPERS (ZERO SENSITIVE MEDICAL DATA)
// ============================================================================

export async function sendAppointmentWhatsApp(params: {
  mode: 'CONFIRMATION' | 'REMINDER_J1';
  patientId: string;
  patientName: string;
  patientPhone?: string;
  doctorName: string;
  date: string;
  startTime: string;
  typeLabel: string;
  appointmentId: string;
  reminderKey?: string;
  force?: boolean;
}) {
  const clinic = await getClinicWhatsAppSettings();
  const isReminder = params.mode === 'REMINDER_J1';
  const text = [
    `*${clinic.clinicName}*`,
    isReminder ? 'Rappel de votre rendez-vous de demain :' : 'Confirmation de votre rendez-vous :',
    `Bonjour ${params.patientName},`,
    `- Motif : ${params.typeLabel}`,
    `- Date : ${params.date} à ${params.startTime}`,
    `- Praticien : ${params.doctorName}`,
    `- Lieu : ${clinic.address}, ${clinic.city}`,
    `Pour toute modification, appelez le ${clinic.phone}.`,
  ].join('\n');

  return sendClinicWhatsApp({
    toPhone: params.patientPhone,
    recipientName: params.patientName,
    subject: isReminder ? `WhatsApp Rappel RDV J-1 (${params.date})` : `WhatsApp Confirmation RDV (${params.date})`,
    messageText: text,
    category: isReminder ? 'RDV_RAPPEL_J1' : 'RDV_CONFIRMATION',
    relatedEntityId: params.appointmentId,
    patientId: params.patientId,
    reminderKey: params.reminderKey,
    force: params.force,
    isPatientRecipient: true,
  });
}

export async function sendFollowUpReminderWhatsApp(params: {
  recipientPhone?: string;
  recipientName: string;
  isPatientRecipient: boolean;
  patientId: string;
  patientName: string;
  followUpId: string;
  followUpTypeLabel: string;
  dueDate: string;
  reason?: string;
  reminderKey?: string;
  force?: boolean;
}) {
  const clinic = await getClinicWhatsAppSettings();
  // Confidentiality rule: never include clinical reason in patient WhatsApp
  const text = params.isPatientRecipient
    ? [
        `*${clinic.clinicName}*`,
        `Bonjour ${params.patientName},`,
        `Nous vous rappelons qu'un rendez-vous de suivi (${params.followUpTypeLabel}) est prévu autour du ${params.dueDate}.`,
        `Merci de contacter le secrétariat au ${clinic.phone} pour confirmer votre créneau.`,
      ].join('\n')
    : [
        `*[CARDIO ERP] Relance Suivi*`,
        `Bonjour ${params.recipientName},`,
        `Suivi à traiter : ${params.followUpTypeLabel} pour ${params.patientName} (échéance : ${params.dueDate}).`,
        `Ouvrez l'onglet Suivis dans CARDIO ERP pour enregistrer le retour.`,
      ].join('\n');

  return sendClinicWhatsApp({
    toPhone: params.recipientPhone,
    recipientName: params.recipientName,
    subject: `WhatsApp Relance suivi — ${params.patientName}`,
    messageText: text,
    category: 'SUIVI_RELANCE',
    relatedEntityId: params.followUpId,
    patientId: params.patientId,
    reminderKey: params.reminderKey,
    force: params.force,
    isPatientRecipient: params.isPatientRecipient,
  });
}

export async function sendExamValidatedWhatsApp(params: {
  patientId: string;
  patientName: string;
  patientPhone?: string;
  examNumber: string;
  examTypeLabel: string;
  examinationId: string;
}) {
  const clinic = await getClinicWhatsAppSettings();
  const text = [
    `*${clinic.clinicName}*`,
    `Bonjour ${params.patientName},`,
    `Le compte rendu de votre examen (${params.examTypeLabel} · réf. ${params.examNumber}) a été validé par votre cardiologue.`,
    `Pour préserver votre confidentialité, veuillez le consulter dans votre espace patient sécurisé ou contacter le secrétariat au ${clinic.phone}.`,
  ].join('\n');

  return sendClinicWhatsApp({
    toPhone: params.patientPhone,
    recipientName: params.patientName,
    subject: `WhatsApp Résultat disponible — ${params.examNumber}`,
    messageText: text,
    category: 'EXAMEN_VALIDE',
    relatedEntityId: params.examinationId,
    patientId: params.patientId,
    isPatientRecipient: true,
  });
}

export async function sendStaffAlertWhatsApp(params: {
  recipientPhone?: string;
  recipientName: string;
  title: string;
  message: string;
  category: EmailDispatchLog['category'];
  relatedEntityId?: string;
  reminderKey?: string;
  force?: boolean;
}) {
  const text = `*[CARDIO ERP]* ${params.title}\nBonjour ${params.recipientName},\n${params.message}`;
  return sendClinicWhatsApp({
    toPhone: params.recipientPhone,
    recipientName: params.recipientName,
    subject: `WhatsApp Alerte — ${params.title}`,
    messageText: text,
    category: params.category,
    relatedEntityId: params.relatedEntityId,
    reminderKey: params.reminderKey,
    force: params.force,
    isPatientRecipient: false,
  });
}

export async function sendTestWhatsApp(toPhone: string, actorName: string) {
  const clinic = await getClinicWhatsAppSettings();
  const text = [
    `*${clinic.clinicName} — Test WhatsApp*`,
    `Bonjour ${actorName},`,
    `La passerelle de relances automatiques WhatsApp CARDIO ERP est opérationnelle (${new Date().toLocaleString('fr-FR')}).`,
  ].join('\n');

  return sendClinicWhatsApp({
    toPhone,
    recipientName: actorName,
    subject: `Test WhatsApp CARDIO ERP`,
    messageText: text,
    category: 'TEST',
    force: true,
    isPatientRecipient: false,
  });
}
