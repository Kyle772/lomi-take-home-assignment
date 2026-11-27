import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyFormatRules,
  dateFormatRules,
  moneyFormatRules,
  testFormatRule,
} from "./format-value.js";

describe("money format rules", () => {
  const rules = moneyFormatRules();

  it("adds $ and decimals to bare number", () => {
    assert.equal(applyFormatRules("123", rules), "$123.00");
  });

  it("keeps existing $ and adds decimals", () => {
    assert.equal(applyFormatRules("$123", rules), "$123.00");
  });

  it("leaves already-formatted money alone", () => {
    assert.equal(applyFormatRules("$123.45", rules), "$123.45");
  });

  it("prefix rule skips when $ present", () => {
    const prefix = rules[0]!;
    const r = testFormatRule("$123", prefix);
    assert.equal(r.skipped, true);
    assert.equal(r.reason, "skipIfMatch");
    assert.equal(r.output, "$123");
  });

  it("decimals rule skips when two decimals present", () => {
    const decimals = rules[1]!;
    const r = testFormatRule("$123.45", decimals);
    assert.equal(r.skipped, true);
    assert.equal(r.output, "$123.45");
  });

  it("handles commas in input", () => {
    assert.equal(applyFormatRules("$1,234", rules), "$1234.00");
  });
});

describe("date format rules", () => {
  it("formats ISO to MM-DD-YYYY", () => {
    const rules = dateFormatRules("MM-DD-YYYY");
    assert.equal(applyFormatRules("2025-09-14", rules), "09-14-2025");
  });

  it("formats ISO to DD-MM-YYYY", () => {
    const rules = dateFormatRules("DD-MM-YYYY");
    assert.equal(applyFormatRules("2025-09-14", rules), "14-09-2025");
  });

  it("keeps YYYY-MM-DD for ISO output", () => {
    const rules = dateFormatRules("ISO");
    assert.equal(applyFormatRules("2025-09-14", rules), "2025-09-14");
  });
});

describe("applyFormatRules", () => {
  it("returns empty string for null", () => {
    assert.equal(applyFormatRules(null, moneyFormatRules()), "");
  });

  it("returns raw when no rules", () => {
    assert.equal(applyFormatRules("abc", []), "abc");
  });
});
