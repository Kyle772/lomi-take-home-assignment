/**
 * Vercel Express entry (`.mjs` = always ESM).
 * Prisma is external to the esbuild bundle — import it so NFT packs the client.
 * Neon-prefixed DATABASE_URL aliases are applied inside `@lomi/db` (bundled).
 */
import "@prisma/client";

export { default } from "./dist/vercel-api.mjs";
