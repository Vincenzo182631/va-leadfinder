import { buildDeps, createApp } from './app';
import { createSql } from './db';
import { loadConfig } from './env';
import { runJob } from './jobs/scheduled';

interface WorkerEnv extends Record<string, unknown> {
  HYPERDRIVE?: { connectionString: string };
}

function depsFor(env: WorkerEnv) {
  const url = env.HYPERDRIVE?.connectionString ?? String(env.DATABASE_URL ?? '');
  const config = loadConfig({ ...env, DATABASE_URL: url });
  // One small pool per request/isolate; Hyperdrive does the real pooling.
  return buildDeps(config, { sql: createSql(url, { max: 5, prepare: config.DATABASE_PREPARE }) });
}

export default {
  async fetch(req: Request, env: WorkerEnv, ctx: ExecutionContext) {
    const deps = depsFor(env);
    const res = await createApp(deps).fetch(req, env, ctx);
    ctx.waitUntil(deps.sql.end({ timeout: 5 }));
    return res;
  },
  async scheduled(event: ScheduledController, env: WorkerEnv, ctx: ExecutionContext) {
    const deps = depsFor(env);
    const job = event.cron === '0 22 * * *' ? 'digest' : event.cron === '30 18 * * *' ? 'maintenance' : 'ingest';
    ctx.waitUntil(runJob(deps, job).finally(() => deps.sql.end({ timeout: 5 })));
  },
};
