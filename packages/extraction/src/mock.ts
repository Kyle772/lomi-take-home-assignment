import type { ExpectedField } from "@lomi/shared";
import { validateExtractedFields, type RawExtractedField } from "./validate.js";
import type { ExtractionResult } from "./harness.js";

const PATTERNS: Record<string, RegExp[]> = {
  invoice_number: [/Invoice Number:\s*([^\n]+)/i],
  issue_date: [/Issue Date:\s*([^\n]+)/i],
  due_date: [/Due Date:\s*([^\n]+)/i],
  vendor_name: [/Vendor(?:\s*Name)?:\s*([^\n]+)/i, /MERIDIAN OFFICE SUPPLIES[^\n]*/i],
  total_amount: [/Total(?: Amount(?: Due)?)?:\s*([^\n]+)/i],
  tenant_name: [/Tenant:\s*([^\n]+)/i, /between\s+([^,\n]+)\s+\(/i],
  monthly_rent: [/Monthly Rent:\s*([^\n]+)/i, /rent of\s+([^\n.]+)/i],
  security_deposit: [/Security Deposit:\s*([^\n]+)/i],
  lease_start: [/Lease Start:\s*([^\n]+)/i, /commencing\s+([^\n.]+)/i],
  term_months: [/Term(?: \(months\))?:\s*([^\n]+)/i, /(\d+)\s+months/i],
  report_quarter: [/Report Quarter:\s*([^\n]+)/i, /\b(Q[1-4]\s+\d{4})\b/i],
  market_area: [/Market Area:\s*([^\n]+)/i, /Eastport[^\n]*/i],
  vacancy_rate: [/Vacancy Rate:\s*([^\n]+)/i],
  average_rent_1br: [/Average Rent(?: \(1BR\))?:\s*([^\n]+)/i, /1BR[^\n]*?(\$[\d,]+(?:\.\d+)?)/i],
  year_over_year_rent_growth: [/Year[- ]over[- ]Year(?: Rent)? Growth:\s*([^\n]+)/i],
  median_household_income: [/Median Household Income:\s*([^\n]+)/i],
};

export function extractWithMock(
  documentTypeKey: string,
  catalog: ExpectedField[],
  parsedText: string,
): ExtractionResult {
  const raw: RawExtractedField[] = catalog.map((field) => {
    const patterns = PATTERNS[field.field] || [];
    for (const pattern of patterns) {
      const match = parsedText.match(pattern);
      if (!match) continue;
      const value = (match[1] || match[0]).trim();
      const evidence = match[0].trim();
      const highConfidence = [
        "invoice_number",
        "vendor_name",
        "tenant_name",
        "report_quarter",
        "market_area",
      ].includes(field.field);
      return {
        field: field.field,
        value,
        evidence,
        certainty: highConfidence ? 98 : 88,
        gapReason: null,
      };
    }
    return {
      field: field.field,
      value: null,
      evidence: null,
      certainty: 0,
      gapReason: "Mock extractor could not locate field",
    };
  });

  const prompt = `[mock-extractor] type=${documentTypeKey}`;
  const fields = validateExtractedFields(catalog, parsedText, raw);
  return {
    fields,
    prompt,
    rawResponse: JSON.stringify({ fields: raw }, null, 2),
  };
}
