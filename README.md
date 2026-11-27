# Lomi document extraction and review

Upload a PDF, and an LLM extracts structured fields with supporting evidence. A reviewer approves or corrects every value before it's trusted. When a revised PDF arrives, we run the extraction again and keep reviews where the evidence hasn't changed.

Brief: [`ASSIGNMENT.md`](ASSIGNMENT.md). Decision log: [`notes_and_plans/decisions.md`](notes_and_plans/decisions.md).

## How to run and what to click first

```bash
cp .env.example .env   # optional: real OPENAI_API_KEY for LLM mode
docker compose up --build
```

- Web: http://localhost:3000
- API: http://localhost:3001 (`/api/...`)
- Host ports: Postgres `5433`, Redis `6380` (containers use the usual internal ports)

Compose runs migrations, seeds **version 1** of the fixture docs, then starts the API, worker, and web app.

If you don't have a real `OPENAI_API_KEY`, extraction falls back to a **mock harness**. Evidence validation still runs, so you can start reviewing right away. Set a real key (or `EXTRACTION_MODE=openai`) to use the graded LLM path.

**First click path**

1. Open http://localhost:3000. The seeded invoice, lease, and report should already be extracting or ready.
2. Click **Start / continue review**. You'll see low-certainty fields and gaps first, with evidence highlighted in the PDF.
3. Approve or Edit each item. **Approve all high-confidence** handles fields at ≥95%. It still writes `Review` rows because nothing is trusted without one.
4. On the summary, click **Next** or upload more documents. To test carry-over, finish reviewing the invoice, then upload `fixtures/documents/invoice-001.v2.pdf` as a new version. Unchanged fields keep their reviews. The two changed fields return to pending, with the prior value shown beside them.

## Monorepo layout (and why)

| Path | Role |
|------|------|
| `apps/api` | Express HTTP + BullMQ worker entry |
| `apps/web` | Next.js review UI |
| `packages/db` | Prisma schema, migrations, seed |
| `packages/shared` | Thresholds, evidence normalization helpers, shared types |
| `packages/extraction` | PDF parsing (`unpdf`) + OpenAI harness + evidence validation |
| `packages/eval` | Offline fixture evals against the harness |

Turborepo runs `build` / `test` / `lint`, with `^build` ensuring packages compile before apps. Extraction lives in its own library because both the worker and eval call it. That keeps prompts and validation out of route handlers. The API handles queue/reclaim/HTTP, while the web app communicates only through HTTP. One `docker compose up` from the root starts everything.

## Schema: versions, values, reviews

```
Batch
  └── Document  →  DocumentType (+ DocumentTypeField[])
        └── DocumentVersion[]   (immutable PDF + parsedText + status)
              ├── ExtractedValue[]  unique (versionId, fieldKey)
              │     └── Review?     (annotation; does not overwrite value)
              └── ExtractionRun[]   (prompt + raw LLM response)
```

**Why it works this way**

- **Versions are immutable snapshots.** Uploading a PDF creates a new `DocumentVersion`. Existing text and values never change. The version with the highest `versionNumber` is current.
- **ExtractedValue records provenance.** Extraction, or a manual addition, supplies `value`, `evidence`, `certainty`, and `gapReason`. The unique `(versionId, fieldKey)` constraint keeps retries idempotent. A second run upserts the row instead of creating a duplicate.
- **A review sits beside the value.** It doesn't replace it. Decisions are `approved` or `corrected`, with an optional `correctedValue` or `note`. The effective value in the UI and API is `correction ?? extracted`. Reviewers can approve a gap as an accurate absence or correct it when they find a value. Either way, the original provenance remains intact.
- **Values retain lineage across versions.** Each new value can reference `previousValueId`. When the `fieldKey` matches, the whitespace-normalized evidence is unchanged, and a prior review exists, that review is copied and marked `carriedOver`. If the evidence changed, the new value remains pending. The previous value and review stay visible for context. Old versions are never deleted.
- **DocumentType lives in Postgres.** It isn't a hard-coded catalog. Extraction loads the type's field list at runtime. Format rules on type fields run only when data is read or exported. They don't change stored values or trigger extraction again.
- **Batches separate mass uploads.** New uploads go to one active batch. Any earlier batch can still be loaded for review, export, or reprocessing.

A new version may arrive while an older one is still extracting. We accept it and add it to the queue without cancelling the in-flight job. Both versions remain queryable.

## Extraction coordination: Redis and Postgres

| Redis (BullMQ) | Postgres |
|----------------|----------|
| Job coordination only (`versionId` on the queue) | Documents, versions, status, parsed text, values, reviews, extraction runs |

**Consistency rules**

