import { EventEmitter } from 'events';
import type { Response } from 'express';

export type SyncScope =
  | 'patient'
  | 'appointment'
  | 'queue'
  | 'consultation'
  | 'examination'
  | 'followup'
  | 'task'
  | 'document'
  | 'payment'
  | 'service'
  | 'notification'
  | 'settings'
  | 'user'
  | 'audit'
  | 'system';

const emitter = new EventEmitter();
emitter.setMaxListeners(200);

export function emitSyncEvent(scopes: SyncScope | SyncScope[]) {
  const list = Array.isArray(scopes) ? scopes : [scopes];
  const payload = JSON.stringify({
    scopes: list,
    at: new Date().toISOString(),
  });
  emitter.emit('sync', payload);
}

export function registerSseClient(res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);

  const onSync = (payload: string) => {
    try {
      res.write(`event: sync\ndata: ${payload}\n\n`);
    } catch {
      // Ignore closed stream
    }
  };

  const keepAlive = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      // Ignore closed stream
    }
  }, 25000);

  emitter.on('sync', onSync);

  return () => {
    clearInterval(keepAlive);
    emitter.off('sync', onSync);
  };
}
