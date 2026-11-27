import type {
  Document,
  DocumentType,
  DocumentTypeField,
  DocumentVersion,
  ExtractedValue,
  Review,
} from "@lomi/db";
import {
  applyFormatRules,
  CERTAINTY_THRESHOLD,
  type FormatRule,
} from "@lomi/shared";
import { computeProgress } from "./progress.js";

type ValueRow = ExtractedValue & {
  review: Review | null;
  previousValue?: (ExtractedValue & { review: Review | null }) | null;
};

type DocumentTypeRow = DocumentType & { fields?: DocumentTypeField[] };

function asFormatRules(raw: unknown): FormatRule[] {
  return Array.isArray(raw) ? (raw as FormatRule[]) : [];
}

export function serializeDocumentType(type: DocumentTypeRow) {
  return {
    id: type.id,
    key: type.key,
    label: type.label,
    fields: (type.fields || [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((f) => ({
        id: f.id,
        fieldKey: f.fieldKey,
        fieldType: f.fieldType,
        formatRules: asFormatRules(f.formatRules),
        sortOrder: f.sortOrder,
      })),
  };
}

export function serializeValue(
  value: ValueRow,
  formatRulesByKey?: Map<string, FormatRule[]>,
) {
  const needsAttention =
    !value.review && (!!value.gapReason || value.certainty < CERTAINTY_THRESHOLD);
  const effectiveValue = value.review?.correctedValue ?? value.value;
  const rules = formatRulesByKey?.get(value.fieldKey) || [];
  const formattedValue =
    effectiveValue == null
      ? null
      : rules.length
        ? applyFormatRules(effectiveValue, rules)
        : effectiveValue;

  return {
    id: value.id,
    fieldKey: value.fieldKey,
    value: value.value,
    evidence: value.evidence,
    gapReason: value.gapReason,
    certainty: value.certainty,
    carriedOver: value.carriedOver,
    source: value.source,
    adHoc: value.adHoc,
    needsAttention,
    effectiveValue,
    formattedValue,
    review: value.review
      ? {
          decision: value.review.decision,
          correctedValue: value.review.correctedValue,
          note: value.review.note,
        }
      : null,
    previous: value.previousValue
      ? {
          id: value.previousValue.id,
          value: value.previousValue.value,
          evidence: value.previousValue.evidence,
          effectiveValue:
            value.previousValue.review?.correctedValue ?? value.previousValue.value,
          review: value.previousValue.review
            ? {
                decision: value.previousValue.review.decision,
                correctedValue: value.previousValue.review.correctedValue,
                note: value.previousValue.review.note,
              }
            : null,
        }
      : null,
  };
}

export function serializeDocument(
  document: Document & {
    documentType?: DocumentTypeRow | null;
    versions: (DocumentVersion & { values?: ValueRow[] })[];
  },
) {
  const current =
    document.versions.slice().sort((a, b) => b.versionNumber - a.versionNumber)[0] ||
    null;

  const values = current?.values || [];
  const progress = computeProgress(values, CERTAINTY_THRESHOLD);
  const reviewComplete =
    current?.status === "extracted" && values.length > 0 && progress.pending === 0;

  const typeInfo = document.documentType
    ? {
        id: document.documentType.id,
        key: document.documentType.key,
        label: document.documentType.label,
        schemaUpdatedAt: document.documentType.schemaUpdatedAt,
      }
    : null;

  const formatRulesByKey = new Map<string, FormatRule[]>();
  for (const f of document.documentType?.fields || []) {
    formatRulesByKey.set(f.fieldKey, asFormatRules(f.formatRules));
  }

  const extractedSchemaAt = current?.extractedSchemaAt ?? null;
  const schemaStale =
    !!current &&
    current.status === "extracted" &&
    !!typeInfo?.schemaUpdatedAt &&
    (!extractedSchemaAt ||
      new Date(typeInfo.schemaUpdatedAt).getTime() >
        new Date(extractedSchemaAt).getTime());

  return {
    id: document.id,
    type: typeInfo?.key || "",
    batchId: document.batchId,
    documentTypeId: document.documentTypeId,
    documentType: typeInfo
      ? { id: typeInfo.id, key: typeInfo.key, label: typeInfo.label }
      : null,
    title: document.title,
    createdAt: document.createdAt,
    currentVersion: current
      ? {
          id: current.id,
          versionNumber: current.versionNumber,
          status: current.status,
          failureReason: current.failureReason,
          parsedText: current.parsedText,
          contentHash: current.contentHash ?? null,
          extractedSchemaAt,
          createdAt: current.createdAt,
        }
      : null,
    values: values.map((v) => serializeValue(v, formatRulesByKey)),
    progress,
    reviewComplete,
    schemaStale,
    duplicateBatches: [] as Array<{
      batchId: string;
      batchName: string;
      documentId: string;
      documentTitle: string;
    }>,
  };
}

export type SerializedDocument = ReturnType<typeof serializeDocument>;
export type DuplicateBatchInfo = SerializedDocument["duplicateBatches"][number];

/** Attach cross-batch duplicate PDF info (same contentHash) to serialized docs. */
export async function attachDuplicateBatches(
  docs: SerializedDocument[],
  findMatches: (hashes: string[]) => Promise<
    Array<{
      contentHash: string | null;
      documentId: string;
      documentTitle: string;
      batchId: string;
      batchName: string;
    }>
  >,
): Promise<SerializedDocument[]> {
  const hashes = [
    ...new Set(
      docs
        .map((d) => d.currentVersion?.contentHash)
        .filter((h): h is string => !!h),
    ),
  ];
  if (hashes.length === 0) return docs;

  const matches = await findMatches(hashes);
  const byHash = new Map<string, typeof matches>();
  for (const m of matches) {
    if (!m.contentHash) continue;
    const list = byHash.get(m.contentHash) || [];
    list.push(m);
    byHash.set(m.contentHash, list);
  }

  return docs.map((doc) => {
    const hash = doc.currentVersion?.contentHash;
    if (!hash) return doc;
    const seenBatches = new Set<string>();
    const duplicateBatches: DuplicateBatchInfo[] = [];
    for (const m of byHash.get(hash) || []) {
      if (m.documentId === doc.id) continue;
      if (m.batchId === doc.batchId) continue;
      if (seenBatches.has(m.batchId)) continue;
      seenBatches.add(m.batchId);
      duplicateBatches.push({
        batchId: m.batchId,
        batchName: m.batchName,
        documentId: m.documentId,
        documentTitle: m.documentTitle,
      });
    }
    return { ...doc, duplicateBatches };
  });
}
