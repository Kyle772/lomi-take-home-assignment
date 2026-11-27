#!/usr/bin/env node
/**
 * Run `prisma migrate deploy` using Neon-prefixed or standard DATABASE_URL.
 * Usage (after `vercel env pull .env.vercel --environment production`):
 *   node packages/db/scripts/migrate-with-env.mjs
 * Or with an explicit URL already in the shell.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env) && val && val !== "[SENSITIVE]") {
      process.env[key] = val;
    }
  }
}

loadEnvFile(resolve(root, ".env.vercel"));
loadEnvFile(resolve(root, ".env.local"));
loadEnvFile(resolve(root, ".env"));

const url =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.NEON_DATABASE_DATABASE_URL_UNPOOLED ||
  process.env.NEON_DATABASE_POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL ||
  process.env.NEON_DATABASE_DATABASE_URL ||
  process.env.NEON_DATABASE_POSTGRES_PRISMA_URL ||
  process.env.NEON_DATABASE_POSTGRES_URL ||
  "";

if (!url || url === "[SENSITIVE]") {
  console.error(
    "No usable DATABASE_URL found. Paste the Neon unpooled URL:\n" +
      "  DATABASE_URL='postgresql://…' pnpm --filter @lomi/db exec prisma migrate deploy\n" +
      "Or pull secrets into .env.vercel (dashboard copy) and re-run this script.",
  );
  process.exit(1);
}

process.env.DATABASE_URL = url;

const result = spawnSync(
  "pnpm",
  ["--filter", "@lomi/db", "exec", "prisma", "migrate", "deploy"],
  { cwd: root, stdio: "inherit", env: process.env },
);
process.exit(result.status ?? 1);
