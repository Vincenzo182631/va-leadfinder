import type { Context, MiddlewareHandler } from 'hono';
import { ZodError } from 'zod';
import { ApiError, forbidden, unauthorized } from '../lib/errors';
import { log } from '../lib/log';
import { withUser, type Tx } from '../db';
import type { AppEnv } from '../types';

export const requestContext: MiddlewareHandler<AppEnv> = async (c, next) => {
  const incoming = c.req.header('x-request-id');
  const id = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  c.set('requestId', id);
  c.header('X-Request-Id', id);
  const start = Date.now();
  await next();
  log('info', 'http', { requestId: id, method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - start, user: c.get('claims')?.sub });
};

/** Parses a bearer token if present. Never trusts client-supplied identity/role fields. */
export const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const h = c.req.header('authorization');
  if (h?.startsWith('Bearer ')) {
    const claims = await c.get('deps').verifier.verify(h.slice(7).trim());
    c.set('claims', claims ?? undefined);
  }
  await next();
};

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('claims')) throw unauthorized();
  await next();
};

/** Admin = user id listed in server-side ADMIN_USER_IDS. No client flag is ever consulted. */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const claims = c.get('claims');
  if (!claims) throw unauthorized();
  if (!c.get('deps').config.adminIds.has(claims.sub)) throw forbidden('Administrator access required');
  await next();
};

export const isAdmin = (c: Context<AppEnv>) => {
  const s = c.get('claims')?.sub;
  return Boolean(s && c.get('deps').config.adminIds.has(s));
};

export function userTx<T>(c: Context<AppEnv>, fn: (tx: Tx, userId: string) => Promise<T>): Promise<T> {
  const claims = c.get('claims');
  if (!claims) throw unauthorized();
  return withUser(c.get('deps').sql, claims, (tx) => fn(tx, claims.sub));
}

export function errorHandler(err: Error, c: Context<AppEnv>) {
  const requestId = c.get('requestId');
  if (err instanceof ApiError) {
    return c.json({ error: { code: err.code, message: err.message, requestId, details: err.status < 500 ? err.details : undefined } }, err.status);
  }
  if (err instanceof ZodError) {
    const details = err.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message }));
    return c.json({ error: { code: 'validation_error', message: details[0]?.message ?? 'Invalid input', requestId, details } }, 400);
  }
  if (err instanceof SyntaxError) return c.json({ error: { code: 'invalid_json', message: 'Request body must be valid JSON', requestId } }, 400);
  const pgCode = (err as { code?: string }).code;
  if (pgCode === '42501') return c.json({ error: { code: 'forbidden', message: 'You do not have access to this resource', requestId } }, 403);
  if (pgCode === '22P02') return c.json({ error: { code: 'validation_error', message: 'Invalid identifier', requestId } }, 400);
  log('error', 'unhandled', { requestId, err: String(err), stack: err.stack?.split('\n').slice(0, 5) });
  return c.json({ error: { code: 'internal_error', message: 'Something went wrong. Please try again.', requestId } }, 500);
}

export async function jsonBody<T>(c: Context<AppEnv>, schema: { parse(v: unknown): T }): Promise<T> {
  const ct = c.req.header('content-type') ?? '';
  if (!ct.includes('application/json')) throw new ApiError(415, 'unsupported_media_type', 'Use application/json');
  const len = Number(c.req.header('content-length') ?? 0);
  if (len > 2_500_000) throw new ApiError(413, 'payload_too_large', 'Request body too large');
  return schema.parse(await c.req.json());
}

export const uuidParam = (c: Context<AppEnv>, name = 'id') => {
  const v = c.req.param(name) ?? '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) throw new ApiError(400, 'validation_error', 'Invalid id');
  return v;
};
