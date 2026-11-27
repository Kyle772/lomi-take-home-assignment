import { prisma } from "@lomi/db";
import { enqueueExtraction } from "./queue.js";

/**
 * After restart or Redis FLUSHALL: any version still queued/extracting in Postgres
 * must be re-enqueued so nothing stays stuck forever.
 */
export async function reclaimOrphanedExtractions(): Promise<number> {
  const orphans = await prisma.documentVersion.findMany({
    where: {
      status: { in: ["queued", "extracting"] },
    },
    select: { id: true, status: true },
  });

  for (const orphan of orphans) {
    if (orphan.status === "extracting") {
      await prisma.documentVersion.update({
        where: { id: orphan.id },
        data: { status: "queued", failureReason: null },
      });
    }
    await enqueueExtraction(orphan.id);
  }

  return orphans.length;
}
