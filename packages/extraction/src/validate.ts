import {
  evidenceAppearsInText,
  valueAppearsInEvidence,
  type ExpectedField,
} from "@lomi/shared";

export interface RawExtractedField {
  field: string;
  value: string | null;
  evidence: string | null;
  certainty: number;
  gapReason?: string | null;
}

export interface ValidatedField {
  fieldKey: string;
  value: string | null;
  evidence: string | null;
  certainty: number;
  gapReason: string | null;
}

function clampCertainty(n: unknown): number {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

export function validateExtractedFields(
  catalog: ExpectedField[],
  parsedText: string,
  rawFields: RawExtractedField[],
): ValidatedField[] {
  const byField = new Map(rawFields.map((f) => [f.field, f]));

  return catalog.map((expected) => {
    const raw = byField.get(expected.field);
    if (!raw) {
      return {
        fieldKey: expected.field,
        value: null,
        evidence: null,
        certainty: 0,
        gapReason: "Field missing from model response",
      };
    }

    if (raw.gapReason || raw.value == null || raw.value === "") {
      return {
        fieldKey: expected.field,
        value: null,
        evidence: raw.evidence,
        certainty: 0,
        gapReason: raw.gapReason || "Field not found in document",
      };
    }

    if (!raw.evidence) {
      return {
        fieldKey: expected.field,
        value: null,
        evidence: null,
        certainty: 0,
        gapReason: "Missing evidence quote",
      };
    }

    if (!evidenceAppearsInText(raw.evidence, parsedText)) {
      return {
        fieldKey: expected.field,
        value: null,
        evidence: raw.evidence,
        certainty: 0,
        gapReason: "Evidence quote not found verbatim in parsed text",
      };
    }

    if (!valueAppearsInEvidence(raw.value, raw.evidence)) {
      return {
        fieldKey: expected.field,
        value: null,
        evidence: raw.evidence,
        certainty: 0,
        gapReason: "Extracted value does not appear in evidence quote",
      };
    }

    return {
      fieldKey: expected.field,
      value: raw.value,
      evidence: raw.evidence,
      certainty: clampCertainty(raw.certainty),
      gapReason: null,
    };
  });
}
