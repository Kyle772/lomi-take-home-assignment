import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DOCUMENT_TYPES, defaultFormatRulesForFieldType } from "@lomi/shared";
import { prisma } from "./index.js";

async function hashPdfFile(filePath: string): Promise<string | null> {
  if (!filePath || !existsSync(filePath)) return null;
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const fixturesPath = join(repoRoot, "fixtures", "documents.json");
const uploadDir = process.env.UPLOAD_DIR || join(repoRoot, "storage", "uploads");

const STABLE_TYPE_IDS: Record<string, string> = {
  invoice: "dtype-invoice",
  lease: "dtype-lease",
  market_report: "dtype-market_report",
};

const DEFAULT_BATCH_ID = "batch-default";

type ManifestDoc = {
  id: string;
  type: string;
  title: string;
  versions: Array<{ version: number; file: string; note?: string }>;
};

async function seedDocumentTypes() {
  for (const def of DEFAULT_DOCUMENT_TYPES) {
    const id = STABLE_TYPE_IDS[def.key] || undefined;
    const existing = await prisma.documentType.findUnique({ where: { key: def.key } });
    const type =
      existing ||
      (await prisma.documentType.create({
        data: {
          ...(id ? { id } : {}),
          key: def.key,
          label: def.label,
        },
      }));

    if (existing && existing.label !== def.label) {
      await prisma.documentType.update({
        where: { id: type.id },
        data: { label: def.label },
      });
    }

    for (let i = 0; i < def.fields.length; i += 1) {
      const field = def.fields[i]!;
      const formatRules = defaultFormatRulesForFieldType(field.type);
      const existingField = await prisma.documentTypeField.findUnique({
        where: {
          documentTypeId_fieldKey: {
            documentTypeId: type.id,
            fieldKey: field.field,
          },
        },
      });
      const existingRules = existingField?.formatRules;
      const hasRules =
        Array.isArray(existingRules) && (existingRules as unknown[]).length > 0;

      await prisma.documentTypeField.upsert({
        where: {
          documentTypeId_fieldKey: {
            documentTypeId: type.id,
            fieldKey: field.field,
          },
        },
        create: {
          documentTypeId: type.id,
          fieldKey: field.field,
          fieldType: field.type,
          formatRules,
          sortOrder: i,
        },
        update: {
          fieldType: field.type,
          sortOrder: i,
          // Only seed format rules if the field has none yet (don't overwrite custom rules).
          ...(hasRules ? {} : { formatRules }),
        },
      });
    }
  }
}

async function ensureActiveBatch() {
  const existing = await prisma.batch.findUnique({ where: { id: DEFAULT_BATCH_ID } });
  if (existing) {
    const active = await prisma.batch.findFirst({ where: { active: true } });
    if (!active) {
      await prisma.batch.update({ where: { id: existing.id }, data: { active: true } });
    }
    return existing.id;
  }

  const active = await prisma.batch.findFirst({ where: { active: true } });
  if (active) return active.id;

  const created = await prisma.batch.create({
    data: { id: DEFAULT_BATCH_ID, name: "Batch 1", active: true },
  });
  return created.id;
}

async function main() {
  await seedDocumentTypes();
  const batchId = await ensureActiveBatch();

  const { readFileSync } = await import("node:fs");
  const manifest = JSON.parse(readFileSync(fixturesPath, "utf8")) as ManifestDoc[];
  mkdirSync(uploadDir, { recursive: true });

  for (const doc of manifest) {
    const v1 = doc.versions.find((v) => v.version === 1);
    if (!v1) continue;

    const source = join(repoRoot, "fixtures", v1.file);
    if (!existsSync(source)) {
      console.warn(`Missing fixture file: ${source}`);
      continue;
    }

    const destName = `${doc.id}-v1.pdf`;
    const dest = join(uploadDir, destName);
    copyFileSync(source, dest);
    const contentHash = await hashPdfFile(dest);

    const documentType = await prisma.documentType.findUnique({ where: { key: doc.type } });
    if (!documentType) {
      console.warn(`Unknown document type key: ${doc.type}`);
      continue;
    }

    await prisma.document.upsert({
      where: { id: doc.id },
      create: {
        id: doc.id,
        batchId,
        documentTypeId: documentType.id,
        title: doc.title,
        versions: {
          create: {
            versionNumber: 1,
            status: "queued",
            storagePath: dest,
            contentHash,
          },
        },
      },
      update: {
        batchId,
        documentTypeId: documentType.id,
        title: doc.title,
      },
    });

    const existing = await prisma.documentVersion.findUnique({
      where: {
        documentId_versionNumber: {
          documentId: doc.id,
          versionNumber: 1,
        },
      },
    });

    if (!existing) {
      await prisma.documentVersion.create({
        data: {
          documentId: doc.id,
          versionNumber: 1,
          status: "queued",
          storagePath: dest,
          contentHash,
        },
      });
    } else {
      await prisma.documentVersion.update({
        where: { id: existing.id },
        data: { storagePath: dest, contentHash },
      });
    }
  }

  console.log(`Seeded types + batch + ${manifest.length} documents (version 1 only).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
