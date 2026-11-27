import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeProgress } from "./progress.js";

describe("computeProgress", () => {
  it("counts pending, approved, corrected, carried-over", () => {
    const counts = computeProgress(
      [
        {
          id: "1",
          versionId: "v",
          fieldKey: "a",
          value: "1",
          evidence: "a",
          gapReason: null,
          certainty: 99,
          carriedOver: true,
          previousValueId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          review: { id: "r", valueId: "1", decision: "approved", correctedValue: null, note: null, createdAt: new Date(), updatedAt: new Date() },
        },
        {
          id: "2",
          versionId: "v",
          fieldKey: "b",
          value: "2",
          evidence: "b",
          gapReason: null,
          certainty: 80,
          carriedOver: false,
          previousValueId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          review: null,
        },
        {
          id: "3",
          versionId: "v",
          fieldKey: "c",
          value: "3",
          evidence: "c",
          gapReason: null,
          certainty: 96,
          carriedOver: false,
          previousValueId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          review: { id: "r3", valueId: "3", decision: "corrected", correctedValue: "3.0", note: null, createdAt: new Date(), updatedAt: new Date() },
        },
      ],
      95,
    );

    assert.equal(counts.pending, 1);
    assert.equal(counts.approved, 1);
    assert.equal(counts.corrected, 1);
    assert.equal(counts.carriedOver, 1);
    assert.equal(counts.lowCertaintyPending, 1);
  });
});
