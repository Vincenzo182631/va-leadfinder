import { log } from '../lib/log';
import { providerFor } from '../providers/registry';
import type { SourceProviderRow } from '../providers/types';
import { runDigests } from '../services/digest';
import { runIngestion, runMaintenance } from '../services/ingestion';
import type { Deps } from '../types';

/**
 * Central, owner-controlled scheduled work (Cloudflare Cron Trigger or POST /api/internal/jobs/:job).
 * Licensed sources are fetched once centrally — never per subscriber or per page view.
 */
export async function runJob(deps: Deps, job: 'ingest' | 'maintenance' | 'digest') {
  if (job === 'maintenance') return runMaintenance(deps.sql, deps.now());
  if (job === 'digest') return runDigests(deps);
  const rows = await deps.sql<SourceProviderRow[]>`select * from source_providers where enabled and provider_kind = 'licensed_api'`;
  const results = [];
  for (const row of rows) {
    results.push(await runIngestion(deps.sql, row, providerFor(row, deps), { triggeredBy: 'cron', now: deps.now() }));
  }
  log('info', 'job.ingest', { providers: rows.length });
  return { providers: rows.length, results };
}
