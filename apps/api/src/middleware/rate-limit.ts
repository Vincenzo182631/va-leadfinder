import type { MiddlewareHandler } from 'hono';
import { ApiError } from '../lib/errors';
import type { AppEnv } from '../types';

/**
 * Fixed-window in-memory limiter. Per isolate/process only — in production add
 * Cloudflare Rate Limiting rules (see docs/OPERATIONS.md) for global limits.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(name: string, limit: number, windowMs: number): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const who = c.get('claims')?.sub ?? c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'anon';
    const key = `${name}:${who}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count++;
    if (buckets.size > 50_000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    if (b.count > limit) {
      c.header('Retry-After', String(Math.ceil((b.resetAt - now) / 1000)));
      throw new ApiError(429, 'rate_limited', 'Too many requests. Please wait a moment and try again.');
    }
    await next();
  };
}

export const resetRateLimits = () => buckets.clear();
