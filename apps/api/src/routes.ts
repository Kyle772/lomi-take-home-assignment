import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync } from "node:fs";
import { Router } from "express";
import multer from "multer";
import { prisma } from "@lomi/db";
import {
  applyFormatRules,
  CERTAINTY_THRESHOLD,
  defaultFormatRulesForFieldType,
  isFieldType,
  normalizeFieldKey,
  slugifyTypeKey,
  testFormatRule,
  type FormatRule,
} from "@lomi/shared";
import { config } from "./config.js";
import { buildCsv } from "./csv.js";
import { computeProgress } from "./progress.js";
import { hashPdfFile } from "./pdf-hash.js";
import { enqueueExtraction } from "./queue.js";
import {
  attachDuplicateBatches,
  serializeDocument,
  serializeDocumentType,
  type SerializedDocument,
} from "./serialize.js";
import { isRemoteStoragePath, persistUploadedFile, readPdfBytes } from "./storage.js";

function ensureUploadDir(): void {
  mkdirSync(config.uploadDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        ensureUploadDir();
        cb(null, config.uploadDir);
      } catch (err) {
        cb(err as Error, config.uploadDir);
      }
    },
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      cb(null, `${Date.now()}-${randomUUID()}-${safe}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf")) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"));
    }
  },
  limits: { fileSize: 20 * 1024 * 1024 },
});

const valueInclude = {
  review: true,
  previousValue: { include: { review: true } },
} as const;

const documentInclude = {
  documentType: { include: { fields: { orderBy: { sortOrder: "asc" as const } } } },
  versions: {
    orderBy: { versionNumber: "desc" as const },
    include: {
      values: { include: valueInclude, orderBy: { fieldKey: "asc" as const } },
    },
  },
};

async function loadDocument(id: string) {
  return prisma.document.findUnique({
    where: { id },
    include: documentInclude,
  });
}

type FieldInput = {
  fieldKey?: string;
  field?: string;
  fieldType?: string;
  type?: string;
  formatRules?: unknown;
};

function parseFormatRules(raw: unknown, fieldType: string): FormatRule[] {
  if (!Array.isArray(raw)) {
    return defaultFormatRulesForFieldType(fieldType);
  }
  const rules: FormatRule[] = [];
  for (const item of raw as FormatRule[]) {
    if (!item || typeof item !== "object") continue;
    const kind = String(item.kind || "");
    if (
      kind !== "ensure_prefix" &&
      kind !== "ensure_suffix" &&
      kind !== "ensure_decimals" &&
      kind !== "regex_replace" &&
      kind !== "date_format"
    ) {
      continue;
    }
    rules.push({
      id: String(item.id || `rule-${rules.length}`),
      name: String(item.name || kind),
      kind,
      skipIfMatch: item.skipIfMatch != null ? String(item.skipIfMatch) : undefined,
      onlyIfMatch: item.onlyIfMatch != null ? String(item.onlyIfMatch) : undefined,
      value: item.value != null ? String(item.value) : undefined,
      pattern: item.pattern != null ? String(item.pattern) : undefined,
      decimals: typeof item.decimals === "number" ? item.decimals : undefined,
      dateOutput:
        item.dateOutput === "ISO" ||
        item.dateOutput === "MM-DD-YYYY" ||
        item.dateOutput === "DD-MM-YYYY" ||
        item.dateOutput === "YYYY-MM-DD"
          ? item.dateOutput
          : undefined,
    });
  }
  return rules;
}

function parseFieldsInput(
  raw: unknown,
): Array<{ fieldKey: string; fieldType: string; formatRules: FormatRule[] }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ fieldKey: string; fieldType: string; formatRules: FormatRule[] }> = [];
  for (const item of raw as FieldInput[]) {
    const key = normalizeFieldKey(String(item.fieldKey || item.field || ""));
    if (!key) continue;
    const typeRaw = String(item.fieldType || item.type || "string");
    const fieldType = isFieldType(typeRaw) ? typeRaw : "string";
    if (out.some((f) => f.fieldKey === key)) continue;
    const formatRules =
      item.formatRules !== undefined
        ? parseFormatRules(item.formatRules, fieldType)
        : defaultFormatRulesForFieldType(fieldType);
    out.push({ fieldKey: key, fieldType, formatRules });
  }
  return out;
}

function fieldCatalogChanged(
  before: Array<{ fieldKey: string; fieldType: string }>,
  after: Array<{ fieldKey: string; fieldType: string }>,
): boolean {
  if (before.length !== after.length) return true;
  const a = before
    .map((f) => `${f.fieldKey}:${f.fieldType}`)
    .sort()
    .join("|");
  const b = after
    .map((f) => `${f.fieldKey}:${f.fieldType}`)
    .sort()
    .join("|");
  return a !== b;
}

async function createVersionAndEnqueue(
  documentId: string,
  storagePath: string,
  nextNumber: number,
  options?: { resetReviews?: boolean; contentHash?: string | null },
) {
  const contentHash =
    options?.contentHash !== undefined
      ? options.contentHash
      : await hashPdfFile(storagePath);
  const version = await prisma.documentVersion.create({
    data: {
      documentId,
      versionNumber: nextNumber,
      status: "queued",
      storagePath,
      contentHash,
      resetReviews: options?.resetReviews === true,
    },
  });
  await enqueueExtraction(version.id);
  return version;
}

async function findDuplicateMatches(hashes: string[]) {
  if (hashes.length === 0) return [];
  const versions = await prisma.documentVersion.findMany({
    where: { contentHash: { in: hashes } },
    select: {
      contentHash: true,
      document: {
        select: {
          id: true,
          title: true,
          batchId: true,
          batch: { select: { id: true, name: true } },
        },
      },
    },
  });
  return versions.map((v) => ({
    contentHash: v.contentHash,
    documentId: v.document.id,
    documentTitle: v.document.title,
    batchId: v.document.batchId,
    batchName: v.document.batch.name,
  }));
}

async function ensureContentHashes(
  docs: Array<{
    versions: Array<{ id: string; storagePath: string; contentHash: string | null }>;
  }>,
) {
  for (const doc of docs) {
    const current = doc.versions[0];
    if (!current || current.contentHash) continue;
    const hash = await hashPdfFile(current.storagePath);
    if (!hash) continue;
    await prisma.documentVersion.update({
      where: { id: current.id },
      data: { contentHash: hash },
    });
    current.contentHash = hash;
  }
}

async function serializeDocumentsWithDuplicates(
  docs: Parameters<typeof serializeDocument>[0][],
): Promise<SerializedDocument[]> {
  await ensureContentHashes(docs);
  return attachDuplicateBatches(docs.map(serializeDocument), findDuplicateMatches);
}

async function serializeOneWithDuplicates(
  doc: Parameters<typeof serializeDocument>[0],
): Promise<SerializedDocument> {
  const [out] = await serializeDocumentsWithDuplicates([doc]);
  return out!;
}

async function getActiveBatch() {
  let batch = await prisma.batch.findFirst({ where: { active: true }, orderBy: { createdAt: "desc" } });
  if (!batch) {
    batch = await prisma.batch.create({
      data: { name: "Batch 1", active: true },
    });
  }
  return batch;
}

async function resolveBatchId(raw: unknown): Promise<string> {
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  const active = await getActiveBatch();
  return active.id;
}

function batchCountsFromDocs(
  docs: Array<ReturnType<typeof serializeDocument>>,
) {
  let pending = 0;
  let completed = 0;
  for (const d of docs) {
    if (d.reviewComplete) completed += 1;
    else pending += 1;
  }
  return { pending, completed, total: docs.length };
}

export function createRouter(): Router {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // --- Batches ---

  router.get("/batches", async (_req, res, next) => {
    try {
      const batches = await prisma.batch.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          documents: {
            include: documentInclude,
          },
        },
      });
      res.json({
        batches: batches.map((b) => {
          const serialized = b.documents.map(serializeDocument);
          const counts = batchCountsFromDocs(serialized);
          return {
            id: b.id,
            name: b.name,
            active: b.active,
            createdAt: b.createdAt,
            ...counts,
          };
        }),
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/batches", async (req, res, next) => {
    try {
      const nameHint = String(req.body.name || "").trim();
      const created = await prisma.$transaction(async (tx) => {
        await tx.batch.updateMany({ where: { active: true }, data: { active: false } });
        const count = await tx.batch.count();
        return tx.batch.create({
          data: {
            name: nameHint || `Batch ${count + 1}`,
            active: true,
          },
        });
      });
      res.status(201).json({
        id: created.id,
        name: created.name,
        active: created.active,
        createdAt: created.createdAt,
        pending: 0,
        completed: 0,
        total: 0,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/batches/:id/activate", async (req, res, next) => {
    try {
      const batch = await prisma.batch.findUnique({ where: { id: req.params.id } });
      if (!batch) {
        res.status(404).json({ error: "Batch not found" });
        return;
      }
      await prisma.$transaction(async (tx) => {
        await tx.batch.updateMany({ where: { active: true }, data: { active: false } });
        await tx.batch.update({ where: { id: batch.id }, data: { active: true } });
      });
      const docs = await prisma.document.findMany({
        where: { batchId: batch.id },
        include: documentInclude,
      });
      const counts = batchCountsFromDocs(docs.map(serializeDocument));
      res.json({
        id: batch.id,
        name: batch.name,
        active: true,
        createdAt: batch.createdAt,
        ...counts,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/batches/:id/reprocess", async (req, res, next) => {
    try {
      const batch = await prisma.batch.findUnique({
        where: { id: req.params.id },
        include: {
          documents: {
            include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
          },
        },
      });
      if (!batch) {
        res.status(404).json({ error: "Batch not found" });
        return;
      }

      let enqueued = 0;
      for (const doc of batch.documents) {
        const current = doc.versions[0];
        if (!current) continue;
        await createVersionAndEnqueue(doc.id, current.storagePath, current.versionNumber + 1, {
          resetReviews: true,
          contentHash: current.contentHash ?? (await hashPdfFile(current.storagePath)),
        });
        enqueued += 1;
      }

      res.json({ batchId: batch.id, enqueued });
    } catch (err) {
      next(err);
    }
  });

  router.get("/batches/:id/export.csv", async (req, res, next) => {
    try {
      const documentTypeId = String(req.query.documentTypeId || "").trim();
      if (!documentTypeId) {
        res.status(400).json({ error: "documentTypeId query param is required" });
        return;
      }

      const batch = await prisma.batch.findUnique({ where: { id: req.params.id } });
      if (!batch) {
        res.status(404).json({ error: "Batch not found" });
        return;
      }

      const documentType = await prisma.documentType.findUnique({
        where: { id: documentTypeId },
        include: { fields: { orderBy: { sortOrder: "asc" } } },
      });
      if (!documentType) {
        res.status(404).json({ error: "Document type not found" });
        return;
      }

      const docs = await prisma.document.findMany({
        where: { batchId: batch.id, documentTypeId },
        include: documentInclude,
        orderBy: { createdAt: "asc" },
      });

      const serialized = docs.map(serializeDocument);
      const typeKeys = documentType.fields.map((f) => f.fieldKey);
      const adHocKeys = new Set<string>();
      for (const d of serialized) {
        for (const v of d.values) {
          if (v.adHoc || !typeKeys.includes(v.fieldKey)) {
            adHocKeys.add(v.fieldKey);
          }
        }
      }
      const extraKeys = [...adHocKeys].sort();
      const headers = [
        "document_id",
        "title",
        "version",
        ...typeKeys,
        ...extraKeys,
        "pdf_url",
      ];

      const rulesByKey = new Map(
        documentType.fields.map((f) => [
          f.fieldKey,
          (Array.isArray(f.formatRules) ? f.formatRules : []) as FormatRule[],
        ]),
      );

      const rows = serialized.map((d) => {
        const byKey = new Map(
          d.values.map((v) => [v.fieldKey, v.effectiveValue ?? ""] as const),
        );
        return [
          d.id,
          d.title,
          String(d.currentVersion?.versionNumber ?? ""),
          ...typeKeys.map((k) =>
            applyFormatRules(byKey.get(k) ?? "", rulesByKey.get(k) || []),
          ),
          ...extraKeys.map((k) => byKey.get(k) ?? ""),
          `${config.publicApiUrl}/documents/${d.id}/file`,
        ];
      });

      const csv = buildCsv(headers, rows);
      const filename = `${batch.name.replace(/[^a-zA-Z0-9._-]+/g, "_")}_${documentType.key}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (err) {
      next(err);
    }
  });

  // --- Document types ---

  router.get("/document-types", async (_req, res, next) => {
    try {
      const types = await prisma.documentType.findMany({
        orderBy: { label: "asc" },
        include: { fields: { orderBy: { sortOrder: "asc" } } },
      });
      res.json({ documentTypes: types.map(serializeDocumentType) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/document-types", async (req, res, next) => {
    try {
      const label = String(req.body.label || "").trim();
      const key =
        String(req.body.key || "").trim() || (label ? slugifyTypeKey(label) : "");
      const fields = parseFieldsInput(req.body.fields);
      if (!label || !key) {
        res.status(400).json({ error: "label (and key) are required" });
        return;
      }
      if (fields.length === 0) {
        res.status(400).json({ error: "At least one field is required" });
        return;
      }

      const existing = await prisma.documentType.findUnique({ where: { key } });
      if (existing) {
        res.status(409).json({ error: `Document type key "${key}" already exists` });
        return;
      }

      const created = await prisma.documentType.create({
        data: {
          key,
          label,
          fields: {
            create: fields.map((f, i) => ({
              fieldKey: f.fieldKey,
              fieldType: f.fieldType,
              formatRules: f.formatRules,
              sortOrder: i,
            })),
          },
        },
        include: { fields: { orderBy: { sortOrder: "asc" } } },
      });
      res.status(201).json(serializeDocumentType(created));
    } catch (err) {
      next(err);
    }
  });

  router.patch("/document-types/:id", async (req, res, next) => {
    try {
      const type = await prisma.documentType.findUnique({
        where: { id: req.params.id },
        include: { fields: true },
      });
      if (!type) {
        res.status(404).json({ error: "Document type not found" });
        return;
      }

      const label =
        req.body.label != null ? String(req.body.label).trim() : type.label;
      if (!label) {
        res.status(400).json({ error: "label cannot be empty" });
        return;
      }

      const fields =
        req.body.fields != null ? parseFieldsInput(req.body.fields) : null;
      if (fields && fields.length === 0) {
        res.status(400).json({ error: "At least one field is required" });
        return;
      }

      const catalogChanged =
        !!fields &&
        fieldCatalogChanged(
          type.fields.map((f) => ({ fieldKey: f.fieldKey, fieldType: f.fieldType })),
          fields,
        );

      const updated = await prisma.$transaction(async (tx) => {
        await tx.documentType.update({
          where: { id: type.id },
          data: {
            label,
            ...(catalogChanged ? { schemaUpdatedAt: new Date() } : {}),
          },
        });

        if (fields) {
          await tx.documentTypeField.deleteMany({ where: { documentTypeId: type.id } });
          await tx.documentTypeField.createMany({
            data: fields.map((f, i) => ({
              documentTypeId: type.id,
              fieldKey: f.fieldKey,
              fieldType: f.fieldType,
              formatRules: f.formatRules,
              sortOrder: i,
            })),
          });
        }

        return tx.documentType.findUniqueOrThrow({
          where: { id: type.id },
          include: { fields: { orderBy: { sortOrder: "asc" } } },
        });
      });

      res.json(serializeDocumentType(updated));
    } catch (err) {
      next(err);
    }
  });

  router.post("/format/preview", async (req, res, next) => {
    try {
      const value = String(req.body.value ?? "");
      const rules = parseFormatRules(req.body.rules ?? [], "string");
      const detail: Array<{
        ruleId: string;
        name: string;
        skipped: boolean;
        reason?: string;
        output: string;
      }> = [];
      let current = value;
      for (const rule of rules) {
        const result = testFormatRule(current, rule);
        detail.push({
          ruleId: rule.id,
          name: rule.name,
          skipped: result.skipped,
          reason: result.reason,
          output: result.output,
        });
        current = result.output;
      }
      res.json({
        input: value,
        output: current,
        steps: detail,
      });
    } catch (err) {
      next(err);
    }
  });

  // --- Documents ---

  router.get("/documents", async (req, res, next) => {
    try {
      const batchId = await resolveBatchId(req.query.batchId);
      const docs = await prisma.document.findMany({
        where: { batchId },
        orderBy: { createdAt: "asc" },
        include: documentInclude,
      });
      res.json({
        documents: await serializeDocumentsWithDuplicates(docs),
        batchId,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/documents",
    upload.fields([
      { name: "files", maxCount: 40 },
      { name: "file", maxCount: 1 },
    ]),
    async (req, res, next) => {
    try {
      const uploaded = req.files as
        | { [fieldname: string]: Express.Multer.File[] }
        | undefined;
      const files = [
        ...(uploaded?.files || []),
        ...(uploaded?.file || []),
      ];

      const documentTypeId = String(req.body.documentTypeId || "").trim();
      const typeKey = String(req.body.type || "").trim();
      const documentType = documentTypeId
        ? await prisma.documentType.findUnique({ where: { id: documentTypeId } })
        : typeKey
          ? await prisma.documentType.findUnique({ where: { key: typeKey } })
          : null;

      if (!documentType) {
        res.status(400).json({ error: "Invalid or missing document type" });
        return;
      }
      if (files.length === 0) {
        res.status(400).json({ error: "At least one PDF file is required" });
        return;
      }

      const requestedBatchId = String(req.body.batchId || "").trim();
      let targetBatch =
        requestedBatchId
          ? await prisma.batch.findUnique({ where: { id: requestedBatchId } })
          : null;
      if (requestedBatchId && !targetBatch) {
        res.status(404).json({ error: "Batch not found" });
        return;
      }
      if (!targetBatch) {
        targetBatch = await getActiveBatch();
      } else if (!targetBatch.active) {
        await prisma.$transaction(async (tx) => {
          await tx.batch.updateMany({ where: { active: true }, data: { active: false } });
          await tx.batch.update({ where: { id: targetBatch!.id }, data: { active: true } });
        });
      }

      const createdIds: string[] = [];
      for (const file of files) {
        const title = String(req.body.title || file.originalname || "Untitled document");
        const storagePath = await persistUploadedFile(file);
        const contentHash = await hashPdfFile(storagePath);
        const document = await prisma.document.create({
          data: {
            batchId: targetBatch.id,
            documentTypeId: documentType.id,
            title,
            versions: {
              create: {
                versionNumber: 1,
                status: "queued",
                storagePath,
                contentHash,
              },
            },
          },
          include: { versions: true },
        });
        createdIds.push(document.id);
        await enqueueExtraction(document.versions[0]!.id);
      }

      if (createdIds.length === 1) {
        const full = await loadDocument(createdIds[0]!);
        const [serialized] = await serializeDocumentsWithDuplicates([full!]);
        res.status(201).json(serialized);
        return;
      }

      const docs = await prisma.document.findMany({
        where: { id: { in: createdIds } },
        include: documentInclude,
      });
      res.status(201).json({ documents: await serializeDocumentsWithDuplicates(docs) });
    } catch (err) {
      next(err);
    }
  },
  );

  router.post("/documents/:id/versions", upload.single("file"), async (req, res, next) => {
    try {
      const document = await prisma.document.findUnique({
        where: { id: req.params.id },
        include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
      });
      if (!document) {
        res.status(404).json({ error: "Document not found" });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: "PDF file is required" });
        return;
      }

      const nextNumber = (document.versions[0]?.versionNumber || 0) + 1;
      const storagePath = await persistUploadedFile(req.file);
      await createVersionAndEnqueue(document.id, storagePath, nextNumber);

      const full = await loadDocument(document.id);
      res.status(201).json(await serializeOneWithDuplicates(full!));
    } catch (err) {
      next(err);
    }
  });

  router.post("/documents/:id/reclassify", async (req, res, next) => {
    try {
      const document = await prisma.document.findUnique({
        where: { id: req.params.id },
        include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
      });
      if (!document?.versions[0]) {
        res.status(404).json({ error: "Document not found" });
        return;
      }

      const documentTypeId = String(req.body.documentTypeId || "").trim();
      const type = await prisma.documentType.findUnique({ where: { id: documentTypeId } });
      if (!type) {
        res.status(400).json({ error: "Invalid document type" });
        return;
      }

      await prisma.document.update({
        where: { id: document.id },
        data: { documentTypeId: type.id },
      });

      const current = document.versions[0];
      await createVersionAndEnqueue(
        document.id,
        current.storagePath,
        current.versionNumber + 1,
        {
          resetReviews: true,
          contentHash: current.contentHash ?? (await hashPdfFile(current.storagePath)),
        },
      );

      const full = await loadDocument(document.id);
      res.json(await serializeOneWithDuplicates(full!));
    } catch (err) {
      next(err);
    }
  });

  router.post("/documents/:id/rescan", async (req, res, next) => {
    try {
      const document = await prisma.document.findUnique({
        where: { id: req.params.id },
        include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
      });
      if (!document?.versions[0]) {
        res.status(404).json({ error: "Document not found" });
        return;
      }

      const current = document.versions[0];
      await createVersionAndEnqueue(
        document.id,
        current.storagePath,
        current.versionNumber + 1,
        {
          resetReviews: true,
          contentHash: current.contentHash ?? (await hashPdfFile(current.storagePath)),
        },
      );

      const full = await loadDocument(document.id);
      res.json(await serializeOneWithDuplicates(full!));
    } catch (err) {
      next(err);
    }
  });

  router.post("/documents/:id/values", async (req, res, next) => {
    try {
      const document = await loadDocument(req.params.id);
      if (!document?.versions[0]) {
        res.status(404).json({ error: "Document not found" });
        return;
      }
      const current = document.versions[0];
      if (current.status !== "extracted") {
        res.status(400).json({ error: "Document must be extracted before adding values" });
        return;
      }

      const fieldKey = normalizeFieldKey(String(req.body.fieldKey || ""));
      const value = String(req.body.value ?? "").trim();
      const saveToType = Boolean(req.body.saveToType);
      const note = req.body.note != null ? String(req.body.note) : null;
      const fieldTypeRaw = String(req.body.fieldType || "string");
      const fieldType = isFieldType(fieldTypeRaw) ? fieldTypeRaw : "string";

      if (!fieldKey) {
        res.status(400).json({ error: "fieldKey is required" });
        return;
      }
      if (!value) {
        res.status(400).json({ error: "value is required" });
        return;
      }

      const existing = (current.values || []).find((v) => v.fieldKey === fieldKey);
      if (existing) {
        res.status(409).json({ error: `Field "${fieldKey}" already exists on this document` });
        return;
      }

      await prisma.$transaction(async (tx) => {
        if (saveToType) {
          const maxOrder = await tx.documentTypeField.aggregate({
            where: { documentTypeId: document.documentTypeId },
            _max: { sortOrder: true },
          });
          const existingField = await tx.documentTypeField.findUnique({
            where: {
              documentTypeId_fieldKey: {
                documentTypeId: document.documentTypeId,
                fieldKey,
              },
            },
          });
          await tx.documentTypeField.upsert({
            where: {
              documentTypeId_fieldKey: {
                documentTypeId: document.documentTypeId,
                fieldKey,
              },
            },
            create: {
              documentTypeId: document.documentTypeId,
              fieldKey,
              fieldType,
              formatRules: defaultFormatRulesForFieldType(fieldType),
              sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
            },
            update: {},
          });
          if (!existingField) {
            await tx.documentType.update({
              where: { id: document.documentTypeId },
              data: { schemaUpdatedAt: new Date() },
            });
          }
        }

        const saved = await tx.extractedValue.create({
          data: {
            versionId: current.id,
            fieldKey,
            value,
            evidence: null,
            gapReason: null,
            certainty: 100,
            carriedOver: false,
            source: "manual",
            adHoc: !saveToType,
          },
        });

        await tx.review.create({
          data: {
            valueId: saved.id,
            decision: "corrected",
            correctedValue: value,
            note: note || (saveToType ? "Manual value; key added to type" : "One-off manual value"),
          },
        });
      });

      const full = await loadDocument(document.id);
      res.status(201).json(serializeDocument(full!));
    } catch (err) {
      next(err);
    }
  });

  router.get("/documents/:id", async (req, res, next) => {
    try {
      const document = await loadDocument(req.params.id);
      if (!document) {
        res.status(404).json({ error: "Document not found" });
        return;
      }
      res.json(await serializeOneWithDuplicates(document));
    } catch (err) {
      next(err);
    }
  });

  router.get("/documents/:id/file", async (req, res, next) => {
    try {
      const document = await prisma.document.findUnique({
        where: { id: req.params.id },
        include: {
          versions: { orderBy: { versionNumber: "desc" }, take: 1 },
        },
      });
      const version = document?.versions[0];
      if (!version) {
        res.status(404).json({ error: "Document not found" });
        return;
      }

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${document.id}-v${version.versionNumber}.pdf"`,
      );
      res.setHeader("Cache-Control", "private, max-age=60");

      if (isRemoteStoragePath(version.storagePath)) {
        const bytes = await readPdfBytes(version.storagePath);
        if (!bytes) {
          res.status(404).json({ error: "PDF file missing in object storage" });
          return;
        }
        res.send(bytes);
        return;
      }

      if (!existsSync(version.storagePath)) {
        res.status(404).json({ error: "PDF file missing on disk" });
        return;
      }
      createReadStream(version.storagePath).pipe(res);
    } catch (err) {
      next(err);
    }
  });

  router.get("/documents/:id/progress", async (req, res, next) => {
    try {
      const document = await loadDocument(req.params.id);
      if (!document) {
        res.status(404).json({ error: "Document not found" });
        return;
      }
      const current = document.versions[0];
      const progress = computeProgress(current?.values || [], CERTAINTY_THRESHOLD);
      res.json(progress);
    } catch (err) {
      next(err);
    }
  });

  router.post("/documents/:id/retry", async (req, res, next) => {
    try {
      const document = await loadDocument(req.params.id);
      if (!document?.versions[0]) {
        res.status(404).json({ error: "Document not found" });
        return;
      }
      const current = document.versions[0];
      if (current.status !== "failed") {
        res.status(400).json({ error: "Only failed versions can be retried" });
        return;
      }
      await prisma.documentVersion.update({
        where: { id: current.id },
        data: { status: "queued", failureReason: null },
      });
      await enqueueExtraction(current.id);
      const full = await loadDocument(document.id);
      res.json(serializeDocument(full!));
    } catch (err) {
      next(err);
    }
  });

  router.post(
    "/documents/:id/reviews/approve-high-confidence",
    async (req, res, next) => {
      try {
        const document = await loadDocument(req.params.id);
        if (!document?.versions[0]) {
          res.status(404).json({ error: "Document not found" });
          return;
        }
        const current = document.versions[0];
        const eligible = (current.values || []).filter(
          (v) =>
            !v.review &&
            !v.gapReason &&
            v.value != null &&
            v.certainty >= CERTAINTY_THRESHOLD,
        );

        await prisma.$transaction(
          eligible.map((v) =>
            prisma.review.create({
              data: {
                valueId: v.id,
                decision: "approved",
              },
            }),
          ),
        );

        const full = await loadDocument(document.id);
        res.json(serializeDocument(full!));
      } catch (err) {
        next(err);
      }
    },
  );

  router.get("/review/next", async (req, res, next) => {
    try {
      const afterId = typeof req.query.after === "string" ? req.query.after : null;
      const batchId = await resolveBatchId(req.query.batchId);
      const docs = await prisma.document.findMany({
        where: { batchId },
        orderBy: { createdAt: "asc" },
        include: documentInclude,
      });

      const serialized = await serializeDocumentsWithDuplicates(docs);
      const candidates = serialized.filter(
        (d) =>
          d.currentVersion?.status === "extracted" &&
          !d.reviewComplete &&
          (d.values?.length || 0) > 0,
      );

      let nextDoc: (typeof candidates)[number] | null = candidates[0] ?? null;
      if (afterId) {
        const idx = candidates.findIndex((d) => d.id === afterId);
        if (idx >= 0) {
          nextDoc = candidates[idx + 1] ?? null;
        }
      }

      res.json({ document: nextDoc });
    } catch (err) {
      next(err);
    }
  });

  router.post("/values/:id/review", async (req, res, next) => {
    try {
      const value = await prisma.extractedValue.findUnique({
        where: { id: req.params.id },
      });
      if (!value) {
        res.status(404).json({ error: "Value not found" });
        return;
      }

      const decision = String(req.body.decision || "");
      if (decision !== "approved" && decision !== "corrected") {
        res.status(400).json({ error: "decision must be approved or corrected" });
        return;
      }

      const correctedValue =
        decision === "corrected" ? String(req.body.correctedValue || "").trim() : null;
      if (decision === "corrected" && !correctedValue) {
        res.status(400).json({ error: "correctedValue is required when correcting" });
        return;
      }

      const note = req.body.note != null ? String(req.body.note) : null;

      const review = await prisma.review.upsert({
        where: { valueId: value.id },
        create: {
          valueId: value.id,
          decision,
          correctedValue,
          note,
        },
        update: {
          decision,
          correctedValue,
          note,
        },
      });

      res.json({
        id: value.id,
        review: {
          decision: review.decision,
          correctedValue: review.correctedValue,
          note: review.note,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
