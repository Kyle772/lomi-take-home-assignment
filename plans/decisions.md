# Decisions log

Relative times are from the first chat of this session (**Fri Nov 27, 2026, 11:50 AM UTC-8**).

## D1 — Extraction approach (+16min)

**Choice:** LLM extraction + deterministic post-validation (no parallel deterministic extractor).

**Why:** Brief requires LLM extraction. Deterministic field extractors burn time and fight the graded review/carry-over product. Validation (evidence verbatim, value-in-evidence) is the consistency layer.

## D2 — Correction model (+16min)

**Choice:** Review is an annotation beside an immutable extracted value (`approved` | `corrected` + optional `correctedValue` / `note`). Gaps can be **approved as accurate** (no value; optional `note` holds a revised gap reason) or **corrected** when the reviewer finds a value. Editing a gap reason without a found value stores `approved` + `note`.

**Why:** Provenance stays intact; UI effective value = correction ?? extracted. Missing fields are often correct absences — reviewers need to confirm the gap, not invent a value.

## D3 — Carry-over “unchanged” (+16min)

**Choice:** Same `fieldKey` + whitespace-normalized **evidence** string match vs previous version.

**Why:** Survives surrounding text shifts better than full-document hashes; matches “evidence didn’t change” in the brief. Invoice v2 should leave unchanged fields carried over.

## D4 — Concurrent new version while extracting (+16min)

**Choice:** Accept and queue. Do not cancel in-flight older version. “Current” = highest version number.

**Why:** Simple, predictable, no lost work; both versions remain queryable.

## D5 — Redis vs Postgres (+16min)

**Choice:** Redis/BullMQ = job coordination (`versionId`) only. Status, values, reviews, parsed text, extraction runs live in Postgres. Boot reclaim re-enqueues `queued`/`extracting` versions after restart or Redis `FLUSHALL`. Idempotent upsert on `(versionId, fieldKey)`.

**Why:** Survives Redis flush; nothing user-visible lives only in Redis.

## D6 — PDF parsing (server) (+16min)

**Choice:** No Firecrawl. Server-side text extraction via `unpdf` (see D12). Originally considered `pdf-parse`.

**Why:** Keeps compose lean; Firecrawl’s stack muddies the graded queue/LLM design.

## D7 — LLM + certainty (+16min)

**Choice:** OpenAI structured outputs. Per-field `certainty` 0–100 for **triage only**.

**Why:** Fast schema enforcement. Confidence is poorly calibrated — evidence validation is the hard gate.

## D8 — Review threshold 95 (+16min)

**Choice:** `<95` or gap → focused evidence-chunk UI. `≥95` → bulk-approve eligible. Nothing trusted without a `Review` row.

**Why:** Matches “human reviews every value” while letting certainty cut attention cost.

## D9 — UI kit (+16min)

**Choice:** Next.js App Router + Tailwind + shadcn/ui with custom theme tokens.

**Why:** Fast, accessible primitives; matches JD Next.js preference.

## D10 — Harness, eval, one-doc review (+16min)

**Choice:** `packages/extraction` harness + `packages/eval` fixture evals. Bulk upload enqueues many docs; UI reviews one document at a time via review queue.

**Why:** Defensible extraction quality loop; product flow matches “work one document at a time” with background parse.

## D11 — Offline mock extractor (+37min)

**Choice:** If `OPENAI_API_KEY` is missing/placeholder (or `EXTRACTION_MODE=mock`), use a regex mock that still runs through evidence validation. Real keys use OpenAI.

**Why:** `docker compose up` must be clickable immediately; graded path remains LLM when a key is set.

## D12 — PDF library (server) (+37min)

**Choice:** `unpdf` on Node 22 (Docker + `.nvmrc`).

**Why:** `pdf-parse` hit XRef errors on the fixtures; `unpdf` extracts cleanly.

## D13 — Single source preview (not per-field PDFs) (+55min)

**Choice:** One shared PDF preview on the review screen. Hovering a review field focuses that field’s evidence in the preview. Removed per-card PDF embeds.

**Why:** Less clutter; reviewers can keep eyes on one document while triaging many fields. Matches “work one document at a time.”

## D14 — PDF.js for interactive preview (not browser iframe) (+55min)

**Choice:** Client-side `pdfjs-dist` canvas render for the review preview. Native `<iframe src=".pdf">` is not used for the interactive pane.

**Why:** Browser PDF iframes cannot be scrolled/searched from our JS. PDF.js lets us locate evidence text, highlight it, and pan the viewport to it on hover.

## D15 — Full-height sticky PDF + scrollable review column (+55min)

**Choice:** Review UI is a full-viewport split: left PDF pane (~54%, full browser height, sticky), right column holds document header, “Approve all high-confidence,” and Needs attention / High confidence / Reviewed lists (independent scroll).

**Why:** Maximize readable PDF size; keep actions and triage lists adjacent without shrinking the source document.

## D16 — Pan & zoom on PDF preview (+55min)

**Choice:** Wheel (and +/− controls) zoom; drag to pan; click zoom % to reset. Hover-to-evidence recenters the highlight under the current transform.

**Why:** Fixtures are readable at fit-width, but reviewers need to inspect fine print; pan/zoom is expected for a document-review tool.

## D17 — Evidence focus: vertical-first, tight boxes (+59min)

