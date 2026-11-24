import "server-only";

import { createHash } from "node:crypto";
import type { Json } from "@/lib/database.types";
import { STAGES } from "@/lib/import/status-map";

const PROMPT_VERSION = "deal-notes-v2";
const REFERENCE_DATE_ISO = "2026-11-18";

// OpenAI Structured Outputs (strict: true) compatible JSON Schema (identical to scripts/llm_schema.py)
export const DEAL_EXTRACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    key_dates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          date_text: { type: "string" },
          iso_guess: { type: ["string", "null"] },
        },
        required: ["label", "date_text", "iso_guess"],
      },
    },
    negotiated_price: { type: ["number", "null"] },
    price_context: { type: ["string", "null"] },
    risks: { type: "array", items: { type: "string" } },
    next_step: { type: ["string", "null"] },
    deal_type: { type: "string", enum: ["buy", "lease", "unknown"] },
    weekly_note: { type: "string" },
    evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          field: { type: "string" },
          quote: { type: "string" },
        },
        required: ["field", "quote"],
      },
    },
    confidence: { type: "number" },
    suggested_stage: {
      anyOf: [{ type: "string", enum: [...STAGES] }, { type: "null" }],
    },
    suggested_stage_reason: { type: ["string", "null"] },
  },
  required: [
    "key_dates",
    "negotiated_price",
    "price_context",
    "risks",
    "next_step",
    "deal_type",
    "weekly_note",
    "evidence",
    "confidence",
    "suggested_stage",
    "suggested_stage_reason",
  ],
} as const;

const SYSTEM_PROMPT = `You extract facts and concise meeting notes from commercial real-estate deal notes.
Return one structured result matching the JSON schema and use only facts supported by the supplied notes.
Never infer, overwrite, or suggest source-field values.
Year-less dates mean the next occurrence after ${REFERENCE_DATE_ISO}.
evidence must be an array of {"field": "<field_name>", "quote": "<exact verbatim substring from notes>"} objects; every quote must appear verbatim inside the supplied notes (exact spelling and capitalization).
Include evidence entries for each populated extracted field (such as key_dates, negotiated_price, price_context, risks, next_step, deal_type, weekly_note).
negotiated_price is only an agreed, counter, or best-and-final purchase amount explicitly described as such (not rent or deposits).
Do not list generic transaction status as a risk or next step.
weekly_note must be partner-friendly, at most 12 words, and omit stage words already shown in Status.
For a deal not in Needs review, suggested_stage and suggested_stage_reason must be null.`;

// Per-process in-memory cache and per-user rate limiter (5 requests / 60s)
const extractionCache = new Map<string, Record<string, Json>>();
const rateLimitWindowMs = 60_000;
const rateLimitMaxCalls = 5;
const userTimestamps = new Map<string, number[]>();

export function checkUserRateLimit(
  userId: string,
  nowMs = Date.now(),
): { allowed: true } | { allowed: false; retryAfterSec: number } {
  const recent = (userTimestamps.get(userId) ?? []).filter(
    (ts) => nowMs - ts < rateLimitWindowMs,
  );
  if (recent.length >= rateLimitMaxCalls) {
    const oldest = recent[0];
    const retryAfterSec = Math.max(
      1,
      Math.ceil((rateLimitWindowMs - (nowMs - oldest)) / 1000),
    );
    userTimestamps.set(userId, recent);
    return { allowed: false, retryAfterSec };
  }
  recent.push(nowMs);
  userTimestamps.set(userId, recent);
  return { allowed: true };
}

export function resetRateLimiterForTests() {
  userTimestamps.clear();
  extractionCache.clear();
}

