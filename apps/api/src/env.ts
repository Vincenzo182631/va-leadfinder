import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === 'true' || v === '1');

const schema = z
  .object({
    APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    APP_BASE_URL: z.string().default('http://localhost:5173'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DATABASE_PREPARE: bool.default(true),
    AUTH_MODE: z.enum(['supabase', 'local']).default('local'),
    SUPABASE_URL: z.string().optional().default(''),
    SUPABASE_JWT_SECRET: z.string().optional().default(''),
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(''),
    LOCAL_AUTH_JWT_SECRET: z.string().optional().default(''),
    ADMIN_USER_IDS: z.string().optional().default(''),
    INTERNAL_JOB_TOKEN: z.string().optional().default(''),
    PAYMONGO_MODE: z.enum(['disabled', 'mock', 'test', 'live']).default('disabled'),
    PAYMONGO_SECRET_KEY: z.string().optional().default(''),
    PAYMONGO_WEBHOOK_SECRET: z.string().optional().default(''),
    PAYMONGO_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
    TRANSACTIONAL_EMAIL_PROVIDER: z.enum(['console', 'resend', 'disabled']).default('console'),
    TRANSACTIONAL_EMAIL_API_KEY: z.string().optional().default(''),
    TRANSACTIONAL_EMAIL_FROM: z.string().optional().default(''),
    APPROVED_OPPORTUNITY_PROVIDER_ID: z.string().optional().default(''),
    APPROVED_OPPORTUNITY_PROVIDER_KEY: z.string().optional().default(''),
    APPROVED_OPPORTUNITY_PROVIDER_BASE_URL: z.string().optional().default(''),
    LICENSED_PROVIDER_ENABLED: bool.default(false),
    CORS_ORIGINS: z.string().optional().default('http://localhost:5173'),
  })
  .superRefine((e, ctx) => {
    const prodLike = e.APP_ENV === 'production' || e.APP_ENV === 'staging';
    if (e.AUTH_MODE === 'local' && prodLike)
      ctx.addIssue({ code: 'custom', message: 'AUTH_MODE=local is development-only and is refused in staging/production' });
    if (e.AUTH_MODE === 'local' && e.LOCAL_AUTH_JWT_SECRET.length < 32)
      ctx.addIssue({ code: 'custom', message: 'LOCAL_AUTH_JWT_SECRET must be at least 32 characters' });
    if (e.AUTH_MODE === 'supabase' && !e.SUPABASE_URL)
      ctx.addIssue({ code: 'custom', message: 'SUPABASE_URL is required when AUTH_MODE=supabase' });
    if (e.PAYMONGO_MODE === 'mock' && e.APP_ENV === 'production')
      ctx.addIssue({ code: 'custom', message: 'PAYMONGO_MODE=mock is refused in production' });
    if ((e.PAYMONGO_MODE === 'test' || e.PAYMONGO_MODE === 'live') && (!e.PAYMONGO_SECRET_KEY || !e.PAYMONGO_WEBHOOK_SECRET))
      ctx.addIssue({ code: 'custom', message: 'PAYMONGO_SECRET_KEY and PAYMONGO_WEBHOOK_SECRET are required for test/live billing' });
    if (e.PAYMONGO_MODE === 'test' && e.PAYMONGO_SECRET_KEY && !e.PAYMONGO_SECRET_KEY.startsWith('sk_test_'))
      ctx.addIssue({ code: 'custom', message: 'PAYMONGO_MODE=test requires an sk_test_ key' });
    if (e.PAYMONGO_MODE === 'live' && e.PAYMONGO_SECRET_KEY && !e.PAYMONGO_SECRET_KEY.startsWith('sk_live_'))
      ctx.addIssue({ code: 'custom', message: 'PAYMONGO_MODE=live requires an sk_live_ key' });
    if (e.PAYMONGO_MODE === 'mock' && e.PAYMONGO_WEBHOOK_SECRET.length < 16)
      ctx.addIssue({ code: 'custom', message: 'Mock billing needs PAYMONGO_WEBHOOK_SECRET (16+ chars) to sign simulated webhooks' });
  });

export type Config = z.infer<typeof schema> & { adminIds: Set<string>; corsOrigins: string[]; isProduction: boolean };

export function loadConfig(source: Record<string, unknown>): Config {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    // Only messages — never echo values (they may be secrets).
    const msg = parsed.error.issues.map((i) => `${i.path.join('.') || 'config'}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${msg}`);
  }
  const e = parsed.data;
  return {
    ...e,
    adminIds: new Set(e.ADMIN_USER_IDS.split(',').map((s) => s.trim()).filter(Boolean)),
    corsOrigins: e.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    isProduction: e.APP_ENV === 'production',
  };
}
