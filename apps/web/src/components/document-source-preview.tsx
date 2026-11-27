"use client";

import dynamic from "next/dynamic";
import type { PdfAnchorRect } from "@/components/pdf-preview";

const PdfPreview = dynamic(
  () => import("@/components/pdf-preview").then((m) => m.PdfPreview),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center bg-surface text-sm text-muted">
        Loading PDF preview…
      </div>
    ),
  },
);

export function DocumentSourcePreview({
  pdfUrl,
  activeEvidence,
  activeFieldKey,
  onAnchorChange,
}: {
  pdfUrl: string;
  parsedText?: string | null;
  activeEvidence: string | null;
  activeFieldKey: string | null;
  onAnchorChange?: (anchor: PdfAnchorRect | null) => void;
}) {
  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-border bg-card">
      <PdfPreview
        pdfUrl={pdfUrl}
        evidence={activeEvidence}
        fieldKey={activeFieldKey}
        onAnchorChange={onAnchorChange}
      />
    </aside>
  );
}