export function llmProviderConfig():
  | { configured: true; provider: "openai" | "anthropic"; model: string; apiKey: string }
  | { configured: false; message: string } {
  const provider = (process.env.LLM_PROVIDER ?? "").trim().toLowerCase();
  const model = (process.env.LLM_MODEL ?? "").trim();

  if (provider === "openai") {
    const apiKey = (process.env.OPENAI_API_KEY ?? "").trim();
    if (!apiKey || !model) {
      return {
        configured: false,
        message:
          "AI regeneration is unavailable: OPENAI_API_KEY or LLM_MODEL is not configured on the server.",
      };
    }
    return { configured: true, provider: "openai", model, apiKey };
  }

  if (provider === "anthropic") {
    const apiKey = (process.env.ANTHROPIC_API_KEY ?? "").trim();
    if (!apiKey || !model) {
      return {
        configured: false,
        message:
          "AI regeneration is unavailable: ANTHROPIC_API_KEY or LLM_MODEL is not configured on the server.",
      };
    }
    return { configured: true, provider: "anthropic", model, apiKey };
  }

  return {
    configured: false,
    message:
      "AI regeneration is unavailable because no LLM provider key (LLM_PROVIDER / LLM_MODEL) is configured on the server.",
  };
}

function normalizeYearlessIso(dateText: string, existingIso: string | null): string | null {
  if (/\b(?:19|20)\d{2}\b/.test(dateText)) return existingIso;
  const match = /\b(\d{1,2})[/-](\d{1,2})\b/.exec(dateText);
  if (!match) return existingIso;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const ref = new Date(`${REFERENCE_DATE_ISO}T00:00:00Z`);
  let year = ref.getUTCFullYear();
  let candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  if (candidate.getTime() <= ref.getTime()) {
    year += 1;
    candidate = new Date(Date.UTC(year, month - 1, day));
  }
  return candidate.toISOString().slice(0, 10);
}

function validateAndNormalizeExtraction(
  raw: unknown,
  notes: string,
  stage: string,
): Record<string, Json> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("LLM did not return a JSON object.");
  }
  const obj = raw as Record<string, unknown>;
  const weeklyNote = typeof obj.weekly_note === "string" ? obj.weekly_note.trim() : "";
  if (!weeklyNote || weeklyNote.split(/\s+/).length > 12 || weeklyNote.length > 180) {
    throw new Error("LLM returned an invalid weekly_note (must be 1–12 words).");
  }
  const evidenceRaw = Array.isArray(obj.evidence) ? obj.evidence : [];
  const evidence = evidenceRaw.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const e = entry as { field?: unknown; quote?: unknown };
    if (typeof e.field !== "string" || typeof e.quote !== "string" || !e.quote) {
      return [];
    }
    if (!notes.includes(e.quote)) {
      throw new Error(`Evidence quote not found verbatim in notes: ${e.quote}`);
    }
    return [{ field: e.field, quote: e.quote }];
  });

  const keyDates = Array.isArray(obj.key_dates)
    ? obj.key_dates.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const d = item as { label?: unknown; date_text?: unknown; iso_guess?: unknown };
        if (typeof d.label !== "string" || typeof d.date_text !== "string") return [];
        const iso = normalizeYearlessIso(
          d.date_text,
          typeof d.iso_guess === "string" ? d.iso_guess : null,
        );
        return [{ label: d.label, date_text: d.date_text, iso_guess: iso }];
      })
    : [];

  const confidence =
    typeof obj.confidence === "number" &&
    Number.isFinite(obj.confidence) &&
    obj.confidence >= 0 &&
    obj.confidence <= 1
      ? obj.confidence
      : 0.5;

  const suggestedStage =
    stage === "Needs review" &&
    typeof obj.suggested_stage === "string" &&
    (STAGES as readonly string[]).includes(obj.suggested_stage)
      ? obj.suggested_stage
      : null;

  return {
    key_dates: keyDates,
    negotiated_price:
      typeof obj.negotiated_price === "number" && Number.isFinite(obj.negotiated_price)
        ? obj.negotiated_price
        : null,
    price_context: typeof obj.price_context === "string" ? obj.price_context : null,
    risks: Array.isArray(obj.risks)
      ? obj.risks.filter((r): r is string => typeof r === "string")
      : [],
    next_step: typeof obj.next_step === "string" ? obj.next_step : null,
    deal_type:
      obj.deal_type === "buy" || obj.deal_type === "lease" ? obj.deal_type : "unknown",
    weekly_note: weeklyNote,
    evidence,
    confidence,
    suggested_stage: suggestedStage,
    suggested_stage_reason:
      suggestedStage && typeof obj.suggested_stage_reason === "string"
        ? obj.suggested_stage_reason
        : null,
  };
}

