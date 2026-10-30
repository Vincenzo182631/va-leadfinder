#!/usr/bin/env node
// Applies supabase/migrations/*.sql (in order) and supabase/seed/seed.sql to a hosted Supabase project
// over HTTPS via the Supabase Management API — for environments where Postgres port 5432 is blocked.
// Records applied versions in supabase_migrations.schema_migrations (same table the Supabase CLI uses),
// so re-running skips what is already applied and `supabase db push` stays compatible later.
//
// Usage: SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=abcd1234 node scripts/supabase-apply-migrations.mjs [--dry-run]
// Never applies supabase/local/* (local-only shim).
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;
const dryRun = process.argv.includes('--dry-run');
if (!token || !ref) {
  console.error('Set SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF.');
  process.exit(1);
}
if (!/^[a-z0-9]{10,40}$/.test(ref)) {
  console.error('SUPABASE_PROJECT_REF looks wrong (expected the short project id from the dashboard URL).');
  process.exit(1);
}

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : null;
}

const lit = (s) => `'${s.replace(/'/g, "''")}'`;

await query(`create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);`);
const applied = new Set((await query('select version from supabase_migrations.schema_migrations')).map((r) => r.version));

const dir = join(root, 'supabase', 'migrations');
const files = readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
for (const f of files) {
  const [version, ...rest] = f.replace(/\.sql$/, '').split('_');
  if (applied.has(version)) {
    console.log(`skip   ${f} (already applied)`);
    continue;
  }
  const sql = readFileSync(join(dir, f), 'utf8');
  if (dryRun) {
    console.log(`would apply ${f}`);
    continue;
  }
  // One request = one transaction: the migration and its bookkeeping row succeed or fail together.
  await query(`begin;\n${sql}\ninsert into supabase_migrations.schema_migrations (version, name, statements) values (${lit(version)}, ${lit(rest.join('_'))}, array[]::text[]);\ncommit;`);
  console.log(`apply  ${f}`);
}

if (!dryRun) {
  await query(readFileSync(join(root, 'supabase', 'seed', 'seed.sql'), 'utf8'));
  console.log('seed   supabase/seed/seed.sql (idempotent)');
  const check = await query(`select (select count(*) from public.plans) as plans, (select count(*) from public.source_providers) as sources,
    (select count(*) from pg_policies where schemaname = 'public') as policies`);
  console.log('check ', JSON.stringify(check[0]));
}
