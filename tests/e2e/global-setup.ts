import postgres from 'postgres';
import { randomBytes } from 'node:crypto';

export const E2E_ADMIN = { id: '00000000-0000-4000-8000-0000000e2e01', email: 'e2e.admin@example.test' };

/** Creates the e2e admin with a fresh random password (passed to tests via env, never stored). */
export default async function globalSetup() {
  const sql = postgres('postgres://postgres@127.0.0.1:54329/vlf_e2e', { onnotice: () => {} });
  const password = randomBytes(12).toString('hex');
  await sql`insert into auth.users (id, email, encrypted_password, email_confirmed_at) values (${E2E_ADMIN.id}, ${E2E_ADMIN.email}, crypt(${password}, gen_salt('bf', 4)), now())
    on conflict (id) do update set encrypted_password = excluded.encrypted_password`;
  await sql`insert into user_preferences (user_id, skills, work_types) values (${E2E_ADMIN.id}, ${['general_va']}, ${['contract']}) on conflict do nothing`;
  await sql`update profiles set display_name = 'E2E Admin', onboarding_completed = true where user_id = ${E2E_ADMIN.id}`;
  await sql.end();
  process.env.E2E_ADMIN_PASSWORD = password;
}
