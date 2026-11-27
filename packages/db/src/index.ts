import { PrismaClient } from "@prisma/client";
import { applyDatabaseUrlEnv } from "./resolve-database-url.js";

export * from "@prisma/client";
export {
  applyDatabaseUrlEnv,
  resolveDatabaseUrl,
  resolveDatabaseUrlUnpooled,
} from "./resolve-database-url.js";

applyDatabaseUrlEnv();

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
