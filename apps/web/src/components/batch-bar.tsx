"use client";

import type { BatchDto } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function BatchBar({
  batches,
  selectedBatchId,
  busy,
  onSelect,
  onStartNew,
  onReprocess,
  onExport,
}: {
  batches: BatchDto[];
  selectedBatchId: string;
  busy: boolean;
  onSelect: (batchId: string) => void;
  onStartNew: () => void;
  onReprocess: () => void;
  onExport: () => void;
}) {
  const selected = batches.find((b) => b.id === selectedBatchId);

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="shrink-0 whitespace-nowrap"
          disabled={busy}
          onClick={onStartNew}
        >
          New batch
        </Button>

        <select
          className="min-w-[12rem] flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          value={selectedBatchId}
          disabled={!batches.length || busy}
          onChange={(e) => onSelect(e.target.value)}
        >
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} · {b.pending} pending / {b.completed} done
            </option>
          ))}
        </select>

        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0 whitespace-nowrap"
          disabled={busy || !selectedBatchId}
          onClick={onReprocess}
        >
          Reprocess
        </Button>

        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0 whitespace-nowrap"
          disabled={busy || !selectedBatchId}
          onClick={onExport}
        >
          Export CSVs
        </Button>
      </div>

      {selected ? (
        <p className="mt-2 text-xs text-muted">
          Working in {selected.name}. Uploads and review use this batch.
        </p>
      ) : null}
    </div>
  );
}
