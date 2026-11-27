import { resolve } from "node:path";
import { resolveDatabaseUrl } from "@lomi/db";

const defaultUploadDir = process.env.VERCEL
  ? "/tmp/lomi-uploads"
  : resolve(process.cwd(), "../../storage/uploads");

function resolveRedisUrl(): string {
  return (
    process.env.REDIS_URL ||
    process.env.REDIS_KV_URL ||
    process.env.UPSTASH_REDIS_URL ||
    "redis://localhost:6379"
  );
}

function resolvePublicApiUrl(): string {
  if (process.env.PUBLIC_API_URL) {
    return process.env.PUBLIC_API_URL.replace(/\/$/, "");
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/\/$/, "")}/api`;
  }
  return "http://localhost:3001/api";
}

export const config = {
  port: Number(process.env.API_PORT || 3001),
  databaseUrl: resolveDatabaseUrl(),
  redisUrl: resolveRedisUrl(),
  // Serverless only has a writable /tmp; ignore Docker-style UPLOAD_DIR on Vercel.
  uploadDir: process.env.VERCEL
    ? "/tmp/lomi-uploads"
    : process.env.UPLOAD_DIR || defaultUploadDir,
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  queueName: "document-extraction",
  /** Public base URL used in CSV pdf_url links (browser-reachable, include `/api` when applicable). */
  publicApiUrl: resolvePublicApiUrl(),
};
