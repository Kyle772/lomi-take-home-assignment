/** Certainty below this (or gaps) get focused review UI. */
export const CERTAINTY_THRESHOLD = 95;

export const VERSION_STATUSES = [
  "queued",
  "extracting",
  "extracted",
  "failed",
] as const;

export type VersionStatus = (typeof VERSION_STATUSES)[number];

export const REVIEW_DECISIONS = ["approved", "corrected"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
