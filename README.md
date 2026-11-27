# Lomi document extraction & review

PDF in → OpenAI structured extract (with evidence + certainty) → human review → versioned re-extract with review carry-over.

Original brief: [`ASSIGNMENT.md`](ASSIGNMENT.md). Decisions: [`plans/decisions.md`](plans/decisions.md). Timing: [`project-notes.md`](project-notes.md).

## Run

```bash
cp .env.example .env   # set a real OPENAI_API_KEY for LLM mode (optional for first click-around)
docker compose up --build
```

- Web: http://localhost:3000  
- API: http://localhost:3001  
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

## Deploy

### Web (Vercel)

The Next.js app in `apps/web` is set up for Vercel. The Express API + BullMQ worker are **not** Vercel Functions (long-running Redis workers + local PDF disk) — host them separately (Docker, Railway, Fly, etc.) and point the web app at that API.

1. Import the GitHub repo in Vercel.
2. Set **Root Directory** to `apps/web` (uses `apps/web/vercel.json`).
3. Set env:
   - `NEXT_PUBLIC_API_URL` = public HTTPS origin of your API (e.g. `https://api.example.com`)
4. Deploy. CORS on the API must allow the Vercel web origin.

```bash
# From apps/web after `vercel login`
vercel link   # choose the monorepo project; root directory apps/web
vercel env add NEXT_PUBLIC_API_URL
vercel deploy --prod
```

### API + worker

Keep using `docker compose` (or the same image on any container host) with `DATABASE_URL`, `REDIS_URL`, `OPENAI_API_KEY`, `UPLOAD_DIR`, and `PUBLIC_API_URL` (used in CSV `pdf_url` links).

## Cuts / next

**Cut:** PDF page-image rendering, full Vercel-hosted API/worker, SSE, golden labeled evals.  
**Next:** OCR for scans, better confidence calibration, quote bounding boxes, auth, object storage for PDFs.  
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
