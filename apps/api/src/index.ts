import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { createRouter } from "./routes.js";

const app: express.Application = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const routes = createRouter();
// Public edge rewrite keeps `/api/...`; service binding and some local clients hit the root.
app.use("/api", routes);
app.use(routes);

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

export default app;

if (!process.env.VERCEL) {
  app.listen(config.port, () => {
    console.log(`API listening on :${config.port}`);
  });
}
