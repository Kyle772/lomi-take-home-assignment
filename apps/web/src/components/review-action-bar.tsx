"use client";

import { Button } from "@/components/ui/button";

export function ReviewActionBar({
  index,
  total,
  fieldKey,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onApproveHigh,
  highCount,
  busy,
}: {
  index: number;
  total: number;
  fieldKey: string | null;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onApproveHigh: () => void;
  highCount: number;
  busy: boolean;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-border bg-card/95 px-2 py-2 shadow-xl backdrop-blur">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="rounded-full px-3"
          disabled={!canPrev}
          onClick={onPrev}
          aria-label="Previous review point"
        >
          ←
        </Button>

        <div className="min-w-0 px-2 text-center">
          <div className="truncate text-sm font-semibold">
            {fieldKey || "No pending fields"}
          </div>
          <div className="text-[11px] text-muted">
            {total === 0 ? "All reviewed" : `${index + 1} of ${total}`}
          </div>
        </div>

        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="rounded-full px-3"
          disabled={!canNext}
          onClick={onNext}
          aria-label="Next review point"
        >
          →
        </Button>

        {highCount > 0 ? (
          <Button
            type="button"
            size="sm"
            className="ml-1 hidden rounded-full sm:inline-flex"
            disabled={busy}
            onClick={onApproveHigh}
          >
            Approve high ({highCount})
          </Button>
        ) : null}
      </div>
    </div>
  );
}
