# Lomi document extraction & review

PDF in → OpenAI structured extract (with evidence + certainty) → human review → versioned re-extract with review carry-over.

Original brief: [`ASSIGNMENT.md`](ASSIGNMENT.md). Decisions: [`plans/decisions.md`](plans/decisions.md). Timing: [`project-notes.md`](project-notes.md).

## Run

```bash
cp .env.example .env   # set a real OPENAI_API_KEY for LLM mode (optional for first click-around)
docker compose up --build
```

- Web: http://localhost:3000  
- API: http://localhost:3001 (routes under `/api/...`)  
- Host DB/Redis mapped to `localhost:5433` / `localhost:6380` (containers still use internal ports)

Compose runs migrations, seeds **version 1** of the fixture documents, and starts API + worker + web. Open the queue, wait for extraction, then **Start / continue review**.

Extraction uses **OpenAI** when `OPENAI_API_KEY` looks real; otherwise a **mock harness** fills fields from the parsed text (same evidence validation path) so the review UI is usable immediately. Set a real key (or `EXTRACTION_MODE=openai`) for the graded LLM path.

### What to click first

1. Open http://localhost:3000 — seeded invoice / lease / report should appear.
2. **Start / continue review** → triage low-certainty / gaps (evidence highlighted) → Approve or Edit.
3. **Approve all high-confidence** for ≥95% fields (still writes review rows).
4. Summary → **Next** or upload more. For carry-over: on a reviewed invoice, upload `fixtures/documents/invoice-001.v2.pdf` as a new version.

## Monorepo layout

| Path | Role |
|------|------|
| `apps/api` | Express API + BullMQ worker entrypoint |
| `apps/web` | Next.js review UI (Tailwind + shadcn-style primitives) |
| `packages/db` | Prisma schema / migrations / seed |
| `packages/shared` | Field catalog, certainty threshold, normalize helpers |
| `packages/extraction` | PDF parse + OpenAI harness + evidence validation |
| `packages/eval` | Offline harness evals |

Turborepo pipelines: `build`, `test`, `lint`.

## Schema (why)

- **Document** → many **DocumentVersion** (immutable PDFs + `parsedText` + status).
- **ExtractedValue** per `(versionId, fieldKey)` — immutable extraction provenance (`value`, `evidence`, `certainty`, `gapReason`). Unique constraint = idempotent re-runs.
- **Review** annotation beside a value (`approved` \| `corrected`) — corrections do not overwrite extraction.
- **ExtractionRun** stores prompt + raw LLM response for debugging.
- Carry-over: new version links `previousValueId`; if evidence (whitespace-normalized) matches and prior had a review, copy review and set `carriedOver`.

Current version = highest `versionNumber`. New versions are accepted even while a prior version is still extracting (queued independently).

## Redis vs Postgres

| Redis (BullMQ) | Postgres |
|----------------|----------|
| Job coordination (`versionId`) | Documents, versions, values, reviews, runs, status, parsed text |

On API/worker boot, any version still `queued`/`extracting` is re-enqueued from Postgres. After `FLUSHALL` + restart, visible state survives; mid-flight work becomes completed or visibly `failed`/retryable — never stuck forever. Failures set status `failed` with reason + Retry.

## Extraction harness

1. Parse PDF text (`pdf-parse`).
2. OpenAI structured output: fields + evidence + certainty.
3. Deterministic validation: evidence must appear verbatim; value must appear in evidence; else **gap** (`value: null` + reason).
4. Certainty is **triage only** (threshold 95). Nothing is trusted without a Review row.

## Product review flow

Bulk upload enqueues many docs. UI reviews **one document at a time**: needs-attention first, high-confidence bulk-approve, then cleaned summary → next in queue.

## Tests

```bash
pnpm test
```

Covers evidence validation, carry-over planning, progress counts, harness eval invariants.

## Deploy (Vercel)

Root [`vercel.json`](vercel.json) defines two **services** + one **daemon**:

| Unit | Role |
|------|------|
| `web` | Next.js UI (`apps/web`) |
| `api` | Express (`apps/api`), public path `/api/*` |
| `worker` daemon | BullMQ consumer (`apps/api/Dockerfile.worker`) |

Edge rewrites: `/api/*` → `api`, everything else → `web`. The web service binds `API_URL` to the api service for SSR.

### One-time setup

1. Import the monorepo in Vercel (root directory = repo root; do **not** set `apps/web`).
2. **Neon** — Vercel Storage → Neon → connect. Copies `DATABASE_URL` (and usually `DATABASE_URL_UNPOOLED`) into the project. Run migrations once against Neon:
   ```bash
   DATABASE_URL='…neon…' pnpm --filter @lomi/db exec prisma migrate deploy
   DATABASE_URL='…neon…' pnpm --filter @lomi/db exec tsx src/seed.ts   # optional
   ```
3. **Redis** — Upstash (or Redis) from the Vercel Marketplace. Set `REDIS_URL` for **api**, **web** (if needed), and the **worker** daemon.
4. **Blob** — Vercel Storage → Blob. Sets `BLOB_READ_WRITE_TOKEN` so uploads leave Function `/tmp` and the daemon can fetch PDFs.
5. Set shared env on the project (all services + daemon):
   - `OPENAI_API_KEY` / `OPENAI_MODEL` (optional; mock harness without a real key)
   - `PUBLIC_API_URL` = `https://<your-deployment>/api`
   - Leave `NEXT_PUBLIC_API_URL` unset in production (browser uses same-origin `/api`).
6. Deploy. Confirm the daemon shows as running in the Vercel dashboard.

Local Docker remains the fastest path for day-to-day work (`docker compose up --build`).

## Cuts / next

**Cut:** PDF page-image rendering, SSE, golden labeled evals.  
**Next:** OCR for scans, better confidence calibration, quote bounding boxes, auth.  
**At 10k docs:** separate worker pool, extraction sharding, stronger idempotency / outbox, eval CI against golden set.

## Local dev (without full compose app build)

```bash
docker compose up postgres redis -d
pnpm install
pnpm db:generate && pnpm db:migrate && pnpm db:seed
pnpm --filter @lomi/api dev
pnpm --filter @lomi/api worker
pnpm --filter @lomi/web dev
```
