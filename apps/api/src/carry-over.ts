import { evidenceEquals } from "@lomi/shared";
import type { ExtractedValue, Prisma, Review } from "@lomi/db";
import type { ValidatedField } from "@lomi/extraction";

type PriorValue = ExtractedValue & { review: Review | null };

export type UpsertValueInput = Prisma.ExtractedValueCreateManyInput & {
  fieldKey: string;
};

/**
 * Build rows for the new version, carrying reviews when evidence is unchanged.
 * Pass `copyReviews: false` (rescan / reclassify) to force a fresh review pass.
 */
export function buildValuesWithCarryOver(
  versionId: string,
  fields: ValidatedField[],
  priorValues: PriorValue[],
  options?: { copyReviews?: boolean },
): Array<{
  versionId: string;
  fieldKey: string;
  value: string | null;
  evidence: string | null;
  gapReason: string | null;
  certainty: number;
  carriedOver: boolean;
  previousValueId: string | null;
  reviewToCopy: Review | null;
}> {
  const copyReviews = options?.copyReviews !== false;
  const priorByField = new Map(priorValues.map((v) => [v.fieldKey, v]));

  return fields.map((field) => {
    const prior = priorByField.get(field.fieldKey) || null;
    const unchanged =
      copyReviews &&
      !!prior &&
      evidenceEquals(prior.evidence, field.evidence) &&
      !!prior.review;

    return {
      versionId,
      fieldKey: field.fieldKey,
      value: field.value,
      evidence: field.evidence,
      gapReason: field.gapReason,
      certainty: field.certainty,
      carriedOver: unchanged,
      previousValueId: prior?.id ?? null,
      reviewToCopy: unchanged ? prior!.review : null,
    };
  });
}
