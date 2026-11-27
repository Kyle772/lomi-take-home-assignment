import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evidenceAppearsInText,
  evidenceEquals,
  normalizeWhitespace,
  valueAppearsInEvidence,
} from "./normalize.js";

describe("normalize", () => {
  it("collapses whitespace", () => {
    assert.equal(normalizeWhitespace("a  \n b"), "a b");
  });

  it("matches evidence with whitespace drift", () => {
    assert.equal(evidenceEquals("Invoice  #12", "Invoice #12"), true);
  });

  it("finds evidence in parsed text", () => {
    assert.equal(
      evidenceAppearsInText("Total: $100.00", "Line\nTotal: $100.00\nEnd"),
      true,
    );
  });

  it("checks value in evidence", () => {
    assert.equal(valueAppearsInEvidence("$1,250.00", "Total due $1,250.00"), true);
  });
});
