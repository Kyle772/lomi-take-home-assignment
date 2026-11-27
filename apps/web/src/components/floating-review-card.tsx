"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ValueDto } from "@/lib/api";
import { reviewValue } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AnchorRect = { left: number; top: number; width: number; height: number };

type Placement = "top" | "bottom" | "left" | "right" | "center" | "manual";

function clampPos(
  left: number,
  top: number,
  cardW: number,
  cardH: number,
  bounds: AnchorRect | null,
) {
  const margin = 8;
  const minLeft = bounds ? bounds.left + margin : margin;
  const minTop = bounds ? bounds.top + margin : margin;
  const maxLeft = bounds
    ? Math.max(minLeft, bounds.left + bounds.width - cardW - margin)
    : Math.max(minLeft, window.innerWidth - cardW - margin);
  const maxTop = bounds
    ? Math.max(minTop, bounds.top + bounds.height - cardH - margin)
    : Math.max(minTop, window.innerHeight - cardH - margin);

  return {
    left: Math.min(Math.max(left, minLeft), maxLeft),
    top: Math.min(Math.max(top, minTop), maxTop),
  };
}

function pickPlacement(
  anchor: AnchorRect,
  cardW: number,
  cardH: number,
  bounds: AnchorRect,
  gap = 12,
): { left: number; top: number; placement: Placement } {
  const candidates: Array<{
    placement: Placement;
    left: number;
    top: number;
    fits: boolean;
    overflow: number;
  }> = [
    {
      placement: "bottom",
      left: anchor.left + anchor.width / 2 - cardW / 2,
      top: anchor.top + anchor.height + gap,
      fits: false,
      overflow: 0,
    },
    {
      placement: "top",
      left: anchor.left + anchor.width / 2 - cardW / 2,
      top: anchor.top - gap - cardH,
      fits: false,
      overflow: 0,
    },
    {
      placement: "right",
      left: anchor.left + anchor.width + gap,
      top: anchor.top + anchor.height / 2 - cardH / 2,
      fits: false,
      overflow: 0,
    },
    {
      placement: "left",
      left: anchor.left - gap - cardW,
      top: anchor.top + anchor.height / 2 - cardH / 2,
      fits: false,
      overflow: 0,
    },
  ];

  for (const c of candidates) {
    const overflowX =
      Math.max(0, bounds.left + 8 - c.left) +
      Math.max(0, c.left + cardW - (bounds.left + bounds.width - 8));
    const overflowY =
      Math.max(0, bounds.top + 8 - c.top) +
      Math.max(0, c.top + cardH - (bounds.top + bounds.height - 8));
    c.overflow = overflowX + overflowY;
    c.fits = overflowX === 0 && overflowY === 0;
  }

  candidates.sort((a, b) => {
    if (a.fits !== b.fits) return a.fits ? -1 : 1;
    return a.overflow - b.overflow;
  });

  const best = candidates[0]!;
  const clamped = clampPos(best.left, best.top, cardW, cardH, bounds);
  return { ...clamped, placement: best.placement };
}

function centerInBounds(
  cardW: number,
  cardH: number,
  bounds: AnchorRect,
): { left: number; top: number; placement: Placement } {
  const clamped = clampPos(
    bounds.left + Math.max(8, (bounds.width - cardW) / 2),
    bounds.top + Math.max(8, (bounds.height - cardH) / 2 - 40),
    cardW,
    cardH,
    bounds,
  );
  return { ...clamped, placement: "center" };
}

