// DEVELOPMENT ONLY: creates a local test VA and a test admin with RANDOM passwords (printed once).
// Refuses to run outside development/test or when AUTH_MODE is not "local".
import { loadConfig } from '../env';
import { createSql } from '../db';
import { randomToken } from '../lib/crypto';

const cfg = loadConfig(process.env);
if (cfg.AUTH_MODE !== 'local' || !['development', 'test'].includes(cfg.APP_ENV)) throw new Error('Dev fixtures are only for local development.');
const sql = createSql(cfg.DATABASE_URL);
const users = [
  { email: 'va.tester@example.test', name: 'Test VA', admin: false },
  { email: 'admin.tester@example.test', name: 'Test Admin', admin: true },
];
for (const u of users) {
  const password = randomToken(9);
  const [row] = await sql`insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data)
    values (${u.email}, crypt(${password}, gen_salt('bf', 10)), now(), ${sql.json({ display_name: u.name })})
    on conflict (email) do update set encrypted_password = excluded.encrypted_password returning id`;
  await sql`insert into user_preferences (user_id, skills, work_types) values (${row!.id}, ${['general_va', 'ghl_crm', 'executive_assistant']}, ${['contract', 'part_time', 'freelance']}) on conflict do nothing`;
  await sql`update profiles set display_name = ${u.name}, onboarding_completed = true where user_id = ${row!.id}`;
  console.log(`${u.admin ? 'ADMIN' : 'USER '}  ${u.email}  password: ${password}  id: ${row!.id}`);
}
console.log('\nAdd the ADMIN id to ADMIN_USER_IDS in .env (server-side) and restart the API.');
await sql.end();
