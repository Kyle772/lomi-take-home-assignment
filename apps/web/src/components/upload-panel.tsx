"use client";

import { useEffect, useRef, useState } from "react";
import { listDocumentTypes, uploadDocuments, type DocumentTypeDto } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function UploadPanel({
  onUploaded,
  refreshKey,
  batchId,
}: {
  onUploaded: () => void;
  refreshKey?: number;
  batchId?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [types, setTypes] = useState<DocumentTypeDto[]>([]);
  const [typeId, setTypeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    void listDocumentTypes()
      .then((data) => {
        setTypes(data.documentTypes);
        setTypeId((prev) => prev || data.documentTypes[0]?.id || "");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load types");
      });
  }, [refreshKey]);

  async function onFiles(files: FileList | File[] | null) {
    if (!files || (Array.isArray(files) ? files.length === 0 : files.length === 0)) {
      return;
    }
    if (!typeId) {
      setError("Select a document type first");
      return;
    }
    const list = Array.from(files).filter(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
    );
    if (list.length === 0) {
      setError("Only PDF files are accepted");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await uploadDocuments(list, typeId, batchId);
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const selected = types.find((t) => t.id === typeId);
  const disabled = busy || !typeId;

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <h2 className="font-display text-2xl">Upload</h2>
      <p className="mt-1 text-sm text-muted">
        Choose a type, then drop PDFs here or pick files. They are added to the selected batch.
      </p>
      <div className="mt-4">
        <label className="text-sm font-medium">
          Type
          <select
            className="ml-2 rounded-md border border-border bg-background px-2 py-1.5"
            value={typeId}
            onChange={(e) => setTypeId(e.target.value)}
            disabled={!types.length}
          >
            {types.length === 0 ? <option value="">No types</option> : null}
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div
        role="button"
        tabIndex={0}
        aria-disabled={disabled}
        className={cn(
          "mt-4 flex min-h-[9.5rem] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors",
          dragging
            ? "border-accent bg-accent/10"
            : "border-border bg-background/60 hover:border-accent/50 hover:bg-background",
          disabled && "cursor-not-allowed opacity-60",
        )}
        onClick={() => {
          if (!disabled) inputRef.current?.click();
        }}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !disabled) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!disabled) setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(false);
          if (disabled) return;
          void onFiles(e.dataTransfer.files);
        }}
      >
        <p className="text-sm font-medium">
          {busy ? "Uploading…" : dragging ? "Drop PDFs to upload" : "Drag & drop PDFs here"}
        </p>
        <p className="mt-1 text-xs text-muted">or click to browse — multiple files OK</p>
        <Button
          type="button"
          size="sm"
          className="mt-3"
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            inputRef.current?.click();
          }}
        >
          {busy ? "Uploading…" : "Choose PDFs"}
        </Button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        disabled={disabled}
        onChange={(e) => onFiles(e.target.files)}
      />

      {selected ? (
        <p className="mt-2 text-xs text-muted">
          Extracts: {selected.fields.map((f) => f.fieldKey).join(", ") || "—"}
        </p>
      ) : null}
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
    </section>
  );
}
