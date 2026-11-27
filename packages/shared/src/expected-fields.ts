export type FieldType = "string" | "date" | "money" | "number" | "percent";

export interface ExpectedField {
  field: string;
  type: FieldType;
}

/** Seed defaults for built-in document types (DB is source of truth at runtime). */
export const DEFAULT_DOCUMENT_TYPES: Array<{
  key: string;
  label: string;
  fields: ExpectedField[];
}> = [
  {
    key: "invoice",
    label: "Invoice",
    fields: [
      { field: "invoice_number", type: "string" },
      { field: "issue_date", type: "date" },
      { field: "due_date", type: "date" },
      { field: "vendor_name", type: "string" },
      { field: "total_amount", type: "money" },
    ],
  },
  {
    key: "lease",
    label: "Lease",
    fields: [
      { field: "tenant_name", type: "string" },
      { field: "monthly_rent", type: "money" },
      { field: "security_deposit", type: "money" },
      { field: "lease_start", type: "date" },
      { field: "term_months", type: "number" },
    ],
  },
  {
    key: "market_report",
    label: "Market report",
    fields: [
      { field: "report_quarter", type: "string" },
      { field: "market_area", type: "string" },
      { field: "vacancy_rate", type: "percent" },
      { field: "average_rent_1br", type: "money" },
      { field: "year_over_year_rent_growth", type: "percent" },
      { field: "median_household_income", type: "money" },
    ],
  },
];

/** @deprecated Prefer DEFAULT_DOCUMENT_TYPES — kept for offline tests. */
export const EXPECTED_FIELDS: Record<string, ExpectedField[]> = Object.fromEntries(
  DEFAULT_DOCUMENT_TYPES.map((t) => [t.key, t.fields]),
);

export const FIELD_TYPES: FieldType[] = ["string", "date", "money", "number", "percent"];

export function isFieldType(value: string): value is FieldType {
  return (FIELD_TYPES as string[]).includes(value);
}

export function slugifyTypeKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

export function normalizeFieldKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}
