import { isSupabaseConfigured, isWhatsAppConfigured } from '../config/env';
import { repository } from '../repositories/SupabaseRepository';
import { APPOINTMENT_TYPE_LABELS, EXAMINATION_TYPE_LABELS, FOLLOWUP_TYPE_LABELS } from '../../src/shared/constants';
import type { AppointmentType, ExaminationType, FollowUpType } from '../../src/shared/types';
import { sendAppointmentEmail, sendFollowUpReminderEmail, sendStaffAlertEmail } from './emailService';
import {
  sendAppointmentWhatsApp,
  sendFollowUpReminderWhatsApp,
  sendStaffAlertWhatsApp,
} from './whatsappService';
import { emitSyncEvent } from './eventBus';

export interface ReminderRunSummary {
  executedAt: string;
  appointmentsReminded: number;
  followUpsReminded: number;
  tasksEscalated: number;
  examsEscalated: number;
  emailsSent: number;
  emailsFailed: number;
  emailsSkipped: number;
  whatsappSent: number;
  whatsappFailed: number;
  whatsappSkipped: number;
}

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let initialTimeout: ReturnType<typeof setTimeout> | null = null;
let running = false;
let lastReminderRunAt: string | null = null;

function isoDateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function getLastReminderRunAt(): string | null {
  return lastReminderRunAt;
}

/**
 * Automated Reminder Engine ("Relances automatiques" — Resend E-mail + WhatsApp)
 * - J-1 Appointment reminders to patients via Resend & WhatsApp
 * - Due-today & overdue Follow-Ups: notifies assignee + confidential patient recall via Resend & WhatsApp + history entry
 * - Overdue Tasks: internal notification + Resend & WhatsApp alert to assignee
 * - Unvalidated Examinations (>24h): internal notification + Resend & WhatsApp alert to doctors
 * All deduplicated via `reminder_key` in Supabase `email_dispatch_logs`.
 */
