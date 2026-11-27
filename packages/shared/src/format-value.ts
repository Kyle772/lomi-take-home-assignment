export type DateOutputFormat = "ISO" | "YYYY-MM-DD" | "MM-DD-YYYY" | "DD-MM-YYYY";

export type FormatRuleKind =
  | "ensure_prefix"
  | "ensure_suffix"
  | "ensure_decimals"
  | "regex_replace"
  | "date_format";

export type FormatRule = {
  id: string;
  name: string;
  kind: FormatRuleKind;
  /** If this matches the current string, skip the transform. */
  skipIfMatch?: string;
  /** If set, only run when this matches. */
  onlyIfMatch?: string;
  value?: string;
  pattern?: string;
  decimals?: number;
  dateOutput?: DateOutputFormat;
};

export type FormatRuleTestResult = {
  skipped: boolean;
  reason?: string;
  output: string;
};

function safeRegex(source: string | undefined): RegExp | null {
  if (!source) return null;
  try {
    return new RegExp(source);
  } catch {
    return null;
  }
}

function stripCurrencyNoise(raw: string): string {
  return raw.replace(/,/g, "").trim();
}

function parseLooseNumber(raw: string): number | null {
  const cleaned = stripCurrencyNoise(raw).replace(/[^0-9.+-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === "+" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function formatDecimals(raw: string, places: number): string {
  const prefixMatch = raw.match(/^(\s*\$?\s*)/);
  const prefix = prefixMatch?.[1] ?? "";
  const n = parseLooseNumber(raw);
  if (n == null) return raw;
  const fixed = n.toFixed(places);
  // Preserve leading $ if present in prefix; otherwise leave numeric only.
  if (/\$/.test(prefix)) {
    return `$${fixed}`;
  }
  // Keep any non-$ prefix whitespace only
  return `${prefix.replace(/\$/g, "")}${fixed}`;
}

function parseLooseDate(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;

  // ISO / YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // MM/DD/YYYY or MM-DD-YYYY
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]);
    // Prefer US if first > 12 can't be day-first; if second > 12 treat as DD-MM
    if (a > 12) {
      const d = new Date(Date.UTC(y, b - 1, a));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if (b > 12) {
      const d = new Date(Date.UTC(y, a - 1, b));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(Date.UTC(y, a - 1, b));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // DD/MM/YYYY ambiguous — already handled above with heuristics
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  return null;
}

function emitDate(d: Date, format: DateOutputFormat): string {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  switch (format) {
    case "MM-DD-YYYY":
      return `${mo}-${day}-${y}`;
    case "DD-MM-YYYY":
      return `${day}-${mo}-${y}`;
    case "ISO":
    case "YYYY-MM-DD":
    default:
      return `${y}-${mo}-${day}`;
  }
}

export function testFormatRule(input: string, rule: FormatRule): FormatRuleTestResult {
  const current = input ?? "";

  const only = safeRegex(rule.onlyIfMatch);
  if (only && !only.test(current)) {
    return { skipped: true, reason: "onlyIfMatch", output: current };
  }

  const skip = safeRegex(rule.skipIfMatch);
  if (skip && skip.test(current)) {
    return { skipped: true, reason: "skipIfMatch", output: current };
  }

  let output = current;
  switch (rule.kind) {
    case "ensure_prefix": {
      const prefix = rule.value ?? "";
      output = prefix + current;
      break;
    }
    case "ensure_suffix": {
      const suffix = rule.value ?? "";
      output = current + suffix;
      break;
    }
    case "ensure_decimals": {
      output = formatDecimals(current, rule.decimals ?? 2);
      break;
    }
    case "regex_replace": {
      const re = safeRegex(rule.pattern);
      if (!re) {
        return { skipped: true, reason: "invalid_pattern", output: current };
      }
      output = current.replace(re, rule.value ?? "");
      break;
    }
    case "date_format": {
      const d = parseLooseDate(current);
      if (!d) {
        return { skipped: true, reason: "unparseable_date", output: current };
      }
      output = emitDate(d, rule.dateOutput || "YYYY-MM-DD");
      break;
    }
    default:
      return { skipped: true, reason: "unknown_kind", output: current };
  }

  return { skipped: false, output };
}

export function applyFormatRules(
  raw: string | null | undefined,
  rules: FormatRule[] | null | undefined,
): string {
  if (raw == null) return "";
  let current = String(raw);
  if (!rules?.length) return current;
  for (const rule of rules) {
    current = testFormatRule(current, rule).output;
  }
  return current;
}

export function moneyFormatRules(): FormatRule[] {
  return [
    {
      id: "money-prefix-dollar",
      name: "Ensure $ prefix",
      kind: "ensure_prefix",
      value: "$",
      skipIfMatch: "^\\s*\\$",
    },
    {
      id: "money-two-decimals",
      name: "Ensure 2 decimals",
      kind: "ensure_decimals",
      decimals: 2,
      // Already has exactly 2 decimal places (optional $)
      skipIfMatch: "^\\s*\\$?\\s*\\d[\\d,]*\\.\\d{2}\\s*$",
    },
  ];
}

export function dateFormatRules(dateOutput: DateOutputFormat = "YYYY-MM-DD"): FormatRule[] {
  return [
    {
      id: "date-output",
      name: `Date → ${dateOutput}`,
      kind: "date_format",
      dateOutput,
    },
  ];
}

export function defaultFormatRulesForFieldType(fieldType: string): FormatRule[] {
  switch (fieldType) {
    case "money":
      return moneyFormatRules();
    case "date":
      return dateFormatRules("YYYY-MM-DD");
    default:
      return [];
  }
}

export function newRuleId(prefix = "rule"): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
