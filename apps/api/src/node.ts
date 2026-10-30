import { serve } from '@hono/node-server';
import { buildDeps, createApp } from './app';
import { loadConfig } from './env';
import { log } from './lib/log';
import { providerFor } from './providers/registry';
import type { SourceProviderRow } from './providers/types';
import { runIngestion } from './services/ingestion';

const config = loadConfig(process.env);
const deps = buildDeps(config);
const app = createApp(deps);
const port = Number(process.env.API_PORT ?? 8787);

if (config.APP_ENV === 'development') {
  // Convenience: load fictional demo data on first start.
  const [demo] = await deps.sql<SourceProviderRow[]>`select * from source_providers where provider_kind = 'synthetic_demo' and enabled limit 1`;
  const [n] = await deps.sql`select count(*)::int as n from opportunities where is_demo`;
  if (demo && n?.n === 0) await runIngestion(deps.sql, demo, providerFor(demo, deps), { triggeredBy: 'dev-startup', now: new Date() });
}

serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () =>
  log('info', 'api.listening', { port, env: config.APP_ENV, auth: config.AUTH_MODE, billing: deps.billing.mode }),
);
