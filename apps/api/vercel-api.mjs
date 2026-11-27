/**
 * Vercel Express entry (`.mjs` = always ESM).
 * Prisma is external to the esbuild bundle — import it so NFT packs the client.
 */
import "@prisma/client";

export { default } from "./dist/vercel-api.mjs";
