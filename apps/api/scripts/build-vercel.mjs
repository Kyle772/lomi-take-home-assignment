import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });

/**
 * Fully bundle the API (including Express) into one ESM file.
 * createRequire banner lets bundled CJS packages call require("path") etc.
 * Prisma stays external — engines must be file-traced by Vercel NFT.
 */
await build({
  entryPoints: ["src/index.mts"],
  outfile: "dist/vercel-api.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  external: ["@prisma/client", ".prisma/*"],
  banner: {
    js: `import { createRequire as __lomiCreateRequire } from "node:module";
import { fileURLToPath as __lomiFileURLToPath } from "node:url";
import { dirname as __lomiDirname } from "node:path";
const require = __lomiCreateRequire(import.meta.url);
const __filename = __lomiFileURLToPath(import.meta.url);
const __dirname = __lomiDirname(__filename);
`,
  },
  logLevel: "info",
});

console.log("Wrote dist/vercel-api.mjs");