export function FloatingReviewCard({
  value,
  anchor,
  bounds,
  onChanged,
  onReviewed,
}: {
  value: ValueDto;
  anchor: AnchorRect | null;
  bounds: AnchorRect | null;
  onChanged: () => void;
  onReviewed: () => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originLeft: number;
    originTop: number;
  } | null>(null);

  const [editing, setEditing] = useState(false);
  const [corrected, setCorrected] = useState(value.value || "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; placement: Placement } | null>(
    null,
  );
  const [manual, setManual] = useState(false);
  const [dragging, setDragging] = useState(false);

  const isGap = !!value.gapReason;

  useEffect(() => {
    setEditing(false);
    setCorrected(value.value || "");
    setNote(value.gapReason || "");
    setManual(false);
  }, [value.id, value.value, value.gapReason]);

  useLayoutEffect(() => {
    if (manual) return;
    if (!bounds || !cardRef.current) {
      setPos(null);
      return;
    }
    const rect = cardRef.current.getBoundingClientRect();
    const cardW = rect.width || 320;
    const cardH = rect.height || 200;
    if (anchor) {
      setPos(pickPlacement(anchor, cardW, cardH, bounds));
    } else {
      setPos(centerInBounds(cardW, cardH, bounds));
    }
  }, [anchor, bounds, value.id, editing, manual]);

  const posRef = useRef(pos);
  posRef.current = pos;

  // Keep a manually placed card inside bounds when the pane resizes.
  useLayoutEffect(() => {
    if (!manual || !posRef.current || !cardRef.current) return;
    const current = posRef.current;
    const rect = cardRef.current.getBoundingClientRect();
    const clamped = clampPos(
      current.left,
      current.top,
      rect.width || 320,
      rect.height || 200,
      bounds,
    );
    if (clamped.left !== current.left || clamped.top !== current.top) {
      setPos({ ...current, ...clamped, placement: "manual" });
    }
  }, [bounds, manual]);

  const onDragPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      if (!pos) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        originLeft: pos.left,
        originTop: pos.top,
      };
      setDragging(true);
      setManual(true);
    },
    [pos],
  );

  const onDragPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const card = cardRef.current;
      const cardW = card?.offsetWidth || 320;
      const cardH = card?.offsetHeight || 200;
      const next = clampPos(
        drag.originLeft + (e.clientX - drag.startX),
        drag.originTop + (e.clientY - drag.startY),
        cardW,
        cardH,
        bounds,
      );
      setPos({ left: next.left, top: next.top, placement: "manual" });
    },
    [bounds],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
  }, []);

  async function approve(gapNote?: string) {
    setBusy(true);
    try {
      await reviewValue(value.id, {
        decision: "approved",
        note: gapNote?.trim() || undefined,
      });
      onChanged();
      onReviewed();
    } finally {
      setBusy(false);
    }
  }

  async function correct() {
    setBusy(true);
    try {
      await reviewValue(value.id, {
        decision: "corrected",
        correctedValue: corrected,
        note: note || undefined,
      });
      setEditing(false);
      onChanged();
      onReviewed();
    } finally {
      setBusy(false);
    }
  }

  async function saveGapEdit() {
    const found = corrected.trim();
    const reason = note.trim();
    if (found) {
      await correct();
      return;
    }
    if (!reason) return;
    setBusy(true);
    try {
      await reviewValue(value.id, {
        decision: "approved",
        note: reason,
      });
      setEditing(false);
      onChanged();
      onReviewed();
    } finally {
      setBusy(false);
    }
  }

  function startEdit() {
    setCorrected(isGap ? "" : value.value || "");
    setNote(isGap ? value.gapReason || "" : "");
    setEditing(true);
  }

  return (
    <div
      ref={cardRef}
      className={cn(
        "pointer-events-auto fixed z-40 w-[min(320px,calc(100vw-24px))] rounded-xl border border-border bg-card shadow-xl",
        pos ? "opacity-100" : "opacity-0",
        dragging ? "cursor-grabbing shadow-2xl" : null,
      )}
      style={
        pos
          ? { left: pos.left, top: pos.top }
          : bounds
            ? { left: bounds.left + 24, top: bounds.top + 24 }
            : { left: 24, top: 24 }
      }
      role="dialog"
      aria-label={`Review ${value.fieldKey}`}
    >
      <div
        className={cn(
          "flex cursor-grab items-center gap-2 rounded-t-xl border-b border-border bg-surface/70 px-3 py-2 select-none active:cursor-grabbing",
          dragging ? "cursor-grabbing" : null,
        )}
        onPointerDown={onDragPointerDown}
        onPointerMove={onDragPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        aria-label="Drag to move review card"
      >
        <span className="flex flex-col gap-0.5 opacity-50" aria-hidden>
          <span className="block h-0.5 w-4 rounded-full bg-foreground" />
          <span className="block h-0.5 w-4 rounded-full bg-foreground" />
          <span className="block h-0.5 w-4 rounded-full bg-foreground" />
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-muted">
          Drag to move · {value.fieldKey}
        </span>
        {manual ? (
          <button
            type="button"
            className="shrink-0 text-[11px] font-semibold text-accent hover:underline"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setManual(false)}
          >
            Reset
          </button>
        ) : null}
      </div>

      <div className="p-4">
        <div>
          <div className="font-display text-lg leading-tight">{value.fieldKey}</div>
          <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
            <span className="rounded bg-surface px-1.5 py-0.5">certainty {value.certainty}%</span>
            {value.needsAttention ? (
              <span className="rounded bg-[#f3e4d1] px-1.5 py-0.5 text-warn">needs attention</span>
            ) : (
              <span className="rounded bg-[#dce8e2] px-1.5 py-0.5 text-ok">high confidence</span>
            )}
            {value.gapReason ? (
              <span className="rounded bg-[#f3d9d9] px-1.5 py-0.5 text-danger">gap</span>
            ) : null}
          </div>
        </div>

        <div className="mt-3">
          <div className="text-xs text-muted">Extracted value</div>
          <div className="mt-0.5 text-base font-semibold">{value.value ?? "—"}</div>
        </div>

        {value.gapReason && !editing ? (
          <p className="mt-2 text-sm text-danger">{value.gapReason}</p>
        ) : null}

        {value.previous ? (
          <div className="mt-2 rounded-md bg-surface/80 p-2 text-xs">
            Previous: {value.previous.effectiveValue ?? "—"}
            {value.previous.review ? ` (${value.previous.review.decision})` : ""}
          </div>
        ) : null}

        {!value.review && !editing ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {isGap ? (
              <Button size="sm" disabled={busy} onClick={() => approve(value.gapReason || undefined)}>
                Confirm accurate
              </Button>
            ) : value.value != null ? (
              <Button size="sm" disabled={busy} onClick={() => approve()}>
                Approve
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" disabled={busy} onClick={startEdit}>
              {isGap ? "Edit reason / value" : "Edit"}
            </Button>
          </div>
        ) : null}

        {value.review ? (
          <div className="mt-3 text-sm text-ok">
            <p>
              {isGap && value.review.decision === "approved"
                ? "Gap confirmed accurate"
                : `Already ${value.review.decision}`}
              {value.review.correctedValue ? `: ${value.review.correctedValue}` : ""}
            </p>
            {value.review.note ? (
              <p className="mt-1 text-xs text-muted">Note: {value.review.note}</p>
            ) : null}
          </div>
        ) : null}

        {editing ? (
          <div className="mt-3 space-y-2">
            {isGap ? (
              <>
                <div>
                  <label className="text-xs text-muted">Gap reason</label>
                  <textarea
                    className="mt-0.5 min-h-[72px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Why this field is missing / not in the document"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-xs text-muted">Or enter a found value</label>
                  <input
                    className="mt-0.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    value={corrected}
                    onChange={(e) => setCorrected(e.target.value)}
                    placeholder="Leave blank to keep as a gap"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy || (!corrected.trim() && !note.trim())}
                    onClick={saveGapEdit}
                  >
                    {corrected.trim() ? "Save value" : "Save reason"}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <>
                <input
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={corrected}
                  onChange={(e) => setCorrected(e.target.value)}
                  placeholder="Corrected value"
                  autoFocus
                />
                <input
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional note"
                />
                <div className="flex gap-2">
                  <Button size="sm" disabled={busy || !corrected.trim()} onClick={correct}>
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
