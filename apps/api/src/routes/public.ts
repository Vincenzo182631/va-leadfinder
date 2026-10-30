import { Hono } from 'hono';
import { sha256Hex } from '../lib/crypto';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv } from '../types';

export const publicRoutes = new Hono<AppEnv>();

publicRoutes.get('/health', async (c) => {
  const { sql, billing, config } = c.get('deps');
  let db = 'ok';
  try {
    await sql`select 1`;
  } catch {
    db = 'unavailable';
  }
  return c.json({ status: db === 'ok' ? 'ok' : 'degraded', db, environment: config.APP_ENV, billingMode: billing.mode, authMode: config.AUTH_MODE }, db === 'ok' ? 200 : 503);
});

publicRoutes.get('/public/config', async (c) => {
  const { sql, billing, config } = c.get('deps');
  const [s] = await sql`select demo_mode_enabled from app_settings where id = 1`;
  const [live] = await sql`select count(*)::int as n from source_providers where enabled and provider_kind <> 'synthetic_demo'`;
  return c.json({ demoMode: Boolean(s?.demo_mode_enabled), liveSourcesActive: live?.n ?? 0, billingMode: billing.mode, authMode: config.AUTH_MODE, environment: config.APP_ENV });
});

// One-click digest unsubscribe (token is single-purpose; only its hash is stored).
publicRoutes.get('/email/unsubscribe', rateLimit('unsub', 20, 60_000), async (c) => {
  const token = c.req.query('token') ?? '';
  const { sql, config } = c.get('deps');
  let ok = false;
  if (/^[0-9a-f]{48}$/.test(token)) {
    const r = await sql`update email_preferences set digest_frequency = 'off', unsubscribe_token_hash = null
      where unsubscribe_token_hash = ${await sha256Hex(token)} returning user_id`;
    if (r.length) {
      await sql`update user_preferences set alert_frequency = 'off' where user_id = ${r[0]!.user_id}`;
      ok = true;
    }
  }
  const msg = ok ? 'You have been unsubscribed from opportunity digests.' : 'This unsubscribe link is invalid or was already used.';
  return c.html(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>VA LeadFinder</title>
<body style="font-family:system-ui;padding:2rem;color:#24384E;background:#F5F7FA"><h1 style="font-size:1.25rem">${msg}</h1>
<p><a href="${config.APP_BASE_URL}/app/account">Manage email preferences</a></p></body>`);
});
