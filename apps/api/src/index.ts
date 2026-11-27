import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { createRouter } from "./routes.js";

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

  // Orphan job reclaim lives on the worker boot only (stable BullMQ job ids).

  app.listen(config.port, () => {
    console.log(`API listening on :${config.port}`);
  });
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
