"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyFormatRules,
  dateFormatRules,
  defaultFormatRulesForFieldType,
  moneyFormatRules,
  newRuleId,
  testFormatRule,
  type DateOutputFormat,
  type FormatRule,
  type FormatRuleKind,
} from "@lomi/shared";
import {
  createDocumentType,
  listDocumentTypes,
  updateDocumentType,
  type DocumentTypeDto,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

const FIELD_TYPES = ["string", "date", "money", "number", "percent"] as const;
const DATE_OUTPUTS: DateOutputFormat[] = [
  "YYYY-MM-DD",
  "MM-DD-YYYY",
  "DD-MM-YYYY",
  "ISO",
];
const RULE_KINDS: FormatRuleKind[] = [
  "ensure_prefix",
  "ensure_suffix",
  "ensure_decimals",
  "regex_replace",
  "date_format",
];

type DraftField = {
  fieldKey: string;
  fieldType: string;
  formatRules: FormatRule[];
  formatOpen: boolean;
};

function emptyField(): DraftField {
  return { fieldKey: "", fieldType: "string", formatRules: [], formatOpen: false };
}

function draftFromType(t: DocumentTypeDto): DraftField[] {
  if (!t.fields.length) return [emptyField()];
  return t.fields.map((f) => ({
    fieldKey: f.fieldKey,
    fieldType: f.fieldType,
    formatRules: (f.formatRules || []) as FormatRule[],
    formatOpen: false,
  }));
}

function dateOutputOf(rules: FormatRule[]): DateOutputFormat {
  const rule = rules.find((r) => r.kind === "date_format");
  return rule?.dateOutput || "YYYY-MM-DD";
}

function setDateOutput(rules: FormatRule[], dateOutput: DateOutputFormat): FormatRule[] {
  const next = [...rules];
  const idx = next.findIndex((r) => r.kind === "date_format");
  const rule = dateFormatRules(dateOutput)[0]!;
  if (idx >= 0) {
    next[idx] = { ...next[idx]!, ...rule, id: next[idx]!.id };
  } else {
    next.push(rule);
  }
  return next;
}

function ensureMoneyPreset(
  rules: FormatRule[],
  which: "prefix" | "decimals",
): FormatRule[] {
  const presets = moneyFormatRules();
  const target = which === "prefix" ? presets[0]! : presets[1]!;
  if (rules.some((r) => r.kind === target.kind && r.id === target.id)) {
    return rules;
  }
  if (which === "prefix" && rules.some((r) => r.kind === "ensure_prefix" && r.value === "$")) {
    return rules;
  }
  if (which === "decimals" && rules.some((r) => r.kind === "ensure_decimals")) {
    return rules;
  }
  return [...rules, target];
}

function blankRule(): FormatRule {
  return {
    id: newRuleId(),
    name: "New rule",
    kind: "ensure_prefix",
    value: "",
  };
}

export function DocumentTypesPanel({ onChanged }: { onChanged?: () => void }) {
  const [types, setTypes] = useState<DocumentTypeDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [fields, setFields] = useState<DraftField[]>([emptyField()]);

  const refresh = useCallback(async () => {
    try {
      const data = await listDocumentTypes();
      setTypes(data.documentTypes);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load types");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function startCreate() {
    setCreating(true);
    setEditingId(null);
    setLabel("");
    setFields([emptyField()]);
    setError(null);
  }

  function startEdit(t: DocumentTypeDto) {
    setCreating(false);
    setEditingId(t.id);
    setLabel(t.label);
    setFields(draftFromType(t));
    setError(null);
  }

  function cancelForm() {
    setCreating(false);
    setEditingId(null);
    setLabel("");
    setFields([emptyField()]);
    setError(null);
  }

  function updateField(index: number, patch: Partial<DraftField>) {
    setFields((prev) => {
      const next = [...prev];
      next[index] = { ...next[index]!, ...patch };
      return next;
    });
  }

  function changeFieldType(index: number, fieldType: string) {
    setFields((prev) => {
      const next = [...prev];
      const cur = next[index]!;
      next[index] = {
        ...cur,
        fieldType,
        formatRules: defaultFormatRulesForFieldType(fieldType),
        formatOpen: fieldType === "money" || fieldType === "date" ? true : cur.formatOpen,
      };
      return next;
    });
  }

  async function save() {
    const cleaned = fields
      .map((f) => ({
        fieldKey: f.fieldKey.trim(),
        fieldType: f.fieldType || "string",
        formatRules: f.formatRules,
      }))
      .filter((f) => f.fieldKey);
    if (!label.trim() || cleaned.length === 0) {
      setError("Label and at least one field key are required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (creating) {
        await createDocumentType({ label: label.trim(), fields: cleaned });
      } else if (editingId) {
        await updateDocumentType(editingId, { label: label.trim(), fields: cleaned });
      }
      cancelForm();
      await refresh();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const formOpen = creating || !!editingId;

  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-2xl">Document types</h2>
          <p className="mt-1 text-sm text-muted">
            Define extraction keys per type. Schema edits apply to future scans; rescan a document to
            pick them up. Format rules only affect CSV / cleaned export.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="shrink-0 whitespace-nowrap"
          onClick={startCreate}
        >
          New type
        </Button>
      </div>

      <ul className="mt-4 space-y-2">
        {types.map((t) => (
          <li
            key={t.id}
            className="flex items-start justify-between gap-2 rounded-lg border border-border bg-background/60 px-3 py-2"
          >
            <div className="min-w-0">
              <div className="font-semibold">{t.label}</div>
              <div className="text-xs text-muted">
                {t.key} · {t.fields.map((f) => f.fieldKey).join(", ") || "no fields"}
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="shrink-0 whitespace-nowrap"
              onClick={() => startEdit(t)}
            >
              Edit
            </Button>
          </li>
        ))}
        {types.length === 0 ? (
          <li className="text-sm text-muted">No types yet — create one to upload.</li>
        ) : null}
      </ul>

      <Modal
        open={formOpen}
        title={creating ? "New document type" : "Edit document type"}
        onClose={cancelForm}
        className="max-w-2xl"
      >
        <div className="space-y-3">
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (e.g. Rent Agreement)"
            autoFocus
          />
          <div className="space-y-3">
            {fields.map((f, i) => (
              <FieldEditor
                key={i}
                field={f}
                canRemove={fields.length > 1}
                onChange={(patch) => updateField(i, patch)}
                onTypeChange={(type) => changeFieldType(i, type)}
                onRemove={() => setFields(fields.filter((_, j) => j !== i))}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setFields([...fields, emptyField()])}
            >
              Add field
            </Button>
            <Button type="button" size="sm" disabled={busy} onClick={save}>
              Save
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={cancelForm}>
              Cancel
            </Button>
          </div>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </div>
      </Modal>
    </section>
  );
}

function FieldEditor({
  field,
  canRemove,
  onChange,
  onTypeChange,
  onRemove,
}: {
  field: DraftField;
  canRemove: boolean;
  onChange: (patch: Partial<DraftField>) => void;
  onTypeChange: (fieldType: string) => void;
  onRemove: () => void;
}) {
  const [testInput, setTestInput] = useState(
    field.fieldType === "money" ? "123" : field.fieldType === "date" ? "2025-09-14" : "sample",
  );

  const preview = useMemo(() => {
    const steps = field.formatRules.map((rule, idx) => {
      const running =
        idx === 0
          ? testInput
          : applyFormatRules(testInput, field.formatRules.slice(0, idx));
      return { rule, result: testFormatRule(running, rule) };
    });
    return {
      output: applyFormatRules(testInput, field.formatRules),
      steps,
    };
  }, [field.formatRules, testInput]);

  function updateRule(index: number, patch: Partial<FormatRule>) {
    const next = [...field.formatRules];
    next[index] = { ...next[index]!, ...patch };
    onChange({ formatRules: next });
  }

  return (
    <div className="rounded-lg border border-border bg-background/50 p-3">
      <div className="flex flex-wrap gap-2">
        <input
          className="min-w-[10rem] flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
          value={field.fieldKey}
          onChange={(e) => onChange({ fieldKey: e.target.value })}
          placeholder="field_key"
        />
        <select
          className="rounded-md border border-border bg-background px-2 py-2 text-sm"
          value={field.fieldType}
          onChange={(e) => onTypeChange(e.target.value)}
        >
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onChange({ formatOpen: !field.formatOpen })}
        >
          Format{field.formatRules.length ? ` (${field.formatRules.length})` : ""}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={!canRemove} onClick={onRemove}>
          Remove
        </Button>
      </div>

      {field.formatOpen ? (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          {field.fieldType === "date" ? (
            <label className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">Date output</span>
              <select
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                value={dateOutputOf(field.formatRules)}
                onChange={(e) =>
                  onChange({
                    formatRules: setDateOutput(
                      field.formatRules,
                      e.target.value as DateOutputFormat,
                    ),
                  })
                }
              >
                {DATE_OUTPUTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {field.fieldType === "money" ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() =>
                  onChange({ formatRules: ensureMoneyPreset(field.formatRules, "prefix") })
                }
              >
                Ensure $
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() =>
                  onChange({ formatRules: ensureMoneyPreset(field.formatRules, "decimals") })
                }
              >
                Ensure 2 decimals
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onChange({ formatRules: moneyFormatRules() })}
              >
                Reset money presets
              </Button>
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">
              Rules (ordered)
            </div>
            {field.formatRules.length === 0 ? (
              <p className="text-xs text-muted">No format rules — raw value exported as-is.</p>
            ) : null}
            {field.formatRules.map((rule, ri) => (
              <div
                key={rule.id}
                className="space-y-2 rounded-md border border-border/80 bg-card/60 p-2"
              >
                <div className="flex flex-wrap gap-2">
                  <input
                    className="min-w-[8rem] flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
                    value={rule.name}
                    onChange={(e) => updateRule(ri, { name: e.target.value })}
                    placeholder="Name"
                  />
                  <select
                    className="rounded border border-border bg-background px-2 py-1 text-xs"
                    value={rule.kind}
                    onChange={(e) =>
                      updateRule(ri, { kind: e.target.value as FormatRuleKind })
                    }
                  >
                    {RULE_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      onChange({
                        formatRules: field.formatRules.filter((_, j) => j !== ri),
                      })
                    }
                  >
                    ×
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    className="rounded border border-border bg-background px-2 py-1 font-mono text-xs"
                    value={rule.skipIfMatch ?? ""}
                    onChange={(e) =>
                      updateRule(ri, {
                        skipIfMatch: e.target.value || undefined,
                      })
                    }
                    placeholder="skipIfMatch regex"
                  />
                  <input
                    className="rounded border border-border bg-background px-2 py-1 font-mono text-xs"
                    value={rule.onlyIfMatch ?? ""}
                    onChange={(e) =>
                      updateRule(ri, {
                        onlyIfMatch: e.target.value || undefined,
                      })
                    }
                    placeholder="onlyIfMatch regex"
                  />
                </div>
                {rule.kind === "ensure_prefix" ||
                rule.kind === "ensure_suffix" ||
                rule.kind === "regex_replace" ? (
                  <input
                    className="w-full rounded border border-border bg-background px-2 py-1 font-mono text-xs"
                    value={rule.value ?? ""}
                    onChange={(e) => updateRule(ri, { value: e.target.value })}
                    placeholder={
                      rule.kind === "regex_replace" ? "replacement" : "prefix/suffix value"
                    }
                  />
                ) : null}
                {rule.kind === "regex_replace" ? (
                  <input
                    className="w-full rounded border border-border bg-background px-2 py-1 font-mono text-xs"
                    value={rule.pattern ?? ""}
                    onChange={(e) => updateRule(ri, { pattern: e.target.value })}
                    placeholder="pattern regex"
                  />
                ) : null}
                {rule.kind === "ensure_decimals" ? (
                  <input
                    type="number"
                    min={0}
                    max={8}
                    className="w-24 rounded border border-border bg-background px-2 py-1 text-xs"
                    value={rule.decimals ?? 2}
                    onChange={(e) =>
                      updateRule(ri, { decimals: Number(e.target.value) || 2 })
                    }
                  />
                ) : null}
                {rule.kind === "date_format" ? (
                  <select
                    className="rounded border border-border bg-background px-2 py-1 text-xs"
                    value={rule.dateOutput || "YYYY-MM-DD"}
                    onChange={(e) =>
                      updateRule(ri, {
                        dateOutput: e.target.value as DateOutputFormat,
                        name: `Date → ${e.target.value}`,
                      })
                    }
                  >
                    {DATE_OUTPUTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onChange({ formatRules: [...field.formatRules, blankRule()] })}
            >
              Add rule
            </Button>
          </div>

          <div className="rounded-md border border-dashed border-border p-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">
              Test preview
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <input
                className="min-w-[10rem] flex-1 rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm"
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                placeholder="Sample raw value"
              />
              <div className="rounded-md bg-surface px-3 py-1.5 font-mono text-sm">
                → {preview.output || "(empty)"}
              </div>
            </div>
            {preview.steps.length > 0 ? (
              <ul className="mt-2 space-y-1 text-xs text-muted">
                {preview.steps.map(({ rule, result }) => (
                  <li key={rule.id}>
                    {rule.name}:{" "}
                    {result.skipped
                      ? `skipped (${result.reason || "gate"})`
                      : `→ ${result.output}`}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
