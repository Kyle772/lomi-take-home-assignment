"use client";

import { useState } from "react";
import type { ValueDto } from "@/lib/api";
import { reviewValue } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ReviewField({
  value,
  active,
  onHover,
  onChanged,
}: {
  value: ValueDto;
  active: boolean;
  onHover: (value: ValueDto | null) => void;
  onChanged: () => void;
}) {
  const isGap = !!value.gapReason;
  const [editing, setEditing] = useState(false);
  const [corrected, setCorrected] = useState(value.value || "");
  const [note, setNote] = useState(value.gapReason || "");
  const [busy, setBusy] = useState(false);

  async function approve(gapNote?: string) {
    setBusy(true);
    try {
      await reviewValue(value.id, {
        decision: "approved",
        note: gapNote?.trim() || undefined,
      });
      onChanged();
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
      await reviewValue(value.id, { decision: "approved", note: reason });
      setEditing(false);
      onChanged();
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
    <article
      className={cn(
        "rounded-lg border bg-background/70 p-4 transition-colors",
        active ? "border-accent ring-2 ring-accent/30" : "border-border",
      )}
      onMouseEnter={() => onHover(value)}
      onFocusCapture={() => onHover(value)}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-xl">{value.fieldKey}</h3>
          <div className="mt-1 flex flex-wrap gap-2 text-xs">
            <span className="rounded bg-surface px-2 py-0.5">certainty {value.certainty}%</span>
            {value.carriedOver ? (
              <span className="rounded bg-[#d9efe3] px-2 py-0.5 text-ok">carried over</span>
            ) : null}
            {value.gapReason ? (
              <span className="rounded bg-[#f3d9d9] px-2 py-0.5 text-danger">gap</span>
            ) : null}
            {value.review ? (
              <span className="rounded bg-[#dce8e2] px-2 py-0.5 text-ok">{value.review.decision}</span>
            ) : (
              <span className="rounded bg-[#f3e4d1] px-2 py-0.5 text-warn">pending</span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm text-muted">Extracted</div>
          <div className="font-medium">{value.value ?? "—"}</div>
        </div>
      </div>

      {value.gapReason && !editing ? (
        <p className="mt-3 text-sm text-danger">Gap: {value.gapReason}</p>
      ) : null}

      {value.evidence ? (
        <blockquote className="mt-3 border-l-2 border-accent pl-3 text-sm text-muted">
          {value.evidence}
        </blockquote>
      ) : null}

      {value.previous ? (
        <div className="mt-3 rounded-md bg-surface/70 p-3 text-sm">
          <div className="font-medium">Previous version</div>
          <div>
            {value.previous.effectiveValue ?? "—"}
            {value.previous.review ? ` (${value.previous.review.decision})` : " (no review)"}
          </div>
        </div>
      ) : null}

      {!value.review ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {isGap ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => approve(value.gapReason || undefined)}
            >
              Confirm accurate
            </Button>
          ) : value.value != null ? (
            <Button size="sm" disabled={busy} onClick={() => approve()}>
              Approve
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => (editing ? setEditing(false) : startEdit())}
          >
            {editing ? "Cancel edit" : isGap ? "Edit reason / value" : "Edit"}
          </Button>
        </div>
      ) : null}

      {value.review?.note ? (
        <p className="mt-2 text-xs text-muted">Note: {value.review.note}</p>
      ) : null}

      {editing ? (
        <div className="mt-3 space-y-2">
          {isGap ? (
            <>
              <textarea
                className="min-h-[72px] w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Gap reason"
              />
              <input
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
                value={corrected}
                onChange={(e) => setCorrected(e.target.value)}
                placeholder="Or enter a found value"
              />
              <Button
                size="sm"
                disabled={busy || (!corrected.trim() && !note.trim())}
                onClick={saveGapEdit}
              >
                {corrected.trim() ? "Save value" : "Save reason"}
              </Button>
            </>
          ) : (
            <>
              <input
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
                value={corrected}
                onChange={(e) => setCorrected(e.target.value)}
                placeholder="Corrected value"
              />
              <input
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note"
              />
              <Button size="sm" disabled={busy || !corrected.trim()} onClick={correct}>
                Save correction
              </Button>
            </>
          )}
        </div>
      ) : null}
    </article>
  );
}
