# Phase notes

- Scaffold + decisions logged 2026-11-27.
- Stack runs via `docker compose up` (Postgres host :5433, Redis host :6380).
- PDF parse via `unpdf` (Node 22); review preview via PDF.js with pan/zoom + hover-to-evidence (D13–D16).
- Placeholder OpenAI key → mock extractor with evidence validation; real key → OpenAI structured outputs.
