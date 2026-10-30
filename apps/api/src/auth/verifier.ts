import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload } from 'jose';
import type { Config } from '../env';
import type { UserClaims } from '../db';

export interface AuthVerifier {
  verify(token: string): Promise<UserClaims | null>;
}

const enc = new TextEncoder();
export const LOCAL_ISSUER = 'vlf-local-dev';

function toClaims(p: JWTPayload): UserClaims | null {
  if (typeof p.sub !== 'string' || !/^[0-9a-f-]{36}$/i.test(p.sub)) return null;
  if (p.role !== undefined && p.role !== 'authenticated') return null;
  return { sub: p.sub, email: typeof p.email === 'string' ? p.email : null, role: 'authenticated' };
}

/** Verifies Supabase Auth access tokens (asymmetric JWKS, or legacy HS256 secret). */
export function supabaseVerifier(cfg: Config): AuthVerifier {
  const issuer = `${cfg.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), { cacheMaxAge: 10 * 60_000 });
  const secret = cfg.SUPABASE_JWT_SECRET ? enc.encode(cfg.SUPABASE_JWT_SECRET) : null;
  return {
    async verify(token) {
      try {
        const header = JSON.parse(atob(token.split('.')[0]!.replace(/-/g, '+').replace(/_/g, '/')));
        const opts = { issuer, audience: 'authenticated' };
        const { payload } =
          header.alg === 'HS256'
            ? secret
              ? await jwtVerify(token, secret, { ...opts, algorithms: ['HS256'] })
              : (() => {
                  throw new Error('HS256 token but SUPABASE_JWT_SECRET is not configured');
                })()
            : await jwtVerify(token, jwks, { ...opts, algorithms: ['RS256', 'ES256'] });
        return toClaims(payload);
      } catch {
        return null;
      }
    },
  };
}

/** DEVELOPMENT ONLY: tokens issued by the local auth adapter (config refuses this in staging/production). */
export function localVerifier(cfg: Config): AuthVerifier & { issue(sub: string, email: string): Promise<string> } {
  const key = enc.encode(cfg.LOCAL_AUTH_JWT_SECRET);
  return {
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, key, { issuer: LOCAL_ISSUER, audience: 'authenticated', algorithms: ['HS256'] });
        return toClaims(payload);
      } catch {
        return null;
      }
    },
    issue(sub, email) {
      return new SignJWT({ email, role: 'authenticated' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(sub)
        .setIssuer(LOCAL_ISSUER)
        .setAudience('authenticated')
        .setIssuedAt()
        .setExpirationTime('8h')
        .sign(key);
    },
  };
}
