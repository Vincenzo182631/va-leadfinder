import type { Config } from './env';
import type { Sql, UserClaims } from './db';
import type { AuthVerifier } from './auth/verifier';
import type { BillingProvider } from './services/billing/types';
import type { EmailProvider } from './services/email';

export interface Deps {
  config: Config;
  sql: Sql;
  verifier: AuthVerifier;
  localAuth?: AuthVerifier & { issue(sub: string, email: string): Promise<string> };
  billing: BillingProvider;
  email: EmailProvider;
  now: () => Date;
  /** In-process request dispatch (used by the dev billing simulator). */
  selfFetch?: (req: Request) => Promise<Response>;
}

export type AppEnv = {
  Variables: {
    deps: Deps;
    requestId: string;
    claims: UserClaims | undefined;
  };
};
