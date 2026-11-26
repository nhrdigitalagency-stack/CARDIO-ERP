import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

// Ephemeral fallback only used when SESSION_SECRET is unset (flagged in system status)
const EPHEMERAL_SECRET = crypto.randomBytes(32).toString('hex');

export interface AppEnvConfig {
  // Supabase
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;

  // Cloudflare R2 (S3-compatible)
  r2AccountId: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  r2BucketName: string;
  r2Endpoint: string;

  // Resend
  resendApiKey: string;
  resendFromEmail: string;

  // WhatsApp (Meta Cloud API ou CallMeBot)
  whatsappProvider: 'cloud_api' | 'callmebot' | null;
  whatsappPhoneNumberId: string;
  whatsappAccessToken: string;
  whatsappApiVersion: string;
  whatsappTemplateName: string;
  whatsappTemplateLang: string;
  callmebotApiKey: string;
  callmebotPhone: string;
  whatsappDefaultCountryCode: string;

  // Security & App
  appUrl: string;
  sessionSecret: string;
  sessionSecretConfigured: boolean;
  isProduction: boolean;
  port: number;
}

export function getEnvConfig(): AppEnvConfig {
  const supabaseUrl = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || '').trim();
  const supabaseServiceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  const r2AccountId = (process.env.R2_ACCOUNT_ID || '').trim();
  const r2AccessKeyId = (process.env.R2_ACCESS_KEY_ID || '').trim();
  const r2SecretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const r2BucketName = (process.env.R2_BUCKET_NAME || '').trim();
  const rawR2Endpoint = (process.env.R2_ENDPOINT || '').trim().replace(/\/+$/, '');
  const r2Endpoint = rawR2Endpoint || (r2AccountId ? `https://${r2AccountId}.r2.cloudflarestorage.com` : '');

  const resendApiKey = (process.env.RESEND_API_KEY || '').trim();
  const resendFromEmail = (
    process.env.RESEND_FROM_EMAIL || 'Cabinet Cardiologie Paris 16 <onboarding@resend.dev>'
  ).trim();

  const whatsappPhoneNumberId = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  const whatsappAccessToken = (process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
  const whatsappApiVersion = (process.env.WHATSAPP_API_VERSION || 'v21.0').trim();
  const whatsappTemplateName = (process.env.WHATSAPP_TEMPLATE_NAME || '').trim();
  const whatsappTemplateLang = (process.env.WHATSAPP_TEMPLATE_LANG || 'fr').trim();
  const callmebotApiKey = (process.env.CALLMEBOT_API_KEY || '').trim();
  const callmebotPhone = (process.env.CALLMEBOT_PHONE || '').trim();
  const whatsappDefaultCountryCode = (process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || '237').trim().replace(/^\+/, '');

  const explicitWaProvider = (process.env.WHATSAPP_PROVIDER || '').trim().toLowerCase();
  let whatsappProvider: 'cloud_api' | 'callmebot' | null = null;
  if (explicitWaProvider === 'cloud_api' && whatsappPhoneNumberId && whatsappAccessToken) {
    whatsappProvider = 'cloud_api';
  } else if (explicitWaProvider === 'callmebot' && callmebotApiKey && callmebotPhone) {
    whatsappProvider = 'callmebot';
  } else if (!explicitWaProvider) {
    if (whatsappPhoneNumberId && whatsappAccessToken) whatsappProvider = 'cloud_api';
    else if (callmebotApiKey && callmebotPhone) whatsappProvider = 'callmebot';
  }

  const rawSessionSecret = (process.env.SESSION_SECRET || '').trim();
  const appUrl = (process.env.APP_URL || 'http://localhost:3000').trim().replace(/\/+$/, '');

  return {
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey,
    r2AccountId,
    r2AccessKeyId,
    r2SecretAccessKey,
    r2BucketName,
    r2Endpoint,
    resendApiKey,
    resendFromEmail,
    whatsappProvider,
    whatsappPhoneNumberId,
    whatsappAccessToken,
    whatsappApiVersion,
    whatsappTemplateName,
    whatsappTemplateLang,
    callmebotApiKey,
    callmebotPhone,
    whatsappDefaultCountryCode,
    appUrl,
    sessionSecret: rawSessionSecret || EPHEMERAL_SECRET,
    sessionSecretConfigured: rawSessionSecret.length >= 16,
    isProduction: process.env.NODE_ENV === 'production',
    port: Number(process.env.PORT || 3000),
  };
}

export function isSupabaseConfigured(): boolean {
  const cfg = getEnvConfig();
  return Boolean(cfg.supabaseUrl && cfg.supabaseServiceRoleKey);
}

export function isR2Configured(): boolean {
  const cfg = getEnvConfig();
  return Boolean(cfg.r2Endpoint && cfg.r2AccessKeyId && cfg.r2SecretAccessKey && cfg.r2BucketName);
}

export function isResendConfigured(): boolean {
  const cfg = getEnvConfig();
  return Boolean(cfg.resendApiKey && cfg.resendFromEmail);
}

export function isWhatsAppConfigured(): boolean {
  const cfg = getEnvConfig();
  return cfg.whatsappProvider !== null;
}

export function getMissingEnvVars(): string[] {
  const cfg = getEnvConfig();
  const missing: string[] = [];
  if (!cfg.supabaseUrl) missing.push('SUPABASE_URL');
  if (!cfg.supabaseServiceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!cfg.supabaseAnonKey) missing.push('SUPABASE_ANON_KEY');
  if (!cfg.r2AccountId && !cfg.r2Endpoint) missing.push('R2_ACCOUNT_ID');
  if (!cfg.r2AccessKeyId) missing.push('R2_ACCESS_KEY_ID');
  if (!cfg.r2SecretAccessKey) missing.push('R2_SECRET_ACCESS_KEY');
  if (!cfg.r2BucketName) missing.push('R2_BUCKET_NAME');
  if (!cfg.resendApiKey) missing.push('RESEND_API_KEY');
  if (!cfg.sessionSecretConfigured) missing.push('SESSION_SECRET');
  return missing;
}
