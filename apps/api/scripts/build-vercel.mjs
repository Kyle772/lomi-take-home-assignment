import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });

/**
 * Vercel packages the Express entry as /var/task/index.js without our
 * package.json `"type":"module"`, so a plain ESM .js graph crashes.
 * Bundle a single .mjs entry (always treated as ESM) instead.
 */
await build({
  entryPoints: ["src/index.mts"],
  outfile: "dist/vercel-api.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  // Keep heavy/native deps external; workspace packages are inlined.
  external: [
    "@prisma/client",
    "@vercel/blob",
    "bullmq",
    "cors",
    "express",
    "ioredis",
    "multer",
    "openai",
    "unpdf",
  ],
  logLevel: "info",
});

console.log("Wrote dist/vercel-api.mjs");
