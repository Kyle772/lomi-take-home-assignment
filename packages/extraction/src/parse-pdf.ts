import { readFileSync } from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";

export async function parsePdfFile(filePath: string): Promise<string> {
  const buffer = readFileSync(filePath);
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  const joined = Array.isArray(text) ? text.join("\n") : String(text || "");
  return joined.replace(/\u0000/g, "").trim();
}
