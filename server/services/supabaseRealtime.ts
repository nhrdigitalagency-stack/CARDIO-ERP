import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import { getEnvConfig, isSupabaseConfigured } from '../config/env';
import { emitSyncEvent, type SyncScope } from './eventBus';

let activeChannel: RealtimeChannel | null = null;
let started = false;

const TABLE_TO_SCOPES: Record<string, SyncScope[]> = {
  users: ['user'],
  roles: ['user'],
  clinic_settings: ['settings'],
  patients: ['patient'],
  medical_records: ['patient'],
  medical_histories: ['patient'],
  allergies: ['patient'],
  medications: ['patient'],
  vital_signs: ['patient', 'consultation'],
  diagnoses: ['patient', 'consultation'],
  prescriptions: ['patient', 'consultation'],
  appointments: ['appointment', 'queue'],
  consultations: ['consultation', 'patient'],
  examinations: ['examination', 'patient'],
  examination_results: ['examination', 'patient'],
  medical_documents: ['document', 'examination', 'patient'],
  follow_ups: ['followup', 'patient'],
  tasks: ['task'],
  notifications: ['notification'],
  email_dispatch_logs: ['notification', 'settings'],
  medical_services: ['service'],
  payments: ['payment', 'patient'],
  audit_logs: ['audit'],
};

export function startSupabaseRealtime(): void {
  if (!isSupabaseConfigured() || started) return;
  const cfg = getEnvConfig();

  try {
    started = true;
    const client = createClient(cfg.supabaseUrl, cfg.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    activeChannel = client
      .channel('cardio-erp-db-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public' },
        (payload) => {
          const scopes = TABLE_TO_SCOPES[payload.table] || ['system'];
          emitSyncEvent(scopes);
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // Graceful fallback: Express routes already emit direct SSE sync events
          started = false;
        }
      });
  } catch (err: any) {
    started = false;
    console.warn('[SUPABASE_REALTIME_WARN]', err?.message || err);
  }
}

export function stopSupabaseRealtime(): void {
  if (activeChannel) {
    activeChannel.unsubscribe().catch(() => undefined);
    activeChannel = null;
  }
  started = false;
}
