/**
 * Browser: same-origin `/api` (Vercel rewrite) unless NEXT_PUBLIC_API_URL is set.
 * Server: prefer service binding `API_URL`, then NEXT_PUBLIC, then `/api`.
 */
function resolveApiBase(): string {
  const fromBinding = process.env.API_URL?.replace(/\/$/, "");
  const fromPublic = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
  if (typeof window === "undefined" && fromBinding) return fromBinding;
  return fromPublic || "/api";
}

const API_URL = resolveApiBase();

export type ReviewInfo = {
  decision: "approved" | "corrected";
  correctedValue: string | null;
  note: string | null;
};

export type FormatRuleDto = {
  id: string;
  name: string;
  kind:
    | "ensure_prefix"
    | "ensure_suffix"
    | "ensure_decimals"
    | "regex_replace"
    | "date_format";
  skipIfMatch?: string;
  onlyIfMatch?: string;
  value?: string;
  pattern?: string;
  decimals?: number;
  dateOutput?: "ISO" | "MM-DD-YYYY" | "DD-MM-YYYY" | "YYYY-MM-DD";
};

export type ValueDto = {
  id: string;
  fieldKey: string;
  value: string | null;
  evidence: string | null;
  gapReason: string | null;
  certainty: number;
  carriedOver: boolean;
  source: "extracted" | "manual";
  adHoc: boolean;
  needsAttention: boolean;
  effectiveValue: string | null;
  /** Export/cleaned formatting applied; review UI should prefer effectiveValue. */
  formattedValue: string | null;
  review: ReviewInfo | null;
  previous: {
    id: string;
    value: string | null;
    evidence: string | null;
    effectiveValue: string | null;
    review: ReviewInfo | null;
  } | null;
};

export type ProgressDto = {
  pending: number;
  approved: number;
  corrected: number;
  carriedOver: number;
  lowCertaintyPending: number;
};

export type DocumentTypeFieldDto = {
  id: string;
  fieldKey: string;
  fieldType: string;
  formatRules: FormatRuleDto[];
  sortOrder: number;
};

export type DocumentTypeDto = {
  id: string;
  key: string;
  label: string;
  fields: DocumentTypeFieldDto[];
};

export type BatchDto = {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  pending: number;
  completed: number;
  total: number;
};

export type DuplicateBatchDto = {
  batchId: string;
  batchName: string;
  documentId: string;
  documentTitle: string;
};

export type DocumentDto = {
  id: string;
  type: string;
  batchId: string;
  documentTypeId: string;
  documentType: { id: string; key: string; label: string } | null;
  title: string;
  createdAt: string;
  currentVersion: {
    id: string;
    versionNumber: number;
    status: "queued" | "extracting" | "extracted" | "failed";
    failureReason: string | null;
    parsedText: string | null;
    contentHash: string | null;
    extractedSchemaAt: string | null;
    createdAt: string;
  } | null;
  values: ValueDto[];
  progress: ProgressDto;
  reviewComplete: boolean;
  schemaStale: boolean;
  duplicateBatches: DuplicateBatchDto[];
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function listBatches() {
  return request<{ batches: BatchDto[] }>("/batches");
}

export function createBatch(name?: string) {
  return request<BatchDto>("/batches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export function activateBatch(id: string) {
  return request<BatchDto>(`/batches/${id}/activate`, { method: "POST" });
}

export function reprocessBatch(id: string) {
  return request<{ batchId: string; enqueued: number }>(`/batches/${id}/reprocess`, {
    method: "POST",
  });
}

export function batchExportCsvUrl(batchId: string, documentTypeId: string) {
  return `${API_URL}/batches/${batchId}/export.csv?documentTypeId=${encodeURIComponent(documentTypeId)}`;
}

export function listDocuments(batchId?: string) {
  const q = batchId ? `?batchId=${encodeURIComponent(batchId)}` : "";
  return request<{ documents: DocumentDto[]; batchId: string }>(`/documents${q}`);
}

export function getDocument(id: string) {
  return request<DocumentDto>(`/documents/${id}`);
}

export function documentPdfUrl(documentId: string) {
  return `${API_URL}/documents/${documentId}/file`;
}

export function getNextReview(after?: string, batchId?: string) {
  const params = new URLSearchParams();
  if (after) params.set("after", after);
  if (batchId) params.set("batchId", batchId);
  const q = params.toString() ? `?${params}` : "";
  return request<{ document: DocumentDto | null }>(`/review/next${q}`);
}

export function listDocumentTypes() {
  return request<{ documentTypes: DocumentTypeDto[] }>("/document-types");
}

export function createDocumentType(body: {
  label: string;
  key?: string;
  fields: Array<{ fieldKey: string; fieldType?: string; formatRules?: FormatRuleDto[] }>;
}) {
  return request<DocumentTypeDto>("/document-types", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function updateDocumentType(
  id: string,
  body: {
    label?: string;
    fields?: Array<{ fieldKey: string; fieldType?: string; formatRules?: FormatRuleDto[] }>;
  },
) {
  return request<DocumentTypeDto>(`/document-types/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function previewFormatRules(value: string, rules: FormatRuleDto[]) {
  return request<{
    input: string;
    output: string;
    steps: Array<{
      ruleId: string;
      name: string;
      skipped: boolean;
      reason?: string;
      output: string;
    }>;
  }>("/format/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value, rules }),
  });
}

export async function uploadDocuments(
  files: File[],
  documentTypeId: string,
  batchId?: string,
): Promise<DocumentDto | { documents: DocumentDto[] }> {
  const form = new FormData();
  for (const file of files) {
    form.append("files", file);
  }
  form.append("documentTypeId", documentTypeId);
  if (batchId) form.append("batchId", batchId);
  return request("/documents", { method: "POST", body: form });
}

export async function uploadDocument(file: File, type: string, title?: string) {
  const form = new FormData();
  form.append("file", file);
  form.append("type", type);
  if (title) form.append("title", title);
  return request<DocumentDto>("/documents", { method: "POST", body: form });
}

export async function uploadVersion(documentId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return request<DocumentDto>(`/documents/${documentId}/versions`, {
    method: "POST",
    body: form,
  });
}

export function reclassifyDocument(documentId: string, documentTypeId: string) {
  return request<DocumentDto>(`/documents/${documentId}/reclassify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documentTypeId }),
  });
}

export function rescanDocument(documentId: string) {
  return request<DocumentDto>(`/documents/${documentId}/rescan`, {
    method: "POST",
  });
}

export function addManualValue(
  documentId: string,
  body: {
    fieldKey: string;
    value: string;
    saveToType?: boolean;
    note?: string;
    fieldType?: string;
  },
) {
  return request<DocumentDto>(`/documents/${documentId}/values`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function reviewValue(
  valueId: string,
  body: { decision: "approved" | "corrected"; correctedValue?: string; note?: string },
) {
  return request(`/values/${valueId}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function approveHighConfidence(documentId: string) {
  return request<DocumentDto>(`/documents/${documentId}/reviews/approve-high-confidence`, {
    method: "POST",
  });
}

export function retryDocument(documentId: string) {
  return request<DocumentDto>(`/documents/${documentId}/retry`, { method: "POST" });
}
