import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { createRouter } from "./routes.js";
import { reclaimOrphanedExtractions } from "./reclaim.js";

async function main() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(createRouter());

  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(err);
      res.status(500).json({ error: message });
    },
  );

  try {
    const reclaimed = await reclaimOrphanedExtractions();
    if (reclaimed > 0) {
      console.log(`API boot reclaim enqueued ${reclaimed} job(s)`);
    }
  } catch (err) {
    console.warn("Boot reclaim skipped:", err);
  }

  app.listen(config.port, () => {
    console.log(`API listening on :${config.port}`);
  });
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
