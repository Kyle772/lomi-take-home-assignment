import OpenAI from "openai";
import type { ExpectedField } from "@lomi/shared";
import { extractWithMock } from "./mock.js";
import {
  validateExtractedFields,
  type RawExtractedField,
  type ValidatedField,
} from "./validate.js";

export interface ExtractionResult {
  fields: ValidatedField[];
  prompt: string;
  rawResponse: string;
}

function shouldUseMock(apiKey?: string): boolean {
  if (process.env.EXTRACTION_MODE === "mock") return true;
  if (process.env.EXTRACTION_MODE === "openai") return false;
  const key = apiKey || process.env.OPENAI_API_KEY || "";
  return !key || key.includes("...") || key.length < 20;
}

export function buildPrompt(
  documentTypeLabel: string,
  catalog: ExpectedField[],
  parsedText: string,
): string {
  const fieldList = catalog.map((f) => `- ${f.field} (${f.type})`).join("\n");

  return `You extract structured fields from a ${documentTypeLabel} document.

Rules:
- Return one object per expected field listed below.
- For each field provide: field, value (string or null), evidence (exact verbatim substring from the document text, or null), certainty (integer 0-100), gapReason (string or null).
- evidence MUST be copied exactly from the document text (same characters).
- If you cannot find a field, set value=null, evidence=null, certainty=0, and explain in gapReason. Never guess.
- certainty is your estimated correctness of the extraction for triage (not a substitute for evidence).

Expected fields:
${fieldList}

Document text:
"""
${parsedText}
"""`;
}

const responseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    fields: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          field: { type: "string" },
          value: { type: ["string", "null"] },
          evidence: { type: ["string", "null"] },
          certainty: { type: "number" },
          gapReason: { type: ["string", "null"] },
        },
        required: ["field", "value", "evidence", "certainty", "gapReason"],
      },
    },
  },
  required: ["fields"],
} as const;

export async function extractWithOpenAI(options: {
  documentTypeKey: string;
  documentTypeLabel: string;
  catalog: ExpectedField[];
  parsedText: string;
  apiKey?: string;
  model?: string;
}): Promise<ExtractionResult> {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  if (shouldUseMock(apiKey)) {
    return extractWithMock(
      options.documentTypeKey,
      options.catalog,
      options.parsedText,
    );
  }
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const model = options.model || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const prompt = buildPrompt(
    options.documentTypeLabel,
    options.catalog,
    options.parsedText,
  );
  const client = new OpenAI({ apiKey });

  const completion = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You are a careful document extraction engine. Never invent values. Evidence must be verbatim.",
      },
      { role: "user", content: prompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "document_extraction",
        strict: true,
        schema: responseSchema,
      },
    },
  });

  const rawResponse = completion.choices[0]?.message?.content || "{}";
  let parsed: { fields?: RawExtractedField[] };
  try {
    parsed = JSON.parse(rawResponse) as { fields?: RawExtractedField[] };
  } catch {
    throw new Error("Model returned non-JSON content");
  }

  const fields = validateExtractedFields(
    options.catalog,
    options.parsedText,
    parsed.fields || [],
  );

  return { fields, prompt, rawResponse };
}

export { validateExtractedFields };