export async function runAutomaticReminders(options?: { manualTrigger?: boolean; actorName?: string }): Promise<ReminderRunSummary> {
  const executedAt = new Date().toISOString();
  const summary: ReminderRunSummary = {
    executedAt,
    appointmentsReminded: 0,
    followUpsReminded: 0,
    tasksEscalated: 0,
    examsEscalated: 0,
    emailsSent: 0,
    emailsFailed: 0,
    emailsSkipped: 0,
    whatsappSent: 0,
    whatsappFailed: 0,
    whatsappSkipped: 0,
  };

  if (!isSupabaseConfigured() || running) {
    return summary;
  }

  running = true;
  try {
    const settings = await repository.getClinicSettings();
    const autoEnabled = settings?.notificationChannels?.autoRemindersEnabled ?? true;
    const whatsappChannelEnabled =
      isWhatsAppConfigured() && (settings?.notificationChannels?.whatsappEnabled ?? true);

    if (!options?.manualTrigger && !autoEnabled) {
      return summary;
    }

    const today = isoDateOffset(0);
    const tomorrow = isoDateOffset(1);
    const yesterday = isoDateOffset(-1);

    const [patients, users, appointments, followUps, tasks, examinations] = await Promise.all([
      repository.listPatients({ status: 'ACTIF' }),
      repository.listUsers(),
      repository.listAppointments({ date: tomorrow }),
      repository.listFollowUps({}),
      repository.listTasks({}),
      repository.listExaminations({}),
    ]);

    const patientById = new Map(patients.map((p) => [p._id, p]));
    const userById = new Map(users.map((u) => [u._id, u]));
    const activeDoctors = users.filter((u) => u.isActive && u.roles.includes('MEDECIN'));

    const trackEmailResult = (res: { status: 'SENT' | 'FAILED' | 'SKIPPED' }) => {
      if (res.status === 'SENT') summary.emailsSent += 1;
      else if (res.status === 'FAILED') summary.emailsFailed += 1;
      else summary.emailsSkipped += 1;
    };

    const trackWhatsAppResult = (res: { status: 'SENT' | 'FAILED' | 'SKIPPED' }) => {
      if (res.status === 'SENT') summary.whatsappSent += 1;
      else if (res.status === 'FAILED') summary.whatsappFailed += 1;
      else summary.whatsappSkipped += 1;
    };

    // 1. Rappels de Rendez-vous J-1 (Demain)
    const activeTomorrowAppts = appointments.filter(
      (a) => a.status === 'EN_ATTENTE' || a.status === 'CONFIRME'
    );
    for (const appt of activeTomorrowAppts) {
      const patient = patientById.get(appt.patientId);
      if (!patient) continue;
      const typeLabel = APPOINTMENT_TYPE_LABELS[appt.type as AppointmentType] || appt.type;
      let apptSent = false;

      const emailKey = `appt-j1:${appt._id}:${appt.date}`;
      if (patient.email && !(await repository.hasReminderBeenSent(emailKey))) {
        const res = await sendAppointmentEmail({
          mode: 'REMINDER_J1',
          patientId: patient._id,
          patientName: `${patient.firstName} ${patient.lastName}`,
          patientEmail: patient.email,
          doctorName: appt.doctorName || 'Cardiologue',
          date: appt.date,
          startTime: appt.startTime,
          typeLabel,
          appointmentId: appt._id,
          reminderKey: emailKey,
        });
        trackEmailResult(res);
        if (res.status === 'SENT') apptSent = true;
      }

      const waKey = `wa-appt-j1:${appt._id}:${appt.date}`;
      if (whatsappChannelEnabled && patient.phone && !(await repository.hasReminderBeenSent(waKey))) {
        const waRes = await sendAppointmentWhatsApp({
          mode: 'REMINDER_J1',
          patientId: patient._id,
          patientName: `${patient.firstName} ${patient.lastName}`,
          patientPhone: patient.phone,
          doctorName: appt.doctorName || 'Cardiologue',
          date: appt.date,
          startTime: appt.startTime,
          typeLabel,
          appointmentId: appt._id,
          reminderKey: waKey,
        });
        trackWhatsAppResult(waRes);
        if (waRes.status === 'SENT') apptSent = true;
      }

      if (apptSent) {
        summary.appointmentsReminded += 1;
      }
    }

    // 2. Relances automatiques des Suivis à échéance aujourd'hui ou en retard
    const dueFollowUps = followUps.filter(
      (f) =>
        f.status !== 'TERMINE' &&
        f.status !== 'ANNULE' &&
        f.dueDate <= today
    );

    const PATIENT_RECALL_TYPES = new Set<FollowUpType>([
      'CONTROLE_MEDICAL',
      'RENDEZ_VOUS_SUIVI',
      'RELANCE_ADMINISTRATIVE',
      'APPEL_TELEPHONIQUE',
    ]);

    for (const fup of dueFollowUps) {
      const staffEmailKey = `followup-staff:${fup._id}:${today}`;
      const staffWaKey = `wa-followup-staff:${fup._id}:${today}`;
      const patientEmailKey = `followup-patient:${fup._id}:${today}`;
      const patientWaKey = `wa-followup-patient:${fup._id}:${today}`;
      const typeLabel = FOLLOWUP_TYPE_LABELS[fup.type as FollowUpType] || fup.type;
      const patient = patientById.get(fup.patientId);
      const assignee = userById.get(fup.assigneeId);

      let remindedThisFollowUp = false;
      const historyAdditions: typeof fup.history = [];

      // 2a. Relance au collaborateur responsable (interne + e-mail + WhatsApp)
      const staffEmailAlready = await repository.hasReminderBeenSent(staffEmailKey);
      const staffWaAlready = await repository.hasReminderBeenSent(staffWaKey);

      if (assignee?.isActive && !staffEmailAlready) {
        await repository.createNotification({
          recipientUserId: assignee._id,
          recipientRoles: [],
          eventType: 'SUIVI_A_EFFECTUER',
          title: fup.dueDate < today ? `Suivi en retard : ${fup.patientName}` : `Suivi à traiter aujourd'hui : ${fup.patientName}`,
          message: `${typeLabel} — ${fup.reason} (échéance : ${fup.dueDate}).`,
          linkModule: 'follow-ups',
          relatedEntityId: fup._id,
          readByUserIds: [],
          channel: whatsappChannelEnabled ? 'WHATSAPP' : 'EMAIL',
          createdAt: executedAt,
        });

        if (assignee.email) {
          const staffRes = await sendFollowUpReminderEmail({
            recipientEmail: assignee.email,
            recipientName: `${assignee.firstName} ${assignee.lastName}`,
            isPatientRecipient: false,
            patientId: fup.patientId,
            patientName: fup.patientName || 'Patient',
            followUpId: fup._id,
            followUpTypeLabel: typeLabel,
            dueDate: fup.dueDate,
            reason: fup.reason,
            reminderKey: staffEmailKey,
          });
          trackEmailResult(staffRes);
          if (staffRes.status === 'SENT') remindedThisFollowUp = true;
        }
      }

      if (assignee?.isActive && whatsappChannelEnabled && assignee.phone && !staffWaAlready) {
        const waStaffRes = await sendFollowUpReminderWhatsApp({
          recipientPhone: assignee.phone,
          recipientName: `${assignee.firstName} ${assignee.lastName}`,
          isPatientRecipient: false,
          patientId: fup.patientId,
          patientName: fup.patientName || 'Patient',
          followUpId: fup._id,
          followUpTypeLabel: typeLabel,
          dueDate: fup.dueDate,
          reason: fup.reason,
          reminderKey: staffWaKey,
        });
        trackWhatsAppResult(waStaffRes);
        if (waStaffRes.status === 'SENT') remindedThisFollowUp = true;
      }

      // 2b. Relance e-mail confidentielle directe au patient
      if (
        patient?.email &&
        PATIENT_RECALL_TYPES.has(fup.type) &&
        !(await repository.hasReminderBeenSent(patientEmailKey))
      ) {
        const patRes = await sendFollowUpReminderEmail({
          recipientEmail: patient.email,
          recipientName: `${patient.firstName} ${patient.lastName}`,
          isPatientRecipient: true,
          patientId: patient._id,
          patientName: `${patient.firstName} ${patient.lastName}`,
          followUpId: fup._id,
          followUpTypeLabel: typeLabel,
          dueDate: fup.dueDate,
          reason: fup.reason,
          reminderKey: patientEmailKey,
        });
        trackEmailResult(patRes);
        if (patRes.status === 'SENT') {
          remindedThisFollowUp = true;
          historyAdditions.push({
            at: executedAt,
            byId: 'system-scheduler',
            byName: options?.actorName ? `Relance auto (${options.actorName})` : 'Relance automatique Resend',
            action: 'Relance e-mail envoyée au patient',
            note: `E-mail envoyé à ${patient.email}`,
          });
        }
      }

      // 2c. Relance WhatsApp confidentielle directe au patient
      if (
        whatsappChannelEnabled &&
        patient?.phone &&
        PATIENT_RECALL_TYPES.has(fup.type) &&
        !(await repository.hasReminderBeenSent(patientWaKey))
      ) {
        const patWaRes = await sendFollowUpReminderWhatsApp({
          recipientPhone: patient.phone,
          recipientName: `${patient.firstName} ${patient.lastName}`,
          isPatientRecipient: true,
          patientId: patient._id,
          patientName: `${patient.firstName} ${patient.lastName}`,
          followUpId: fup._id,
          followUpTypeLabel: typeLabel,
          dueDate: fup.dueDate,
          reminderKey: patientWaKey,
        });
        trackWhatsAppResult(patWaRes);
        if (patWaRes.status === 'SENT') {
          remindedThisFollowUp = true;
          historyAdditions.push({
            at: executedAt,
            byId: 'system-scheduler',
            byName: options?.actorName ? `Relance auto (${options.actorName})` : 'Relance automatique WhatsApp',
            action: 'Relance WhatsApp envoyée au patient',
            note: `WhatsApp envoyé à ${patient.phone}`,
          });
        }
      }

      if (historyAdditions.length > 0) {
        await repository.updateFollowUp(fup._id, {
          history: [...(fup.history || []), ...historyAdditions],
          updatedAt: executedAt,
        });
      }

      if (remindedThisFollowUp) {
        summary.followUpsReminded += 1;
      }
    }

    // 3. Tâches en retard -> notification interne + e-mail & WhatsApp responsable
    const overdueTasks = tasks.filter(
      (t) => t.status !== 'TERMINEE' && t.status !== 'ANNULEE' && t.dueDate < today
    );
    for (const task of overdueTasks) {
      const taskKey = `task-overdue:${task._id}:${today}`;
      const taskWaKey = `wa-task-overdue:${task._id}:${today}`;
      const assignee = userById.get(task.assigneeId);
      if (!assignee?.isActive) continue;

      let escalated = false;
      if (!(await repository.hasReminderBeenSent(taskKey))) {
        await repository.createNotification({
          recipientUserId: assignee._id,
          recipientRoles: [],
          eventType: 'TACHE_EN_RETARD',
          title: `Tâche en retard : ${task.title}`,
          message: `Date limite dépassée (${task.dueDate}). Merci de mettre à jour l'avancement.`,
          linkModule: 'tasks',
          relatedEntityId: task._id,
          readByUserIds: [],
          channel: 'EMAIL',
          createdAt: executedAt,
        });

        if (assignee.email) {
          const res = await sendStaffAlertEmail({
            recipientEmail: assignee.email,
            recipientName: `${assignee.firstName} ${assignee.lastName}`,
            title: `Tâche en retard : ${task.title}`,
            message: `La tâche « ${task.title} » (échéance ${task.dueDate}) est toujours ouverte. Merci de la traiter dans CARDIO ERP.`,
            category: 'TACHE_RETARD',
            linkPath: '/taches',
            relatedEntityId: task._id,
            reminderKey: taskKey,
          });
          trackEmailResult(res);
          if (res.status === 'SENT') escalated = true;
        }
      }

      if (whatsappChannelEnabled && assignee.phone && !(await repository.hasReminderBeenSent(taskWaKey))) {
        const waRes = await sendStaffAlertWhatsApp({
          recipientPhone: assignee.phone,
          recipientName: `${assignee.firstName} ${assignee.lastName}`,
          title: `Tâche en retard : ${task.title}`,
          message: `La tâche « ${task.title} » (échéance ${task.dueDate}) est toujours ouverte dans CARDIO ERP.`,
          category: 'TACHE_RETARD',
          relatedEntityId: task._id,
          reminderKey: taskWaKey,
        });
        trackWhatsAppResult(waRes);
        if (waRes.status === 'SENT') escalated = true;
      }

      if (escalated) summary.tasksEscalated += 1;
    }

    // 4. Examens non validés depuis plus de 24h -> alerte médecins
    const staleExams = examinations.filter(
      (e) =>
        ['REALISE', 'RESULTAT_DISPONIBLE', 'A_INTERPRETER'].includes(e.status) &&
        (e.performedDate || e.prescriptionDate) <= yesterday
    );
    for (const ex of staleExams) {
      const examKey = `exam-unvalidated:${ex._id}:${today}`;
      const examWaKey = `wa-exam-unvalidated:${ex._id}:${today}`;
      const examLabel = EXAMINATION_TYPE_LABELS[ex.type as ExaminationType] || ex.type;
      const targetDoctor =
        (ex.prescribingDoctorId && userById.get(ex.prescribingDoctorId)) || activeDoctors[0];
      if (!targetDoctor?.isActive) continue;

      let escalated = false;
      const doctorFullName = `${targetDoctor.title ? targetDoctor.title + ' ' : ''}${targetDoctor.firstName} ${targetDoctor.lastName}`.trim();

      if (!(await repository.hasReminderBeenSent(examKey))) {
        await repository.createNotification({
          recipientUserId: targetDoctor._id,
          recipientRoles: ['MEDECIN'],
          eventType: 'EXAMEN_A_INTERPRETER',
          title: `Relance : ${examLabel} (${ex.examNumber}) en attente de validation`,
          message: `L'examen de ${ex.patientName} attend toujours votre validation médicale.`,
          linkModule: 'examinations',
          relatedEntityId: ex._id,
          readByUserIds: [],
          channel: 'EMAIL',
          createdAt: executedAt,
        });

        if (targetDoctor.email) {
          const res = await sendStaffAlertEmail({
            recipientEmail: targetDoctor.email,
            recipientName: doctorFullName,
            title: `Examen en attente de validation : ${ex.examNumber}`,
            message: `L'examen ${examLabel} (${ex.examNumber}) pour ${ex.patientName} est en attente d'interprétation et validation médicale.`,
            category: 'EXAMEN_VALIDE',
            linkPath: '/examens',
            relatedEntityId: ex._id,
            reminderKey: examKey,
          });
          trackEmailResult(res);
          if (res.status === 'SENT') escalated = true;
        }
      }

      if (whatsappChannelEnabled && targetDoctor.phone && !(await repository.hasReminderBeenSent(examWaKey))) {
        const waRes = await sendStaffAlertWhatsApp({
          recipientPhone: targetDoctor.phone,
          recipientName: doctorFullName,
          title: `Examen à valider : ${ex.examNumber}`,
          message: `L'examen ${examLabel} (${ex.examNumber}) pour ${ex.patientName} attend votre validation médicale dans CARDIO ERP.`,
          category: 'EXAMEN_VALIDE',
          relatedEntityId: ex._id,
          reminderKey: examWaKey,
        });
        trackWhatsAppResult(waRes);
        if (waRes.status === 'SENT') escalated = true;
      }

      if (escalated) summary.examsEscalated += 1;
    }

    lastReminderRunAt = executedAt;
    if (
      summary.appointmentsReminded > 0 ||
      summary.followUpsReminded > 0 ||
      summary.tasksEscalated > 0 ||
      summary.examsEscalated > 0
    ) {
      emitSyncEvent(['notification', 'followup', 'task', 'examination']);
    }
    return summary;
  } catch (err: any) {
    console.error('[REMINDER_SCHEDULER_ERROR]', err?.message || err);
    return summary;
  } finally {
    running = false;
  }
}

export function startReminderScheduler(): void {
  if (schedulerInterval || initialTimeout) return;
  // Initial check 30s after startup, then every 15 minutes
  initialTimeout = setTimeout(() => {
    runAutomaticReminders().catch(() => undefined);
    schedulerInterval = setInterval(() => {
      runAutomaticReminders().catch(() => undefined);
    }, 15 * 60 * 1000);
  }, 30_000);
}

export function stopReminderScheduler(): void {
  if (initialTimeout) {
    clearTimeout(initialTimeout);
    initialTimeout = null;
  }
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
