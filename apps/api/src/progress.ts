import type { ExtractedValue, Review } from "@lomi/db";

export type ProgressCounts = {
  pending: number;
  approved: number;
  corrected: number;
  carriedOver: number;
  lowCertaintyPending: number;
};

type ValueWithReview = ExtractedValue & { review: Review | null };

export function computeProgress(
  values: ValueWithReview[],
  certaintyThreshold: number,
): ProgressCounts {
  const counts: ProgressCounts = {
    pending: 0,
    approved: 0,
    corrected: 0,
    carriedOver: 0,
    lowCertaintyPending: 0,
  };

  for (const value of values) {
    if (value.carriedOver) counts.carriedOver += 1;
    if (!value.review) {
      counts.pending += 1;
      if (value.gapReason || value.certainty < certaintyThreshold) {
        counts.lowCertaintyPending += 1;
      }
    } else if (value.review.decision === "approved") {
      counts.approved += 1;
    } else {
      counts.corrected += 1;
    }
  }

  return counts;
}
