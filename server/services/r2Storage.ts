import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import { getEnvConfig, isR2Configured } from '../config/env';

let cachedR2Client: S3Client | null = null;
let cachedEndpointKey = '';

function getR2Client(): S3Client {
  const cfg = getEnvConfig();
  if (!isR2Configured()) {
    throw new Error('R2_NOT_CONFIGURED');
  }
  const cacheKey = `${cfg.r2Endpoint}|${cfg.r2AccessKeyId}|${cfg.r2BucketName}`;
  if (!cachedR2Client || cachedEndpointKey !== cacheKey) {
    cachedR2Client = new S3Client({
      region: 'auto',
      endpoint: cfg.r2Endpoint,
      credentials: {
        accessKeyId: cfg.r2AccessKeyId,
        secretAccessKey: cfg.r2SecretAccessKey,
      },
    });
    cachedEndpointKey = cacheKey;
  }
  return cachedR2Client;
}

/**
 * Validates that an R2 object key stays strictly inside allowed prefixes without traversal.
 */
export function assertSafeR2Key(key: string, allowedPrefix: 'documents/' | 'branding/'): string {
  const normalized = key.trim().replace(/^\/+/, '');
  if (
    !normalized.startsWith(allowedPrefix) ||
    normalized.includes('..') ||
    normalized.includes('\\') ||
    !/^[a-zA-Z0-9/_\-.]+$/.test(normalized)
  ) {
    throw new Error('Clé de stockage R2 invalide.');
  }
  return normalized;
}

export async function testR2Connection(): Promise<{ ok: boolean; bucket?: string; error?: string }> {
  const cfg = getEnvConfig();
  if (!isR2Configured()) {
    return {
      ok: false,
      error: 'Variables Cloudflare R2 manquantes (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME).',
    };
  }
  try {
    const client = getR2Client();
    await client.send(new HeadBucketCommand({ Bucket: cfg.r2BucketName }));
    return { ok: true, bucket: cfg.r2BucketName };
  } catch (err: any) {
    return {
      ok: false,
      bucket: cfg.r2BucketName,
      error: err?.message || 'Impossible de contacter le bucket Cloudflare R2.',
    };
  }
}

export async function uploadFileToR2(params: {
  key: string;
  body: Buffer;
  contentType: string;
  allowedPrefix: 'documents/' | 'branding/';
  metadata?: Record<string, string>;
}): Promise<{ key: string; etag?: string }> {
  const cfg = getEnvConfig();
  const safeKey = assertSafeR2Key(params.key, params.allowedPrefix);
  const client = getR2Client();

  const res = await client.send(
    new PutObjectCommand({
      Bucket: cfg.r2BucketName,
      Key: safeKey,
      Body: params.body,
      ContentType: params.contentType,
      Metadata: params.metadata,
    })
  );

  return { key: safeKey, etag: res.ETag };
}

export async function getFileStreamFromR2(
  key: string,
  allowedPrefix: 'documents/' | 'branding/'
): Promise<{ stream: Readable; contentType?: string; contentLength?: number }> {
  const cfg = getEnvConfig();
  const safeKey = assertSafeR2Key(key, allowedPrefix);
  const client = getR2Client();

  const res = await client.send(
    new GetObjectCommand({
      Bucket: cfg.r2BucketName,
      Key: safeKey,
    })
  );

  if (!res.Body) {
    throw new Error('Objet R2 vide ou introuvable.');
  }

  let stream: Readable;
  if (res.Body instanceof Readable) {
    stream = res.Body;
  } else if (typeof (res.Body as any).transformToByteArray === 'function') {
    const bytes = await (res.Body as any).transformToByteArray();
    stream = Readable.from(Buffer.from(bytes));
  } else {
    stream = Readable.from(res.Body as any);
  }

  return {
    stream,
    contentType: res.ContentType,
    contentLength: res.ContentLength,
  };
}

export async function getPresignedR2DownloadUrl(
  key: string,
  allowedPrefix: 'documents/' | 'branding/',
  expiresInSeconds = 300
): Promise<string> {
  const cfg = getEnvConfig();
  const safeKey = assertSafeR2Key(key, allowedPrefix);
  const client = getR2Client();

  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: cfg.r2BucketName,
      Key: safeKey,
    }),
    { expiresIn: expiresInSeconds }
  );
}

export async function deleteFileFromR2(
  key: string,
  allowedPrefix: 'documents/' | 'branding/'
): Promise<void> {
  const cfg = getEnvConfig();
  const safeKey = assertSafeR2Key(key, allowedPrefix);
  const client = getR2Client();
  await client.send(
    new DeleteObjectCommand({
      Bucket: cfg.r2BucketName,
      Key: safeKey,
    })
  );
}
