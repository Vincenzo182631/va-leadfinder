// Loads the fictional demo dataset through the normal ingestion pipeline.
import { buildDeps } from '../app';
import { loadConfig } from '../env';
import { providerFor } from '../providers/registry';
import type { SourceProviderRow } from '../providers/types';
import { runIngestion } from '../services/ingestion';

const deps = buildDeps(loadConfig(process.env));
const [row] = await deps.sql<SourceProviderRow[]>`select * from source_providers where provider_kind = 'synthetic_demo'`;
if (!row) throw new Error('Demo provider row missing — run the seed SQL first');
const r = await runIngestion(deps.sql, row, providerFor(row, deps), { triggeredBy: 'seed-script', now: new Date() });
console.log(JSON.stringify({ status: r.status, accepted: r.accepted, duplicates: r.duplicates, rejected: r.rejected }));
await deps.sql.end();
