// Creates PayMongo subscription plans for our DB plans and stores their ids.
// Usage: PAYMONGO_MODE=test PAYMONGO_SECRET_KEY=sk_test_... pnpm --filter @vlf/api paymongo:create-plans
import { createSql } from '../db';

const mode = process.env.PAYMONGO_MODE;
const key = process.env.PAYMONGO_SECRET_KEY ?? '';
if (mode !== 'test' && mode !== 'live') throw new Error('Set PAYMONGO_MODE=test or live');
if (!key.startsWith(`sk_${mode}_`)) throw new Error(`PAYMONGO_SECRET_KEY must be an sk_${mode}_ key`);
if (mode === 'live' && process.env.CONFIRM_LIVE !== 'yes') throw new Error('Refusing to create LIVE plans without CONFIRM_LIVE=yes');

const sql = createSql(process.env.DATABASE_URL!);
const col = mode === 'live' ? 'provider_plan_id_live' : 'provider_plan_id_test';
const plans = await sql`select * from plans where active and php_amount > 0 order by sort_order`;
for (const p of plans) {
  if (p[col]) { console.log(`${p.code}: already ${p[col]}`); continue; }
  const res = await fetch('https://api.paymongo.com/v1/subscriptions/plans', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa(`${key}:`), 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { attributes: { name: `VA LeadFinder ${p.name}`, amount: p.php_amount * 100, currency: 'PHP', interval: 'month', interval_count: 1, description: p.description } } }),
  });
  const j = (await res.json()) as { data?: { id: string }; errors?: unknown };
  if (!res.ok || !j.data) { console.error(`${p.code}: failed`, res.status, JSON.stringify(j.errors)); continue; }
  await sql.unsafe(`update plans set ${col} = $1 where id = $2`, [j.data.id, p.id]);
  console.log(`${p.code}: created ${j.data.id}`);
}
await sql.end();