1. **The upload path writes to Postgres before enqueueing.** The version row is marked `queued` before Redis sees the job. If enqueueing fails after the insert, boot reclaim finds it.
2. **Workers claim jobs through Postgres.** Only one worker can move `queued`/`failed` → `extracting` (`updateMany` with a status predicate). Redis may deliver a job twice. The second claim does nothing.
3. **Results are committed in a transaction.** Value upserts, the optional review copy, and the status change to `extracted` happen together. A failure sets the status to `failed`, records the reason, and leaves the job retryable. `ExtractionRun` always records the LLM response or error.
4. **Boot reclaim handles interrupted jobs.** When the API or worker starts, every version still marked `queued` or `extracting` is reset to `queued` and re-enqueued from Postgres. This covers `docker compose restart`, killed containers, and Redis `FLUSHALL`. Visible state never exists only in Redis, so a flush doesn't cause data loss. Mid-flight work either finishes or remains visibly retryable instead of staying in `extracting` forever.
5. **Idempotent upserts** on `(versionId, fieldKey)` ensure that a retry after a crash during a write still produces one row per field.

Polling the document list is enough here. Extractions finish in seconds, not minutes, and SSE would add complexity without making the flow clearer.

## Open decisions: what I chose and why

| Decision | Choice | Why |
|----------|--------|-----|
| Correction model | Annotation beside immutable extraction | Preserves provenance. The effective UI value is `correction ?? extracted`. |
| "Unchanged" for carry-over | Same field + whitespace-normalized evidence | Handles surrounding text shifts better than whole-document hashes and matches the brief's invoice v2. |
| Concurrent new version while extracting | Accept + queue; don't cancel older | Avoids lost work and keeps both versions queryable. |
| Redis vs Postgres line | Redis = coordination only | The system survives `FLUSHALL`. Anything visible to users lives in Postgres. |
| LLM | OpenAI structured outputs + certainty for triage | Structured outputs enforce the schema quickly. Evidence validation is the real gate, not confidence. |
| Certainty threshold | `<95` or gap → needs attention; `≥95` bulk-approvable | A human still reviews every value because each one requires a Review row. Certainty only reduces the attention cost. |
| PDF parse | `unpdf` on Node 22 | `pdf-parse` failed on the fixtures' XRefs. |
| Offline path | Mock extractor when no real API key | Keeps Compose usable on day one. |
| UI | Next.js + Tailwind + PDF.js preview (pan/zoom, hover-to-evidence) | Browser PDF iframes can't be controlled from JavaScript. One shared preview works better than separate embeds for every field. |
| Document types | DB-backed schemas + batches + CSV export | Operators can define types and reclassify documents without a code deploy. |

Full notes for each decision are in [`notes_and_plans/decisions.md`](notes_and_plans/decisions.md).

## What I cut / what I'd do next

**Cut for time**

- SSE / websockets (polling is fine here)
- Golden labeled evals in CI (harness + offline eval package exist; not wired as a gate)
- Auth, multi-tenant isolation, object-storage abstraction beyond local disk / Vercel Blob
- OCR for scanned PDFs
- Confidence calibration beyond the raw model score

**Next**

- OCR pipeline for image-only PDFs
- Eval CI against a golden set so prompt changes don't regress carry-over
- Store quote bounding boxes at extract time (today we re-locate evidence in the client PDF.js layer)
- Auth + audit trail on reviews
- Stronger outbox: persist "enqueue requested" in Postgres and run a sweeper, instead of relying only on boot reclaim

## At 10,000 documents

What I'd change first:

- **Next.js worker pools and sharded queues:** Use separate queues for each document type or batch, with concurrency caps so one fat PDF can't starve everything else.
- **Move old `parsedText` out of the hot row:** Store large versions in object storage with a hash. Keep enough text for evidence checks, or re-parse on demand through a content-addressed cache.
- **Add an extraction outbox:** Use durable enqueueing with a sweeper, not just boot-time reclaim. A long-running API shouldn't need a restart to unstick work.
- **Build read models for the queue UI:** Materialize pending, approved, and corrected counts instead of recalculating them on every list poll.
- **Run evals and canaries:** Shadow-run prompt changes on a sample. Promote them only when evidence-validation and carry-over rates hold.
- **Use blob storage throughout:** Local disk is fine for the take-home. At volume, uploads and worker reads need shared object storage, which is already the Vercel path via Blob.

## Tests

```bash
pnpm test
```

Covers evidence validation, carry-over planning, progress counts, and harness eval invariants.

## Deploy (Vercel)

The root [`vercel.json`](vercel.json) defines two services: `web` (Next.js) and `api` (Express). It also includes a BullMQ **daemon** (`apps/api/Dockerfile.worker`). Requests to `/api/*` are rewritten to the API. Use Neon for Postgres, Upstash for Redis, and Blob for PDFs because Functions and the daemon don't share a disk.

Run the migration once with the Neon **unpooled** URL. Seed the database if you want fixtures, set `OPENAI_API_KEY`, then deploy. For day-to-day work, local Docker is still the fastest option.

## Local development (without full Compose app build)

```bash
docker compose up postgres redis -d
pnpm install
pnpm db:generate && pnpm db:migrate && pnpm db:seed
pnpm --filter @lomi/api dev
pnpm --filter @lomi/api worker
pnpm --filter @lomi/web dev
```
