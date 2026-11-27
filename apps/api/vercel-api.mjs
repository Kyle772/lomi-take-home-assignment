/**
 * Vercel Express entry.
 * - `.mjs` forces ESM when /var/task lacks `"type":"module"`.
 * - Side-effect imports make NFT pack runtime dependencies into the function.
 */
import "cors";
import "express";
import "multer";
import "bullmq";
import "ioredis";
import "@vercel/blob";
import "@prisma/client";

export { default } from "./dist/vercel-api.mjs";
