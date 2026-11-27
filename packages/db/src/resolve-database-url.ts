/**
 * Neon’s Vercel integration often prefixes vars (e.g. `NEON_DATABASE_DATABASE_URL`)
 * instead of plain `DATABASE_URL`. Prisma always reads `DATABASE_URL`, so normalize
 * before constructing a client.
 */
export function resolveDatabaseUrl(): string {
  return (
    process.env.DATABASE_URL ||
    process.env.NEON_DATABASE_DATABASE_URL ||
    process.env.NEON_DATABASE_POSTGRES_PRISMA_URL ||
    process.env.NEON_DATABASE_POSTGRES_URL ||
    ""
  );
}

/** Prefer unpooled for migrate/deploy against Neon. */
export function resolveDatabaseUrlUnpooled(): string {
  return (
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.NEON_DATABASE_DATABASE_URL_UNPOOLED ||
    process.env.NEON_DATABASE_POSTGRES_URL_NON_POOLING ||
    resolveDatabaseUrl()
  );
}

export function applyDatabaseUrlEnv(): string {
  const url = resolveDatabaseUrl();
  if (url && !process.env.DATABASE_URL) {
    process.env.DATABASE_URL = url;
  }
  return process.env.DATABASE_URL || "";
}
