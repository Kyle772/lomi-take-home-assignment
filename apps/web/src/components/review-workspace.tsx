"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addManualValue,
  approveHighConfidence,
  documentPdfUrl,
  getNextReview,
  listDocumentTypes,
  reclassifyDocument,
  rescanDocument,
  retryDocument,
  uploadVersion,
  type DocumentDto,
  type DocumentTypeDto,
  type ValueDto,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { DocumentSourcePreview } from "@/components/document-source-preview";
import {
  FloatingReviewCard,
  type AnchorRect,
} from "@/components/floating-review-card";
import { ReviewActionBar } from "@/components/review-action-bar";
import { cn } from "@/lib/utils";

function buildReviewQueue(values: ValueDto[]): ValueDto[] {
  const pending = values.filter((v) => !v.review);
  const needsAttention = pending.filter((v) => v.needsAttention || v.gapReason);
  const high = pending.filter((v) => !v.needsAttention && !v.gapReason);
  return [...needsAttention, ...high];
}

export function ReviewWorkspace({
  initial,
  onRefresh,
}: {
  initial: DocumentDto;
  onRefresh: () => Promise<void> | void;
}) {
  const router = useRouter();
  const versionInputRef = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const pdfPaneRef = useRef<HTMLDivElement | null>(null);

  const [busy, setBusy] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const [bounds, setBounds] = useState<AnchorRect | null>(null);
  const [types, setTypes] = useState<DocumentTypeDto[]>([]);
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [saveToType, setSaveToType] = useState(false);

  const doc = initial;
  const status = doc.currentVersion?.status;
  const pdfUrl = documentPdfUrl(doc.id);
  const typeLabel = doc.documentType?.label || doc.type;

  const queue = useMemo(() => buildReviewQueue(doc.values), [doc.values]);
  const highConfidence = useMemo(
    () =>
      doc.values.filter(
        (v) => !v.review && !v.needsAttention && !v.gapReason && v.value != null,
      ),
    [doc.values],
  );

  const active = queue[activeIndex] || null;

  useEffect(() => {
    void listDocumentTypes().then((d) => setTypes(d.documentTypes));
  }, []);

  useEffect(() => {
    if (queue.length === 0) {
      setActiveIndex(0);
      return;
    }
    setActiveIndex((i) => Math.min(i, queue.length - 1));
  }, [queue]);

  useEffect(() => {
    setAnchor(null);
  }, [active?.id]);

  const updateBounds = useCallback(() => {
    const el = pdfPaneRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setBounds({
      left: r.left,
      top: r.top,
      width: r.width,
      height: Math.max(120, r.height - 88),
    });
  }, []);

  useEffect(() => {
    updateBounds();
    window.addEventListener("resize", updateBounds);
    return () => window.removeEventListener("resize", updateBounds);
  }, [updateBounds]);

  useEffect(() => {
    updateBounds();
  }, [active?.id, updateBounds]);

  async function onApproveHigh() {
    setBusy(true);
    try {
      await approveHighConfidence(doc.id);
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function onNextDoc() {
    const { document: next } = await getNextReview(doc.id);
    if (next) router.push(`/review/${next.id}`);
    else router.push("/");
  }

  async function onRetry() {
    setBusy(true);
    try {
      await retryDocument(doc.id);
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function onVersion(file: File | null) {
    if (!file) return;
    setBusy(true);
    try {
      await uploadVersion(doc.id, file);
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function onReclassify(documentTypeId: string) {
    if (!documentTypeId || documentTypeId === doc.documentTypeId) return;
    setBusy(true);
    try {
      await reclassifyDocument(doc.id, documentTypeId);
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function onRescan() {
    setBusy(true);
    try {
      await rescanDocument(doc.id);
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function onAddValue() {
    const fieldKey = newKey.trim();
    const value = newValue.trim();
    if (!fieldKey || !value) return;
    setBusy(true);
    try {
      await addManualValue(doc.id, {
        fieldKey,
        value,
        saveToType,
      });
      setAdding(false);
      setNewKey("");
      setNewValue("");
      setSaveToType(false);
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  const goPrev = useCallback(() => {
    setActiveIndex((i) => Math.max(0, i - 1));
  }, []);

  const goNext = useCallback(() => {
    setActiveIndex((i) => Math.min(queue.length - 1, i + 1));
  }, [queue.length]);

  function afterReviewed() {
    setActiveIndex((i) => i);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPrev, goNext]);

  if (status === "queued" || status === "extracting") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <section className="rounded-xl border border-border bg-card p-6">
          <h1 className="font-display text-3xl">{doc.title}</h1>
          <p className="mt-1 text-sm text-muted">{typeLabel}</p>
          <p className="mt-2 text-muted">Extraction in progress ({status})…</p>
        </section>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <section className="rounded-xl border border-border bg-card p-6">
          <h1 className="font-display text-3xl">{doc.title}</h1>
          <p className="mt-2 text-danger">
            Extraction failed: {doc.currentVersion?.failureReason || "unknown error"}
          </p>
          <Button className="mt-4" disabled={busy} onClick={onRetry}>
            Retry
          </Button>
        </section>
      </div>
    );
  }

  if (doc.reviewComplete) {
    return (
      <div className="mx-auto max-w-4xl overflow-y-auto px-4 py-10" style={{ maxHeight: "100dvh" }}>
        <section className="rounded-xl border border-border bg-card p-6">
          <h1 className="font-display text-3xl">{doc.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {typeLabel} · Version {doc.currentVersion?.versionNumber} · all values reviewed
          </p>
          <h2 className="mt-6 font-display text-2xl">Cleaned output</h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            {doc.values.map((v) => (
              <div key={v.id} className="rounded-md border border-border bg-background/60 p-3">
                <dt className="text-xs uppercase tracking-wide text-muted">
                  {v.fieldKey}
                  {v.adHoc ? " · one-off" : ""}
                </dt>
                <dd className="mt-1 font-medium">{v.effectiveValue ?? "—"}</dd>
                {v.review?.decision === "corrected" ? (
                  <dd className="text-xs text-warn">corrected from {v.value ?? "—"}</dd>
                ) : null}
              </div>
            ))}
          </dl>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button onClick={onNextDoc}>Next in queue</Button>
            <Button variant="secondary" onClick={() => router.push("/")}>
              Upload another
            </Button>
            <input
              ref={versionInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              disabled={busy}
              onChange={(e) => onVersion(e.target.files?.[0] || null)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => versionInputRef.current?.click()}
            >
              Upload new version
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={onRescan}>
              Rescan
            </Button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div ref={shellRef} className="relative flex h-[100dvh] min-h-0 w-full overflow-hidden bg-background">
      <div ref={pdfPaneRef} className="hidden h-full min-h-0 w-[70%] shrink-0 lg:block">
        <DocumentSourcePreview
          pdfUrl={pdfUrl}
          activeEvidence={active?.evidence || null}
          activeFieldKey={active?.fieldKey || null}
          onAnchorChange={setAnchor}
        />
      </div>

      <div className="flex min-h-0 min-w-0 w-full flex-col overflow-hidden lg:w-[30%]">
        <header className="shrink-0 border-b border-border bg-card/95 px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
                Lomi Labs
              </p>
              <h1 className="font-display truncate text-xl">{doc.title}</h1>
              <p className="mt-1 text-xs text-muted">
                {typeLabel} · v{doc.currentVersion?.versionNumber} · {doc.progress.pending} pending
              </p>
            </div>
            <Link href="/" className="shrink-0 text-sm font-semibold text-accent hover:underline">
              Queue
            </Link>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <select
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
              value={doc.documentTypeId}
              disabled={busy || types.length === 0}
              onChange={(e) => void onReclassify(e.target.value)}
            >
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onRescan}>
              Rescan
            </Button>
            <input
              ref={versionInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              disabled={busy}
              onChange={(e) => onVersion(e.target.files?.[0] || null)}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => versionInputRef.current?.click()}
            >
              New version
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => setAdding((v) => !v)}
            >
              {adding ? "Cancel add" : "Add value"}
            </Button>
          </div>
          {adding ? (
            <div className="mt-3 space-y-2 rounded-lg border border-border bg-background/80 p-3">
              <input
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="field_key"
              />
              <input
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="Value"
              />
              <label className="flex items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={saveToType}
                  onChange={(e) => setSaveToType(e.target.checked)}
                />
                Also add this key to the {typeLabel} type
              </label>
              <Button
                type="button"
                size="sm"
                disabled={busy || !newKey.trim() || !newValue.trim()}
                onClick={onAddValue}
              >
                Save value
              </Button>
            </div>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-28">
          <p className="mb-2 text-xs text-muted">
            Use ← → in the bar below, or jump to a field here.
          </p>
          <ul className="space-y-1.5">
            {queue.map((v, i) => (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => setActiveIndex(i)}
                  className={cn(
                    "w-full rounded-lg border px-3 py-2 text-left transition-colors",
                    i === activeIndex
                      ? "border-accent bg-accent/10"
                      : "border-border bg-background/70 hover:bg-surface/80",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">
                      {v.fieldKey}
                      {v.adHoc ? " · one-off" : ""}
                    </span>
                    <span className="text-[11px] text-muted">{v.certainty}%</span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted">{v.value ?? "—"}</div>
                </button>
              </li>
            ))}
            {queue.length === 0 ? (
              <li className="rounded-lg border border-border p-3 text-sm text-muted">
                Nothing left to review.
              </li>
            ) : null}
          </ul>
        </div>
      </div>

      {active ? (
        <FloatingReviewCard
          value={active}
          anchor={anchor}
          bounds={bounds}
          onChanged={onRefresh}
          onReviewed={afterReviewed}
        />
      ) : null}

      <ReviewActionBar
        index={activeIndex}
        total={queue.length}
        fieldKey={active?.fieldKey || null}
        canPrev={activeIndex > 0}
        canNext={activeIndex < queue.length - 1}
        onPrev={goPrev}
        onNext={goNext}
        onApproveHigh={onApproveHigh}
        highCount={highConfidence.length}
        busy={busy}
      />
    </div>
  );
}
