"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  activateBatch,
  batchExportCsvUrl,
  createBatch,
  getNextReview,
  listBatches,
  listDocuments,
  reprocessBatch,
  type BatchDto,
  type DocumentDto,
} from "@/lib/api";
import { BatchBar } from "@/components/batch-bar";
import { DocumentQueues } from "@/components/document-queue";
import { DocumentTypesPanel } from "@/components/document-types-panel";
import { UploadPanel } from "@/components/upload-panel";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  const [batches, setBatches] = useState<BatchDto[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [documents, setDocuments] = useState<DocumentDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [typesRefresh, setTypesRefresh] = useState(0);
  const [busy, setBusy] = useState(false);

  const refreshBatches = useCallback(async () => {
    const data = await listBatches();
    setBatches(data.batches);
    setSelectedBatchId((prev) => {
      if (prev && data.batches.some((b) => b.id === prev)) return prev;
      return data.batches.find((b) => b.active)?.id || data.batches[0]?.id || "";
    });
  }, []);

  const refreshDocs = useCallback(async (batchId: string) => {
    if (!batchId) {
      setDocuments([]);
      return;
    }
    const data = await listDocuments(batchId);
    setDocuments(data.documents);
  }, []);

  const refresh = useCallback(async () => {
    try {
      await refreshBatches();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load batches");
    }
  }, [refreshBatches]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedBatchId) return;
    void refreshDocs(selectedBatchId).catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to load documents");
    });
    const id = setInterval(() => {
      void refreshDocs(selectedBatchId);
      void refreshBatches();
    }, 2000);
    return () => clearInterval(id);
  }, [selectedBatchId, refreshDocs, refreshBatches]);

  const pending = useMemo(
    () => documents.filter((d) => !d.reviewComplete),
    [documents],
  );
  const completed = useMemo(
    () => documents.filter((d) => d.reviewComplete),
    [documents],
  );

  const extracting = documents.some(
    (d) =>
      d.currentVersion?.status === "queued" || d.currentVersion?.status === "extracting",
  );

  async function startReview() {
    const { document } = await getNextReview(undefined, selectedBatchId || undefined);
    if (document) {
      window.location.href = `/review/${document.id}`;
    }
  }

  async function onSelectBatch(batchId: string) {
    if (!batchId || batchId === selectedBatchId) return;
    setSelectedBatchId(batchId);
    setBusy(true);
    try {
      await activateBatch(batchId);
      await refreshBatches();
      setSelectedBatchId(batchId);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to select batch");
    } finally {
      setBusy(false);
    }
  }

  async function onStartNewBatch() {
    setBusy(true);
    try {
      const created = await createBatch();
      await refreshBatches();
      setSelectedBatchId(created.id);
      setDocuments([]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create batch");
    } finally {
      setBusy(false);
    }
  }

  async function onReprocess() {
    if (!selectedBatchId) return;
    setBusy(true);
    try {
      await reprocessBatch(selectedBatchId);
      await refreshDocs(selectedBatchId);
      await refreshBatches();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reprocess batch");
    } finally {
      setBusy(false);
    }
  }

  async function onExport() {
    if (!selectedBatchId) return;
    const typeIds = [
      ...new Set(
        documents
          .filter((d) => d.currentVersion?.status === "extracted")
          .map((d) => d.documentTypeId),
      ),
    ];
    if (typeIds.length === 0) {
      setError("No extracted documents to export in this batch");
      return;
    }
    for (const typeId of typeIds) {
      const a = document.createElement("a");
      a.href = batchExportCsvUrl(selectedBatchId, typeId);
      a.download = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  function refreshQueues() {
    void refreshDocs(selectedBatchId);
    void refreshBatches();
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
            Lomi Labs
          </p>
          <h1 className="font-display text-4xl md:text-5xl">Document review</h1>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <div className="space-y-6">
          <UploadPanel
            batchId={selectedBatchId}
            onUploaded={async () => {
              try {
                await refreshBatches();
                if (selectedBatchId) await refreshDocs(selectedBatchId);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to refresh after upload");
              }
            }}
            refreshKey={typesRefresh}
          />
          <DocumentTypesPanel
            onChanged={() => {
              setTypesRefresh((n) => n + 1);
              void refresh();
              if (selectedBatchId) void refreshDocs(selectedBatchId);
            }}
          />
        </div>

        <div className="space-y-4">
          <BatchBar
            batches={batches}
            selectedBatchId={selectedBatchId}
            busy={busy}
            onSelect={onSelectBatch}
            onStartNew={onStartNewBatch}
            onReprocess={onReprocess}
            onExport={onExport}
          />
          {error ? <p className="text-sm text-danger">{error}</p> : null}

          <DocumentQueues
            pending={pending}
            completed={completed}
            onChanged={refreshQueues}
            pendingFooter={
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={startReview} className="whitespace-nowrap">
                  Start / continue review
                </Button>
                {extracting ? (
                  <span className="text-sm text-warn">Extractions running…</span>
                ) : null}
                <span className="text-xs text-muted">
                  Reviews the next pending document in this batch.
                </span>
              </div>
            }
          />
        </div>
      </div>

      <p className="mt-6 text-xs text-muted">
        Tip: seeded fixtures appear in Batch 1 after compose boot.{" "}
        <Link className="text-accent underline" href="/review/doc-invoice-001">
          Open seeded invoice
        </Link>
      </p>
    </div>
  );
}
