import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });

/**
 * Bundle workspace + lightweight libs. Leave Express-stack CJS packages
 * external (dynamic require). Side-effect imports in vercel-api.mjs ensure NFT.
 */
await build({
  entryPoints: ["src/index.mts"],
  outfile: "dist/vercel-api.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  external: [
    "@prisma/client",
    "@vercel/blob",
    "bullmq",
    "cors",
    "express",
    "ioredis",
    "multer",
  ],
  logLevel: "info",
});

console.log("Wrote dist/vercel-api.mjs");
