import { Worker, type ConnectionOptions } from "bullmq";
import { prisma } from "@lomi/db";
import { extractWithOpenAI, parsePdfFile } from "@lomi/extraction";
import type { ExpectedField, FieldType } from "@lomi/shared";
import { buildValuesWithCarryOver } from "./carry-over.js";
import { config } from "./config.js";
import { getRedisConnection, type ExtractJobData } from "./queue.js";
import { reclaimOrphanedExtractions } from "./reclaim.js";

function toCatalog(
  fields: Array<{ fieldKey: string; fieldType: string; sortOrder: number }>,
): ExpectedField[] {
  return fields
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((f) => ({
      field: f.fieldKey,
      type: (f.fieldType as FieldType) || "string",
    }));
}

async function processExtraction(versionId: string): Promise<void> {
  const version = await prisma.documentVersion.findUnique({
    where: { id: versionId },
    include: {
      document: {
        include: {
          documentType: {
            include: { fields: { orderBy: { sortOrder: "asc" } } },
          },
        },
      },
    },
  });

  if (!version) {
    console.warn(`Version ${versionId} not found; skipping`);
    return;
  }

  if (version.status === "extracted") {
    console.log(`Version ${versionId} already extracted; skipping`);
    return;
  }

  // Atomic claim: only one worker may move queued/failed → extracting.
  const claimed = await prisma.documentVersion.updateMany({
    where: {
      id: versionId,
      status: { in: ["queued", "failed"] },
    },
    data: { status: "extracting", failureReason: null },
  });
  if (claimed.count === 0) {
    console.log(
      `Version ${versionId} already claimed or not claimable (status=${version.status}); skipping`,
    );
    return;
  }

  try {
    const docType = version.document.documentType;
    if (!docType) {
      throw new Error("Document has no document type");
    }
    const catalog = toCatalog(docType.fields);
    if (catalog.length === 0) {
      throw new Error(`Document type "${docType.key}" has no fields configured`);
    }

    const parsedText = await parsePdfFile(version.storagePath);
    if (!parsedText) {
      throw new Error("PDF parsed to empty text");
    }

    await prisma.documentVersion.update({
      where: { id: versionId },
      data: { parsedText },
    });

    const result = await extractWithOpenAI({
      documentTypeKey: docType.key,
      documentTypeLabel: docType.label,
      catalog,
      parsedText,
      apiKey: config.openaiApiKey,
      model: config.openaiModel,
    });

    await prisma.extractionRun.create({
      data: {
        versionId,
        prompt: result.prompt,
        rawResponse: result.rawResponse,
        outcome: "success",
      },
    });

    const priorVersion = await prisma.documentVersion.findFirst({
      where: {
        documentId: version.documentId,
        versionNumber: version.versionNumber - 1,
      },
      include: {
        values: { include: { review: true } },
      },
    });

    const planned = buildValuesWithCarryOver(
      versionId,
      result.fields,
      priorVersion?.values || [],
      { copyReviews: !version.resetReviews },
    );

    await prisma.$transaction(async (tx) => {
      for (const row of planned) {
        const saved = await tx.extractedValue.upsert({
          where: {
            versionId_fieldKey: {
              versionId: row.versionId,
              fieldKey: row.fieldKey,
            },
          },
          create: {
            versionId: row.versionId,
            fieldKey: row.fieldKey,
            value: row.value,
            evidence: row.evidence,
            gapReason: row.gapReason,
            certainty: row.certainty,
            carriedOver: row.carriedOver,
            previousValueId: row.previousValueId,
            source: "extracted",
            adHoc: false,
          },
          update: {
            value: row.value,
            evidence: row.evidence,
            gapReason: row.gapReason,
            certainty: row.certainty,
            carriedOver: row.carriedOver,
            previousValueId: row.previousValueId,
            source: "extracted",
            adHoc: false,
          },
        });

        if (row.reviewToCopy) {
          await tx.review.upsert({
            where: { valueId: saved.id },
            create: {
              valueId: saved.id,
              decision: row.reviewToCopy.decision,
              correctedValue: row.reviewToCopy.correctedValue,
              note: row.reviewToCopy.note,
            },
            update: {
              decision: row.reviewToCopy.decision,
              correctedValue: row.reviewToCopy.correctedValue,
              note: row.reviewToCopy.note,
            },
          });
        }
      }

      await tx.documentVersion.update({
        where: { id: versionId },
        data: {
          status: "extracted",
          failureReason: null,
          extractedSchemaAt: docType.schemaUpdatedAt,
        },
      });
    });

    console.log(`Extracted version ${versionId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Extraction failed for ${versionId}:`, message);

    await prisma.extractionRun.create({
      data: {
        versionId,
        prompt: "",
        rawResponse: "",
        outcome: "failed",
        error: message,
      },
    });

    await prisma.documentVersion.update({
      where: { id: versionId },
      data: { status: "failed", failureReason: message },
    });
  }
}

async function main() {
  console.log("Worker starting; reclaiming orphaned extraction jobs…");
  const reclaimed = await reclaimOrphanedExtractions();
  console.log(`Reclaimed ${reclaimed} job(s)`);

  const worker = new Worker<ExtractJobData>(
    config.queueName,
    async (job) => {
      await processExtraction(job.data.versionId);
    },
    {
      connection: getRedisConnection() as unknown as ConnectionOptions,
      concurrency: 2,
    },
  );

  worker.on("failed", (job, err) => {
    console.error(`Job ${job?.id} failed:`, err.message);
  });

  const shutdown = async (signal: string) => {
    console.log(`Worker received ${signal}; closing…`);
    await worker.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  console.log("Extraction worker listening");
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
