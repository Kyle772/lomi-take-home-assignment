import { createHash } from "node:crypto";
import { readPdfBytes } from "./storage.js";

/** SHA-256 hex digest of a PDF (local path or remote Blob URL). Returns null if missing. */
export async function hashPdfFile(filePath: string): Promise<string | null> {
  const bytes = await readPdfBytes(filePath);
  if (!bytes) return null;
  return createHash("sha256").update(bytes).digest("hex");
}
