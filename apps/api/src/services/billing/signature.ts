import { hmacSha256Hex, timingSafeEqual } from '../../lib/crypto';

/**
 * PayMongo webhook signature (docs.paymongo.com → Securing a webhook):
 *   Paymongo-Signature: t=<unix>,te=<test sig>,li=<live sig>
 *   sig = HMAC-SHA256(webhookSecret, `${t}.${rawBody}`) — compare `te` in test mode, `li` in live mode.
 */
export function parseSignatureHeader(header: string | undefined): { t: string; te: string; li: string } | null {
  if (!header) return null;
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  if (!parts.t || !/^\d+$/.test(parts.t)) return null;
  return { t: parts.t, te: parts.te ?? '', li: parts.li ?? '' };
}

export async function verifyPaymongoSignature(opts: {
  rawBody: string;
  header: string | undefined;
  secret: string;
  livemode: boolean;
  now: Date;
  toleranceSeconds: number;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!opts.secret) return { ok: false, reason: 'webhook_secret_not_configured' };
  const parsed = parseSignatureHeader(opts.header);
  if (!parsed) return { ok: false, reason: 'missing_or_malformed_signature' };
  const age = Math.abs(opts.now.getTime() / 1000 - Number(parsed.t));
  if (age > opts.toleranceSeconds) return { ok: false, reason: 'timestamp_outside_tolerance' };
  const provided = opts.livemode ? parsed.li : parsed.te;
  if (!provided) return { ok: false, reason: 'signature_for_mode_missing' };
  const expected = await hmacSha256Hex(opts.secret, `${parsed.t}.${opts.rawBody}`);
  return timingSafeEqual(expected, provided) ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
}

export async function signPaymongoPayload(secret: string, rawBody: string, now: Date, livemode = false): Promise<string> {
  const t = Math.floor(now.getTime() / 1000).toString();
  const sig = await hmacSha256Hex(secret, `${t}.${rawBody}`);
  return livemode ? `t=${t},te=,li=${sig}` : `t=${t},te=${sig},li=`;
}
