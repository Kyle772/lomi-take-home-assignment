"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import {
  documentPdfUrl,
  listDocumentTypes,
  reclassifyDocument,
  rescanDocument,
  type DocumentDto,
  type DocumentTypeDto,
  type DuplicateBatchDto,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

function statusColor(status: string) {
  switch (status) {
    case "extracted":
      return "text-ok";
    case "failed":
      return "text-danger";
    case "extracting":
    case "queued":
      return "text-warn";
    default:
      return "text-muted";
  }
}

type QueueTab = "pending" | "completed";

export function DocumentQueues({
  pending,
  completed,
  pendingFooter,
  onChanged,
}: {
  pending: DocumentDto[];
  completed: DocumentDto[];
  pendingFooter?: ReactNode;
  onChanged?: () => void;
}) {
  const [tab, setTab] = useState<QueueTab>("pending");
  const documents = tab === "pending" ? pending : completed;

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-display text-2xl">Queue</h2>
        <div
          role="tablist"
          aria-label="Document queue"
          className="flex rounded-lg border border-border bg-background p-0.5"
        >
          <TabButton
            active={tab === "pending"}
            onClick={() => setTab("pending")}
            label={`Pending (${pending.length})`}
          />
          <TabButton
            active={tab === "completed"}
            onClick={() => setTab("completed")}
            label={`Completed (${completed.length})`}
          />
        </div>
      </div>

      <QueueList
        documents={documents}
        emptyLabel={
          tab === "pending"
            ? "No pending documents in this batch."
            : "No completed documents yet."
        }
        showOutput={tab === "completed"}
        onChanged={onChanged}
        onMovedToPending={() => setTab("pending")}
      />

      {tab === "pending" && pendingFooter ? (
        <div className="mt-4 border-t border-border pt-4">{pendingFooter}</div>
      ) : null}
    </section>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-card text-foreground shadow-sm"
          : "text-muted hover:text-foreground",
      )}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function QueueList({
  documents,
  emptyLabel,
  showOutput,
  onChanged,
  onMovedToPending,
}: {
  documents: DocumentDto[];
  emptyLabel: string;
  showOutput?: boolean;
  onChanged?: () => void;
  onMovedToPending?: () => void;
}) {
  const [types, setTypes] = useState<DocumentTypeDto[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [duplicateModal, setDuplicateModal] = useState<{
    title: string;
    batches: DuplicateBatchDto[];
  } | null>(null);

  useEffect(() => {
    void listDocumentTypes().then((d) => setTypes(d.documentTypes));
  }, []);

  async function onRescan(id: string) {
    setBusyId(id);
    try {
      await rescanDocument(id);
      onMovedToPending?.();
      onChanged?.();
    } finally {
      setBusyId(null);
    }
  }

  async function onReclassify(id: string, documentTypeId: string) {
    if (!documentTypeId) return;
    setBusyId(id);
    try {
      await reclassifyDocument(id, documentTypeId);
      onMovedToPending?.();
      onChanged?.();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
    <ul className="mt-4 divide-y divide-border">
      {documents.map((doc) => {
        const status = doc.currentVersion?.status || "queued";
        const typeLabel = doc.documentType?.label || doc.type;
        const isOpen = !!expanded[doc.id];
        const duplicates = doc.duplicateBatches || [];
        return (
          <li key={doc.id} className="py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <Link
                    href={`/review/${doc.id}`}
                    className="font-medium transition-colors hover:text-accent"
                  >
                    {doc.title}
                  </Link>
                  {duplicates.length > 0 ? (
                    <button
                      type="button"
                      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#f3e4d1] text-[10px] font-bold leading-none text-warn hover:ring-2 hover:ring-warn/40"
                      title="Same PDF exists in another batch — click for details"
                      aria-label="Duplicate PDF warning"
                      onClick={() =>
                        setDuplicateModal({ title: doc.title, batches: duplicates })
                      }
                    >
                      ⧉
                    </button>
                  ) : null}
                  {doc.schemaStale ? (
                    <span
                      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#f3e4d1] text-[11px] font-bold text-warn"
                      title="Parsed with an older document-type schema. Rescan to apply the updated fields."
                      aria-label="Stale schema warning"
                    >
                      !
                    </span>
                  ) : null}
                </div>
                <Link
                  href={`/review/${doc.id}`}
                  className="text-xs text-muted transition-colors hover:text-accent"
                >
                  {typeLabel} · v{doc.currentVersion?.versionNumber ?? "—"}
                  {doc.schemaStale ? " · schema outdated" : ""}
                  {duplicates.length > 0
                    ? ` · duplicate in ${duplicates.length} other batch${duplicates.length === 1 ? "" : "es"}`
                    : ""}
                </Link>
              </div>
              <div className="text-right text-xs">
                <div className={cn("font-semibold uppercase tracking-wide", statusColor(status))}>
                  {status}
                </div>
                <div className="text-muted">
                  {doc.progress.pending} pending · {doc.progress.approved + doc.progress.corrected}{" "}
                  reviewed
                </div>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                defaultValue=""
                disabled={busyId === doc.id || types.length === 0}
                onChange={(e) => {
                  const v = e.target.value;
                  e.target.value = "";
                  if (v) void onReclassify(doc.id, v);
                }}
              >
                <option value="">Change type & rescan…</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id} disabled={t.id === doc.documentTypeId}>
                    {t.label}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="whitespace-nowrap"
                disabled={busyId === doc.id}
                onClick={() => void onRescan(doc.id)}
              >
                Rescan
              </Button>
              {showOutput ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="whitespace-nowrap"
                  onClick={() =>
                    setExpanded((prev) => ({ ...prev, [doc.id]: !prev[doc.id] }))
                  }
                >
                  {isOpen ? "Hide output" : "Show output"}
                </Button>
              ) : null}
            </div>
            {showOutput && isOpen ? (
              <div className="mt-3 rounded-lg border border-border bg-background/70 p-3">
                <dl className="grid gap-2 sm:grid-cols-2">
                  {doc.values.map((v) => (
                    <div key={v.id}>
                      <dt className="text-[11px] uppercase tracking-wide text-muted">
                        {v.fieldKey}
                        {v.adHoc ? " · one-off" : ""}
                      </dt>
                      <dd className="text-sm font-medium">
                        {v.formattedValue ?? v.effectiveValue ?? "—"}
                      </dd>
                    </div>
                  ))}
                </dl>
                <a
                  href={documentPdfUrl(doc.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-block text-xs font-semibold text-accent hover:underline"
                >
                  Open PDF
                </a>
              </div>
            ) : null}
          </li>
        );
      })}
      {documents.length === 0 ? (
        <li className="py-6 text-sm text-muted">{emptyLabel}</li>
      ) : null}
    </ul>

    <Modal
      open={!!duplicateModal}
      title="Duplicate PDF"
      onClose={() => setDuplicateModal(null)}
    >
      {duplicateModal ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            <span className="font-medium text-foreground">{duplicateModal.title}</span> matches a
            PDF that already exists in{" "}
            {duplicateModal.batches.length === 1
              ? "another batch"
              : `${duplicateModal.batches.length} other batches`}
            :
          </p>
          <ul className="space-y-2">
            {duplicateModal.batches.map((b) => (
              <li
                key={`${b.batchId}-${b.documentId}`}
                className="rounded-lg border border-border bg-background/60 px-3 py-2"
              >
                <div className="font-medium">{b.batchName}</div>
                <div className="text-xs text-muted">{b.documentTitle}</div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Modal>
    </>
  );
}
