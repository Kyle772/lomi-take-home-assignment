import { resolve } from "node:path";

const defaultUploadDir = process.env.VERCEL
  ? "/tmp/lomi-uploads"
  : resolve(process.cwd(), "../../storage/uploads");

export const config = {
  port: Number(process.env.API_PORT || 3001),
  databaseUrl: process.env.DATABASE_URL || "",
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  // Serverless only has a writable /tmp; ignore Docker-style UPLOAD_DIR on Vercel.
  uploadDir: process.env.VERCEL
    ? "/tmp/lomi-uploads"
    : process.env.UPLOAD_DIR || defaultUploadDir,
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  queueName: "document-extraction",
  /** Public base URL used in CSV pdf_url links (browser-reachable, include `/api` when applicable). */
  publicApiUrl: (process.env.PUBLIC_API_URL || "http://localhost:3001/api").replace(/\/$/, ""),
};
