import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildValuesWithCarryOver } from "./carry-over.js";

describe("buildValuesWithCarryOver", () => {
  it("carries review when evidence unchanged", () => {
    const rows = buildValuesWithCarryOver(
      "v2",
      [
        {
          fieldKey: "invoice_number",
          value: "INV-1",
          evidence: "Invoice Number: INV-1",
          certainty: 99,
          gapReason: null,
        },
      ],
      [
        {
          id: "prev1",
          versionId: "v1",
          fieldKey: "invoice_number",
          value: "INV-1",
          evidence: "Invoice Number: INV-1",
          gapReason: null,
          certainty: 99,
          carriedOver: false,
          previousValueId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          review: {
            id: "r1",
            valueId: "prev1",
            decision: "approved",
            correctedValue: null,
            note: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      ],
    );

    assert.equal(rows[0]?.carriedOver, true);
    assert.equal(rows[0]?.reviewToCopy?.decision, "approved");
  });

  it("resets to pending when evidence changes", () => {
    const rows = buildValuesWithCarryOver(
      "v2",
      [
        {
          fieldKey: "total_amount",
          value: "$200",
          evidence: "Total: $200",
          certainty: 90,
          gapReason: null,
        },
      ],
      [
        {
          id: "prev2",
          versionId: "v1",
          fieldKey: "total_amount",
          value: "$100",
          evidence: "Total: $100",
          gapReason: null,
          certainty: 95,
          carriedOver: false,
          previousValueId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          review: {
            id: "r2",
            valueId: "prev2",
            decision: "corrected",
            correctedValue: "$100.00",
            note: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      ],
    );

    assert.equal(rows[0]?.carriedOver, false);
    assert.equal(rows[0]?.reviewToCopy, null);
    assert.equal(rows[0]?.previousValueId, "prev2");
  });

  it("skips review carry when copyReviews is false (rescan)", () => {
    const rows = buildValuesWithCarryOver(
      "v2",
      [
        {
          fieldKey: "invoice_number",
          value: "INV-1",
          evidence: "Invoice Number: INV-1",
          certainty: 99,
          gapReason: null,
        },
      ],
      [
        {
          id: "prev1",
          versionId: "v1",
          fieldKey: "invoice_number",
          value: "INV-1",
          evidence: "Invoice Number: INV-1",
          gapReason: null,
          certainty: 99,
          carriedOver: false,
          previousValueId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          review: {
            id: "r1",
            valueId: "prev1",
            decision: "approved",
            correctedValue: null,
            note: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      ],
      { copyReviews: false },
    );

    assert.equal(rows[0]?.carriedOver, false);
    assert.equal(rows[0]?.reviewToCopy, null);
    assert.equal(rows[0]?.previousValueId, "prev1");
  });
});
