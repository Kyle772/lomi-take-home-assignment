"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getDocument, type DocumentDto } from "@/lib/api";
import { ReviewWorkspace } from "@/components/review-workspace";

export default function ReviewPage() {
  const params = useParams<{ id: string }>();
  const [doc, setDoc] = useState<DocumentDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getDocument(params.id);
      setDoc(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load document");
    }
  }, [params.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!doc) return;
    const status = doc.currentVersion?.status;
    if (status === "queued" || status === "extracting") {
      const id = setInterval(() => {
        void refresh();
      }, 2000);
      return () => clearInterval(id);
    }
  }, [doc, refresh]);

  if (error) {
    return (
      <div className="flex h-[100dvh] items-center justify-center px-4">
        <p className="text-danger">{error}</p>
      </div>
    );
  }
  if (!doc) {
    return (
      <div className="flex h-[100dvh] items-center justify-center px-4">
        <p className="text-muted">Loading…</p>
      </div>
    );
  }

  return <ReviewWorkspace initial={doc} onRefresh={refresh} />;
}
