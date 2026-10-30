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

/** Must match [triggers] crons in wrangler.toml. Unknown schedules are ignored, never defaulted. */
const CRON_JOBS: Record<string, 'ingest' | 'maintenance' | 'digest'> = {
  '0 */6 * * *': 'ingest',
  '30 18 * * *': 'maintenance',
  '0 22 * * *': 'digest',
};

export default {
  async fetch(req: Request, env: WorkerEnv, ctx: ExecutionContext) {
    const deps = depsFor(env);
    const res = await createApp(deps).fetch(req, env, ctx);
    ctx.waitUntil(deps.sql.end({ timeout: 5 }));
    return res;
  },
  async scheduled(event: ScheduledController, env: WorkerEnv, ctx: ExecutionContext) {
    const deps = depsFor(env);
    const job = CRON_JOBS[event.cron];
    if (!job) {
      console.warn(JSON.stringify({ level: 'warn', msg: 'cron.unmapped', cron: event.cron }));
      return;
    }
    ctx.waitUntil(runJob(deps, job).finally(() => deps.sql.end({ timeout: 5 })));
  },
};
