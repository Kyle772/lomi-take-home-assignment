# Project notes — Lomi take-home

## Timing

| | |
|---|---|
| **Start** | 2026-11-27 20:04:55 UTC / 12:04:55 PST |
| **End** | 2026-11-27 22:52:32 UTC / 14:52:32 PST | 
| **Duration** | 2 hours 47 minutes 37 seconds |
| **Deadline** | 2026-11-28 23:59 UTC |

## Demo click-path

1. `docker compose up` at repo root (set `OPENAI_API_KEY` in `.env`).
2. Open web UI → seeded docs (invoice / lease / report v1) should already be extracting or ready.
3. Open **Review** for a ready doc → triage low-certainty fields → Approve / Edit.
4. **Approve all high-confidence** for ≥95% fields.
5. Summary screen → **Next** or upload more / upload invoice v2 for carry-over.

## Stack reminder

pnpm + Turborepo · Express · Prisma/Postgres · BullMQ/Redis · Next.js + Tailwind/shadcn · OpenAI harness (`unpdf` parse; mock fallback without a real API key)

Decisions live in [`plans/decisions.md`](plans/decisions.md).

## Local ports

| Service | URL / port |
|---------|------------|
| Web | http://localhost:3000 |
| API | http://localhost:3001 |
| Postgres (host) | localhost:5433 |
| Redis (host) | localhost:6380 |
