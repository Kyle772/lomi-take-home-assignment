import { createReadStream, existsSync, readFileSync, unlinkSync } from "node:fs";
import { put } from "@vercel/blob";

export function isRemoteStoragePath(path: string): boolean {
  return /^https?:\/\//i.test(path);
}

/** Persist a multer disk upload. On Vercel (BLOB_READ_WRITE_TOKEN), push to Blob and return the URL. */
export async function persistUploadedFile(file: Express.Multer.File): Promise<string> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return file.path;
  }

  const blob = await put(`uploads/${file.filename}`, createReadStream(file.path), {
    access: "public",
    contentType: "application/pdf",
    multipart: true,
  });

  try {
    unlinkSync(file.path);
  } catch {
    // temp file cleanup is best-effort on serverless
  }

  return blob.url;
}

export async function readPdfBytes(storagePath: string): Promise<Buffer | null> {
  if (!storagePath) return null;
  if (isRemoteStoragePath(storagePath)) {
    const res = await fetch(storagePath);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }
  if (!existsSync(storagePath)) return null;
  return readFileSync(storagePath);
}
