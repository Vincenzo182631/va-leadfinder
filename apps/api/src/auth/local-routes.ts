import { Hono } from 'hono';
import { z } from 'zod';
import { ApiError, notFound } from '../lib/errors';
import { log } from '../lib/log';
import { randomToken, sha256Hex } from '../lib/crypto';
import { jsonBody } from '../middleware/core';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv } from '../types';

/**
 * DEVELOPMENT-ONLY email/password auth backed by the local auth shim (pgcrypto bcrypt).
 * Mounted only when AUTH_MODE=local, which config validation refuses in staging/production.
 * Production uses Supabase Auth (email confirmation, reset emails) directly from the browser.
 */
export const localAuthRoutes = new Hono<AppEnv>();
localAuthRoutes.use('*', rateLimit('auth', 20, 60_000));

const creds = z.object({ email: z.email().max(254).transform((v) => v.toLowerCase()), password: z.string().min(8, 'Use at least 8 characters').max(128) });
const GENERIC_FAIL = 'Email or password is incorrect.';

localAuthRoutes.post('/signup', async (c) => {
  const b = await jsonBody(c, creds.extend({ displayName: z.string().trim().max(80).optional().default('') }));
  const { sql, localAuth } = c.get('deps');
  const rows = await sql`insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data)
    values (${b.email}, crypt(${b.password}, gen_salt('bf', 10)), now(), ${sql.json({ display_name: b.displayName })})
    on conflict (email) do nothing returning id`;
  // Do not reveal whether an account already exists.
  if (!rows.length) return c.json({ ok: true, message: 'If this email can be registered, you can now sign in.' }, 200);
  await sql`insert into product_events (user_id, event) values (${rows[0]!.id}, 'signup_completed')`;
  const token = await localAuth!.issue(rows[0]!.id, b.email);
  return c.json({ ok: true, accessToken: token, user: { id: rows[0]!.id, email: b.email }, notice: 'Local development mode: email confirmation is skipped.' }, 201);
});

localAuthRoutes.post('/login', async (c) => {
  const b = await jsonBody(c, creds);
  const { sql, localAuth } = c.get('deps');
  const [u] = await sql`select id, email from auth.users where email = ${b.email} and encrypted_password = crypt(${b.password}, encrypted_password)`;
  if (!u) throw new ApiError(401, 'invalid_credentials', GENERIC_FAIL);
  return c.json({ accessToken: await localAuth!.issue(u.id, u.email), user: { id: u.id, email: u.email } });
});

localAuthRoutes.post('/forgot', async (c) => {
  const { email } = await jsonBody(c, z.object({ email: z.email().max(254).transform((v) => v.toLowerCase()) }));
  const { sql, config } = c.get('deps');
  const [u] = await sql`select id from auth.users where email = ${email}`;
  if (u) {
    const token = randomToken(24);
    await sql`insert into auth.dev_reset_tokens (token_hash, user_id, expires_at) values (${await sha256Hex(token)}, ${u.id}, now() + interval '30 minutes')`;
    // Dev only: the link goes to the server console instead of an email (no sensitive data in logs besides this dev token).
    console.log(`[dev-auth] password reset link: ${config.APP_BASE_URL}/reset-password#token=${token}`);
    log('info', 'dev_auth.reset_link_issued', {});
  }
  return c.json({ ok: true, message: 'If an account exists for that email, a reset link has been sent.' });
});

localAuthRoutes.post('/reset', async (c) => {
  const b = await jsonBody(c, z.object({ token: z.string().min(10).max(200), password: z.string().min(8).max(128) }));
  const { sql } = c.get('deps');
  const hash = await sha256Hex(b.token);
  const [t] = await sql`update auth.dev_reset_tokens set used_at = now() where token_hash = ${hash} and used_at is null and expires_at > now() returning user_id`;
  if (!t) throw new ApiError(400, 'invalid_token', 'This reset link is invalid or has expired.');
  await sql`update auth.users set encrypted_password = crypt(${b.password}, gen_salt('bf', 10)), updated_at = now() where id = ${t.user_id}`;
  return c.json({ ok: true });
});

localAuthRoutes.all('*', () => {
  throw notFound();
});
