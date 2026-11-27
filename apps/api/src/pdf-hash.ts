import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";

/** SHA-256 hex digest of a PDF on disk. Returns null if the file is missing. */
export async function hashPdfFile(filePath: string): Promise<string | null> {
  if (!filePath || !existsSync(filePath)) return null;
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}
