import { resolve } from "node:path";

export const config = {
  port: Number(process.env.API_PORT || 3001),
  databaseUrl: process.env.DATABASE_URL || "",
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  uploadDir: process.env.UPLOAD_DIR || resolve(process.cwd(), "../../storage/uploads"),
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  queueName: "document-extraction",
  /** Public base URL used in CSV pdf_url links (browser-reachable). */
  publicApiUrl: (process.env.PUBLIC_API_URL || "http://localhost:3001").replace(/\/$/, ""),
};