export async function generateDealSuggestion(input: {
  dealId: string;
  stage: string;
  notes: string;
  bypassCache?: boolean;
}): Promise<
  | {
      ok: true;
      extraction: Record<string, Json>;
      weeklyNote: string;
      cached: boolean;
      provider: string;
      model: string;
    }
  | { ok: false; configured: boolean; message: string }
> {
  const trimmedNotes = input.notes.trim();
  if (!trimmedNotes) {
    return {
      ok: false,
      configured: true,
      message: "This deal has no notes to summarize.",
    };
  }

  const config = llmProviderConfig();
  if (!config.configured) {
    return { ok: false, configured: false, message: config.message };
  }

  const cacheKey = createHash("sha256")
    .update(`${PROMPT_VERSION}\0${input.stage}\0${trimmedNotes}`)
    .digest("hex");

  if (!input.bypassCache && extractionCache.has(cacheKey)) {
    const cached = extractionCache.get(cacheKey)!;
    return {
      ok: true,
      extraction: cached,
      weeklyNote: String(cached.weekly_note ?? ""),
      cached: true,
      provider: config.provider,
      model: config.model,
    };
  }

  const stageInstruction =
    input.stage === "Needs review"
      ? "The stage is Needs review. Suggest one of the eight funnel stages only when the notes support it; otherwise return null, with a reason."
      : "The stage is already normalized. Do not suggest a different stage.";

  const userPrompt = `Deal id: ${input.dealId}\nCurrent stage: ${input.stage}\nNotes:\n${trimmedNotes}\n\n${stageInstruction}`;

  let rawResult: unknown;
  if (config.provider === "openai") {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "deal_note_extraction",
            strict: true,
            schema: DEAL_EXTRACTION_JSON_SCHEMA,
          },
        },
      }),
      cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.text();
      return {
        ok: false,
        configured: true,
        message: `OpenAI request failed (HTTP ${response.status}): ${body.slice(0, 180)}`,
      };
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      return { ok: false, configured: true, message: "OpenAI returned empty content." };
    }
    rawResult = JSON.parse(content);
  } else {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 1600,
        system: SYSTEM_PROMPT,
        tools: [
          {
            name: "record_extraction",
            description: "Record verified facts and suggestions from the notes.",
            input_schema: DEAL_EXTRACTION_JSON_SCHEMA,
          },
        ],
        tool_choice: { type: "tool", name: "record_extraction" },
        messages: [{ role: "user", content: userPrompt }],
      }),
      cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.text();
      return {
        ok: false,
        configured: true,
        message: `Anthropic request failed (HTTP ${response.status}): ${body.slice(0, 180)}`,
      };
    }
    const payload = (await response.json()) as {
      content?: Array<{ type?: string; input?: unknown }>;
    };
    const toolBlock = payload.content?.find((block) => block.type === "tool_use");
    if (!toolBlock) {
      return {
        ok: false,
        configured: true,
        message: "Anthropic did not return structured tool output.",
      };
    }
    rawResult = toolBlock.input;
  }

  const normalized = validateAndNormalizeExtraction(rawResult, trimmedNotes, input.stage);
  extractionCache.set(cacheKey, normalized);

  return {
    ok: true,
    extraction: normalized,
    weeklyNote: String(normalized.weekly_note ?? ""),
    cached: false,
    provider: config.provider,
    model: config.model,
  };
}
