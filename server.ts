import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { getEnvConfig } from './server/config/env';
import { authenticateRequest, requireAuth, requireSupabaseConfigured } from './server/middleware/auth';
import { automatedAuditMiddleware } from './server/middleware/auditMiddleware';
import { registerSseClient } from './server/services/eventBus';
import { startSupabaseRealtime } from './server/services/supabaseRealtime';
import { startReminderScheduler } from './server/services/reminderScheduler';
import { systemRouter } from './server/routes/system';
import { authRouter } from './server/routes/auth';
import { usersRouter } from './server/routes/users';
import { patientsRouter } from './server/routes/patients';
import { appointmentsRouter, queueRouter } from './server/routes/appointments';
import { consultationsRouter } from './server/routes/consultations';
import { examinationsRouter } from './server/routes/examinations';
import { followUpsRouter, tasksRouter } from './server/routes/followUpsAndTasks';
import { documentsRouter, notificationsRouter } from './server/routes/documentsAndNotifications';
import { financeRouter } from './server/routes/financeAndStats';
import { renderHtmlWithOpenGraph } from './server/services/ogMeta';

const BOT_UA_REGEX = /WhatsApp|facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|TelegramBot|Discordbot|Googlebot|Applebot/i;

function isHtmlSpaRequest(req: Request): boolean {
  if (req.method !== 'GET') return false;
  const p = req.path || '/';
  if (
    p.startsWith('/api') ||
    p.startsWith('/@') ||
    p.startsWith('/src/') ||
    p.startsWith('/node_modules/') ||
    p.startsWith('/assets/')
  ) {
    return false;
  }
  if (path.extname(p)) return false;
  const accept = req.headers.accept || '';
  const ua = req.headers['user-agent'] || '';
  return accept.includes('text/html') || BOT_UA_REGEX.test(ua) || !accept || accept === '*/*';
}

async function bootstrapServer() {
  const cfg = getEnvConfig();
  const app = express();

  app.set('trust proxy', 1);

  // Baseline security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-XSS-Protection', '0');
    next();
  });

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Attach authenticated user context if valid HttpOnly session cookie exists
  app.use('/api', authenticateRequest);

  // Automated immutable audit trail for every API write action (POST, PATCH, PUT, DELETE)
  app.use('/api', automatedAuditMiddleware);

  // Authenticated real-time synchronization stream (SSE)
  app.get('/api/events', requireSupabaseConfigured, requireAuth, (req, res) => {
    const cleanup = registerSseClient(res);
    req.on('close', cleanup);
  });

  // API Routes
  app.use('/api/system', systemRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/patients', patientsRouter);
  app.use('/api/appointments', appointmentsRouter);
  app.use('/api/queue', queueRouter);
  app.use('/api/consultations', consultationsRouter);
  app.use('/api/examinations', examinationsRouter);
  app.use('/api/follow-ups', followUpsRouter);
  app.use('/api/tasks', tasksRouter);
  app.use('/api/documents', documentsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api', financeRouter);

  // 404 for unknown API routes
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Route API introuvable.' });
  });

  // Safe error handler (never exposes secrets or stack traces to client)
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err?.message === 'SUPABASE_NOT_CONFIGURED') {
      return res.status(503).json({
        error: 'Base de données Supabase non configurée.',
        code: 'SUPABASE_NOT_CONFIGURED',
      });
    }
    if (err?.message === 'R2_NOT_CONFIGURED') {
      return res.status(503).json({
        error: 'Stockage Cloudflare R2 non configuré. Veuillez renseigner les variables R2_* dans le serveur.',
        code: 'R2_NOT_CONFIGURED',
      });
    }
    if (err?.name === 'MulterError' || err?.message?.includes('Format')) {
      return res.status(400).json({ error: err.message });
    }
    console.error('[SERVER_ERROR]', err?.message || err);
    return res.status(err?.status || 500).json({
      error: 'Une erreur interne est survenue. Veuillez réessayer.',
    });
  });

  // Frontend serving: Vite middleware in development, static dist/ in production
  const distDir = path.resolve(process.cwd(), 'dist');
  const devIndexHtmlPath = path.resolve(process.cwd(), 'index.html');
  if (!cfg.isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });

    app.get('*', async (req, res, next) => {
      if (!isHtmlSpaRequest(req)) return next();
      try {
        const rawHtml = await fs.promises.readFile(devIndexHtmlPath, 'utf-8');
        const withOg = await renderHtmlWithOpenGraph(rawHtml, req);
        const transformed = await vite.transformIndexHtml(req.originalUrl, withOg);
        res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(transformed);
      } catch (err) {
        vite.ssrFixStacktrace(err as Error);
        next(err);
      }
    });

    app.use(vite.middlewares);
  } else if (fs.existsSync(distDir)) {
    app.use(express.static(distDir, { index: false }));
    app.get('*', async (req, res, next) => {
      try {
        const prodIndexHtmlPath = path.join(distDir, 'index.html');
        const rawHtml = await fs.promises.readFile(prodIndexHtmlPath, 'utf-8');
        const withOg = await renderHtmlWithOpenGraph(rawHtml, req);
        res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(withOg);
      } catch (err) {
        next(err);
      }
    });
  }

  app.listen(cfg.port, '0.0.0.0', () => {
    console.log(`CARDIO ERP server listening on http://0.0.0.0:${cfg.port}`);
    startSupabaseRealtime();
    startReminderScheduler();
  });
}

bootstrapServer().catch((err) => {
  console.error('Failed to start CARDIO ERP server:', err);
  process.exit(1);
});
