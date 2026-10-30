import postgres from 'postgres';

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;

export function createSql(url: string, opts: { max?: number; prepare?: boolean } = {}): Sql {
  return postgres(url, {
    max: opts.max ?? 10,
    prepare: opts.prepare ?? true,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
    // Return timestamps as ISO strings consistently.
    types: { date: { to: 1184, from: [1082, 1083, 1114, 1184], serialize: (x: unknown) => x as string, parse: (x: string) => new Date(x).toISOString() } },
  });
}

export interface UserClaims {
  sub: string;
  email?: string | null;
  role: 'authenticated';
}

/**
 * Run queries AS the signed-in user: role `authenticated` + JWT claims, so
 * Postgres Row Level Security applies even to API-issued queries.
 */
export async function withUser<T>(sql: Sql, claims: UserClaims, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
    await tx.unsafe('set local role authenticated');
    return fn(tx);
  }) as Promise<T>;
}

/** Trusted server context (admin, webhooks, jobs). Callers must authorise first. */
export async function asService<T>(sql: Sql, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(fn) as Promise<T>;
}
