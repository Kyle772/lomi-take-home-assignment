/** Collapse whitespace for evidence equality / substring checks. */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Soft normalize for value-in-evidence checks. */
export function normalizeValueForCompare(value: string): string {
  return normalizeWhitespace(value)
    .replace(/[$,]/g, "")
    .replace(/%/g, "")
    .toLowerCase();
}

export function evidenceEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizeWhitespace(a) === normalizeWhitespace(b);
}

export function evidenceAppearsInText(evidence: string, parsedText: string): boolean {
  return parsedText.includes(evidence) || normalizeWhitespace(parsedText).includes(normalizeWhitespace(evidence));
}

export function valueAppearsInEvidence(value: string, evidence: string): boolean {
  const v = normalizeValueForCompare(value);
  const e = normalizeValueForCompare(evidence);
  if (!v) return false;
  if (e.includes(v)) return true;
  // Also try raw substring for dates like 2024-01-15 vs January 15, 2024 — soft fail open if formats differ:
  // require at least that some token of the value appears.
  const tokens = v.split(/[\s,/.-]+/).filter((t) => t.length >= 2);
  if (tokens.length === 0) return e.includes(v);
  return tokens.every((t) => e.includes(t));
}