**Choice:** On hover, compute tight PDF.js text-item rects for the evidence span (no full-line highlights). Pan **vertically** to center the evidence. Adjust **horizontal** pan only if the highlight would be clipped — do not center X on wide/ambiguous boxes.

**Why:** Full-line / wrong-width boxes made X pan jump randomly; vertical placement is what reviewers need to verify a quote.

## D18 — WCAG-minded evidence highlights (+62min)

**Choice:** PDF evidence overlays use `mix-blend-mode: multiply` with solid amber (`#f5d000`) plus a dark outline (`#5c4200`). No semi-transparent yellow wash over glyphs.

**Why:** Semi-opaque yellow over a canvas PDF lightens black text and fails readable contrast. Multiply keeps ink dark on a yellow tint (text stays high-contrast); the outline meets WCAG 2.0 non-text contrast (≥3:1) for the focus indicator.

## D19 — Floating review over 70% PDF (+67min)

**Choice:** Review layout is ~70% PDF / ~30% field list. Navigation is a bottom-center floating action bar (← / → + approve-high). The active extracted value appears in a floating card anchored to the evidence highlight; placement flips among bottom / top / right / left (clamped to the PDF pane) so the card stays in viewport. Approve and edit live on that card. Gaps with no highlight fall back to a centered card over the PDF pane. The card is **draggable** (handle + Reset); once moved, auto-anchoring pauses until Reset or the next field. Arrow keys also move between review points.

**Why:** Reviewers verify against the source document first; chrome and triage should not shrink the PDF. Anchoring the decision UI to the highlight keeps value ↔ evidence in one glance without a separate evidence panel. Drag matters for gaps — reviewers must scan the PDF manually without the card blocking the page.

## D20 — DB-backed document types (+91min)

**Choice:** `DocumentType` + `DocumentTypeField` live in Postgres. Documents reference a type via FK. Extraction loads the type’s field list at runtime (no hard-coded catalog). Multi-PDF upload assigns all files to the selected type. **Rescan / reclassify** creates a new `DocumentVersion` reusing the same PDF path and re-queues extraction. Reviewers can **Add value** manually (`source=manual`); `saveToType` upserts the key onto the type for future scans, otherwise `adHoc=true` for this document only.

**Why:** Operators need to define “Rent Agreement”-style schemas without code changes, fix misclassification without losing history, and capture one-off findings during review.

## D21 — Batches, dual queues, CSV export (+101min)

**Choice:** Documents belong to a `Batch`. Exactly one batch is **active** for uploads; “Start new batch” closes the current active and opens an empty one. The home UI can **load** any batch for pending/completed queues, review-next, export, and reprocess. Document types are global across batches. **Export CSVs** downloads one CSV per document type in the loaded batch (`document_id`, `title`, `version`, field columns, `pdf_url` → public API `/documents/:id/file`). **Reprocess batch** creates a new version per doc (same PDF) and re-extracts under each doc’s current type schema.

**Why:** Mass parsing needs isolation between loads without losing prior work; CSV is the handoff format; PDF links reuse the local API file route (no object storage).

## D22 — Ordered output format rules on type fields (+111min)

**Choice:** Each `DocumentTypeField` stores an ordered `formatRules` JSON list (regex-gated transforms: ensure prefix/suffix/decimals, regex replace, date format). Money and date fields seed sensible defaults. Formatting runs at **read/export time** only (CSV + `formattedValue` on serialize) — never mutates stored `ExtractedValue.value`. Review UI continues to show raw/`effectiveValue`. Format-only edits do **not** bump `schemaUpdatedAt`, so they do not force re-extract.

**Why:** Operators need `$` / `.00` / date layout consistency in cleaned handoff without re-running extraction or fighting independently skippable rules.

## D23 — Vercel multi-service + Neon + Blob (+~150min)

**Choice:** Single Vercel project with services `api` (Express) + `web` (Next.js), public rewrites `/api` → api and `/` → web, service binding `API_URL` for SSR, and a **Vercel Daemon** running the BullMQ worker image. Postgres via **Neon** (Vercel integration). PDFs via **Vercel Blob** when `BLOB_READ_WRITE_TOKEN` is set (Functions and Daemons do not share disk). Redis via Marketplace (Upstash) for the queue. Express mounts routes at both `/api` and `/` for rewrite + binding compatibility.

**Why:** Keep deploy surface on one platform; Neon matches the existing Prisma schema; Blob is required so the daemon can read uploads that landed in a Function.

## D24 — Vercel API entry is a bundled `.mjs` (+deploy)

**Choice:** Ship the Express service entry as `vercel-api.mjs` → esbuild-bundled `dist/vercel-api.mjs` (ESM). Do not rely on `"type":"module"` surviving into `/var/task`.

**Why:** Production logs showed `SyntaxError: Cannot use import statement outside a module` on `/var/task/index.js` — Vercel flattened the function without our package.json module type. `.mjs` is always ESM.

## D25 — Accept Neon-prefixed Vercel env names

**Choice:** Resolve `DATABASE_URL` from `NEON_DATABASE_DATABASE_URL` / `NEON_DATABASE_POSTGRES_PRISMA_URL` (and unpooled variants for migrate). Redis accepts `REDIS_KV_URL`. `PUBLIC_API_URL` falls back to `https://$VERCEL_URL/api`.

**Why:** The Neon Marketplace resource injects prefixed secrets, not plain `DATABASE_URL`, so Prisma would otherwise fail after a successful connect.
