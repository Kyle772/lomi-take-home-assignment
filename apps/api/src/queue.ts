import { Queue, type ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";
import { config } from "./config.js";

export type ExtractJobData = {
  versionId: string;
};

let connection: Redis | null = null;
let queue: Queue<ExtractJobData> | null = null;

export function getRedisConnection(): Redis {
  if (!connection) {
    connection = new Redis(config.redisUrl, {
      maxRetriesPerRequest: null,
    });
  }
  return connection;
}

export function getExtractQueue(): Queue<ExtractJobData> {
  if (!queue) {
    queue = new Queue<ExtractJobData>(config.queueName, {
      connection: getRedisConnection() as unknown as ConnectionOptions,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 100,
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
      },
    });
  }
  return queue;
}

export async function enqueueExtraction(versionId: string): Promise<void> {
  const q = getExtractQueue();
  const jobId = `extract-${versionId}`;

  const existing = await q.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    // Already in flight or waiting — do not enqueue a parallel duplicate.
    if (state === "waiting" || state === "active" || state === "delayed" || state === "prioritized") {
      return;
    }
    // Completed/failed jobs keep the id until pruned; remove so a fresh run can reuse it.
    if (state === "completed" || state === "failed") {
      await existing.remove();
    }
  }

  await q.add("extract", { versionId }, { jobId });
}
