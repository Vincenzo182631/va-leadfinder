import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { localAuthRoutes } from './auth/local-routes';
import { localVerifier, supabaseVerifier } from './auth/verifier';
import { createSql } from './db';
import type { Config } from './env';
import { runJob } from './jobs/scheduled';
import { ApiError, notFound } from './lib/errors';
import { timingSafeEqual } from './lib/crypto';
import { authenticate, errorHandler, requestContext } from './middleware/core';
import { rateLimit } from './middleware/rate-limit';
import { adminRoutes } from './routes/admin';
import { billingRoutes, devBillingRoutes, webhookRoutes } from './routes/billing';
import { publicRoutes } from './routes/public';
import { userRoutes } from './routes/user';
import { createBilling } from './services/billing/providers';
import { createEmail } from './services/email';
import type { AppEnv, Deps } from './types';

export function buildDeps(config: Config, overrides: Partial<Deps> = {}): Deps {
  const localAuth = config.AUTH_MODE === 'local' ? localVerifier(config) : undefined;
  return {
    config,
    sql: overrides.sql ?? createSql(config.DATABASE_URL, { prepare: config.DATABASE_PREPARE }),
    verifier: overrides.verifier ?? (localAuth ?? supabaseVerifier(config)),
    localAuth,
    billing: overrides.billing ?? createBilling(config),
    email: overrides.email ?? createEmail(config),
    now: overrides.now ?? (() => new Date()),
  };
}

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();
  deps.selfFetch = (req) => Promise.resolve(app.fetch(req));

  app.use('*', async (c, next) => {
    c.set('deps', deps);
    await next();
  });
  app.use('*', requestContext);
  app.use('*', secureHeaders({ strictTransportSecurity: deps.config.isProduction ? 'max-age=63072000; includeSubDomains' : false }));
  app.use('/api/*', cors({ origin: deps.config.corsOrigins, allowHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'], allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'], maxAge: 600 }));
  app.use('/api/*', async (c, next) => {
    await next();
    if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'no-store');
  });
  app.use('/api/*', authenticate);

  // Order matters: unauthenticated routes first.
  app.route('/api', publicRoutes);
  app.route('/api/webhooks', webhookRoutes);
  if (deps.config.AUTH_MODE === 'local' && !deps.config.isProduction) app.route('/api/dev-auth', localAuthRoutes);
  if (deps.billing.mode === 'mock' && !deps.config.isProduction) app.route('/api/dev/billing', devBillingRoutes);

  app.post('/api/internal/jobs/:job', rateLimit('jobs', 10, 60_000), async (c) => {
    const token = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    const expected = deps.config.INTERNAL_JOB_TOKEN;
    if (!expected || expected.length < 32 || !timingSafeEqual(token, expected)) throw new ApiError(401, 'unauthorized', 'Invalid job token');
    const job = c.req.param('job');
    if (job !== 'ingest' && job !== 'maintenance' && job !== 'digest') throw notFound('Job');
    return c.json(await runJob(deps, job));
  });

  app.route('/api/admin', adminRoutes);
  app.route('/api', billingRoutes);
  app.route('/api', userRoutes);

  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Not found', requestId: c.get('requestId') } }, 404));
  app.onError(errorHandler);
  return app;
}
