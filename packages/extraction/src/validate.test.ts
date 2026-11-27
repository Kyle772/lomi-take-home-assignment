import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EXPECTED_FIELDS } from "@lomi/shared";
import { validateExtractedFields } from "./validate.js";

const text = "Invoice Number: INV-100\nVendor: Acme Corp\nTotal: $250.00";
const catalog = EXPECTED_FIELDS.invoice;

describe("validateExtractedFields", () => {
  it("accepts verbatim evidence with value present", () => {
    const result = validateExtractedFields(catalog, text, [
      {
        field: "invoice_number",
        value: "INV-100",
        evidence: "Invoice Number: INV-100",
        certainty: 98,
      },
      {
        field: "issue_date",
        value: null,
        evidence: null,
        certainty: 0,
        gapReason: "not found",
      },
      {
        field: "due_date",
        value: null,
        evidence: null,
        certainty: 0,
        gapReason: "not found",
      },
      {
        field: "vendor_name",
        value: "Acme Corp",
        evidence: "Vendor: Acme Corp",
        certainty: 99,
      },
      {
        field: "total_amount",
        value: "$250.00",
        evidence: "Total: $250.00",
        certainty: 97,
      },
    ]);

    const invoiceNumber = result.find((r) => r.fieldKey === "invoice_number");
    assert.equal(invoiceNumber?.value, "INV-100");
    assert.equal(invoiceNumber?.gapReason, null);
  });

  it("gaps hallucinated evidence", () => {
    const result = validateExtractedFields(catalog, text, [
      {
        field: "invoice_number",
        value: "INV-999",
        evidence: "Invoice Number: INV-999",
        certainty: 90,
      },
      { field: "issue_date", value: null, evidence: null, certainty: 0, gapReason: "x" },
      { field: "due_date", value: null, evidence: null, certainty: 0, gapReason: "x" },
      { field: "vendor_name", value: null, evidence: null, certainty: 0, gapReason: "x" },
      { field: "total_amount", value: null, evidence: null, certainty: 0, gapReason: "x" },
    ]);

    const invoiceNumber = result.find((r) => r.fieldKey === "invoice_number");
    assert.equal(invoiceNumber?.value, null);
    assert.match(invoiceNumber?.gapReason || "", /verbatim/i);
  });

  it("gaps when value not in evidence", () => {
    const result = validateExtractedFields(catalog, text, [
      {
        field: "invoice_number",
        value: "WRONG",
        evidence: "Invoice Number: INV-100",
        certainty: 80,
      },
      { field: "issue_date", value: null, evidence: null, certainty: 0, gapReason: "x" },
      { field: "due_date", value: null, evidence: null, certainty: 0, gapReason: "x" },
      { field: "vendor_name", value: null, evidence: null, certainty: 0, gapReason: "x" },
      { field: "total_amount", value: null, evidence: null, certainty: 0, gapReason: "x" },
    ]);

    assert.equal(result[0]?.value, null);
    assert.match(result[0]?.gapReason || "", /does not appear/i);
  });
});
