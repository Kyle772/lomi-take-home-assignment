import { readFileSync } from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";

async function loadPdfBytes(filePath: string): Promise<Uint8Array> {
  if (/^https?:\/\//i.test(filePath)) {
    const res = await fetch(filePath);
    if (!res.ok) {
      throw new Error(`Failed to fetch PDF (${res.status}): ${filePath}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }
  return new Uint8Array(readFileSync(filePath));
}

export async function parsePdfFile(filePath: string): Promise<string> {
  const buffer = await loadPdfBytes(filePath);
  const pdf = await getDocumentProxy(buffer);
  const { text } = await extractText(pdf, { mergePages: true });
  const joined = Array.isArray(text) ? text.join("\n") : String(text || "");
  return joined.replace(/\u0000/g, "").trim();
}
