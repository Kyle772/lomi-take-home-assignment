import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateExtractedFields } from "@lomi/extraction";
import { EXPECTED_FIELDS, evidenceAppearsInText } from "@lomi/shared";

const sampleText = `
INVOICE
Invoice Number: INV-001
Issue Date: 2024-03-01
Due Date: 2024-03-15
Vendor: Meridian Office Supplies
Total Amount Due: $1,240.50
`;

const catalog = EXPECTED_FIELDS.invoice!;

describe("extraction harness eval (offline validator)", () => {
  it("keeps catalog coverage and certainty range", () => {
    const raw = catalog.map((f) => {
      if (f.field === "invoice_number") {
        return {
          field: f.field,
          value: "INV-001",
          evidence: "Invoice Number: INV-001",
          certainty: 96,
          gapReason: null,
        };
      }
      if (f.field === "vendor_name") {
        return {
          field: f.field,
          value: "Meridian Office Supplies",
          evidence: "Vendor: Meridian Office Supplies",
          certainty: 94,
          gapReason: null,
        };
      }
      return {
        field: f.field,
        value: null,
        evidence: null,
        certainty: 0,
        gapReason: "not found in stub",
      };
    });

    const validated = validateExtractedFields(catalog, sampleText, raw);
    assert.equal(validated.length, catalog.length);

    for (const field of validated) {
      assert.ok(field.certainty >= 0 && field.certainty <= 100);
      if (field.value != null && field.evidence) {
        assert.equal(evidenceAppearsInText(field.evidence, sampleText), true);
        assert.equal(field.gapReason, null);
      }
    }
  });

  it("idempotent field keys — one entry per catalog field", () => {
    const raw = [
      {
        field: "invoice_number",
        value: "INV-001",
        evidence: "Invoice Number: INV-001",
        certainty: 99,
        gapReason: null,
      },
      {
        field: "invoice_number",
        value: "INV-001",
        evidence: "Invoice Number: INV-001",
        certainty: 50,
        gapReason: null,
      },
      ...catalog
        .filter((f) => f.field !== "invoice_number")
        .map((f) => ({
          field: f.field,
          value: null,
          evidence: null,
          certainty: 0,
          gapReason: "x",
        })),
    ];

    const validated = validateExtractedFields(catalog, sampleText, raw);
    const keys = validated.map((v) => v.fieldKey);
    assert.equal(keys.length, catalog.length);
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(validated.find((v) => v.fieldKey === "invoice_number")?.value, "INV-001");
  });
});
