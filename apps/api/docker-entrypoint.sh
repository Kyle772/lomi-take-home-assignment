#!/bin/sh
set -e

cd /app/packages/db
pnpm exec prisma migrate deploy
pnpm exec tsx src/seed.ts

cd /app/apps/api
if [ "$RUN_MODE" = "worker" ]; then
  exec node dist/worker.js
else
  exec node dist/index.js
fi
