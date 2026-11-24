"""Add cached LLM suggestions to normalized deal notes without changing source data."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import date
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from llm_schema import JSON_SCHEMA, normalize_yearless_dates, validate_extraction

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "out"
PROMPT_VERSION = "deal-notes-v2"
REFERENCE_DATE = date(2026, 11, 18)
PROTECTED_FIELDS = {
    "id",
    "source_tab",
    "source_row",
    "vertical",
    "client",
    "market",
    "city",
    "state",
    "state_inferred",
    "address",
    "stage",
    "stage_raw",
    "bldg_sf",
    "list_price",
    "lot_sf",
    "broker",
    "broker_phone",
    "notes",
    "attributes",
    "attributes_raw",
    "needs_review",
    "review_reasons",
}

# Approximate per-million-token USD pricing for reporting (input, output).
MODEL_PRICING_PER_M: dict[str, tuple[float, float]] = {
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4o": (2.50, 10.00),
    "gpt-4.1-mini": (0.40, 1.60),
    "gpt-4.1-nano": (0.10, 0.40),
    "gpt-4.1": (2.00, 8.00),
    "gpt-5-mini": (0.25, 2.00),
    "gpt-5-nano": (0.05, 0.40),
    "claude-3-5-haiku-latest": (0.80, 4.00),
    "claude-3-5-sonnet-latest": (3.00, 15.00),
    "claude-sonnet-4-20250514": (3.00, 15.00),
}

load_dotenv(ROOT / ".env.local")

SYSTEM_PROMPT = f"""You extract facts and concise meeting notes from commercial real-estate deal notes.
Return one structured result matching the JSON schema and use only facts supported by the supplied notes.
Never infer, overwrite, or suggest source-field values.
Year-less dates mean the next occurrence after {REFERENCE_DATE.isoformat()}.
evidence must be an array of {{"field": "<field_name>", "quote": "<exact verbatim substring from notes>"}} objects; every quote must appear verbatim inside the supplied notes (exact spelling and capitalization).
Include evidence entries for each populated extracted field (such as key_dates, negotiated_price, price_context, risks, next_step, deal_type, weekly_note).
negotiated_price is only an agreed, counter, or best-and-final purchase amount explicitly described as such (not rent or deposits).
Do not list generic transaction status as a risk or next step.
weekly_note must be partner-friendly, at most 12 words, and omit stage words already shown in Status.
For a deal not in Needs review, suggested_stage and suggested_stage_reason must be null."""


def estimate_cost_usd(model: str, input_tokens: int, output_tokens: int) -> float | None:
    key = model.lower()
    for prefix, (in_rate, out_rate) in MODEL_PRICING_PER_M.items():
        if key == prefix or key.startswith(prefix):
            return (input_tokens * in_rate + output_tokens * out_rate) / 1_000_000
    return None


def load_deals(path: Path = OUT_DIR / "deals.json") -> list[dict[str, Any]]:
    try:
        data = json.loads(path.read_text())
    except FileNotFoundError as exc:
        raise SystemExit(f"Normalized deals not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid deals JSON: {exc}") from exc
    if not isinstance(data, list) or not all(isinstance(row, dict) for row in data):
        raise SystemExit("out/deals.json must contain an array of deal objects.")
    return data


def load_cache(path: Path = OUT_DIR / "llm_cache.json") -> dict[str, Any]:
    if not path.exists():
        return {}
    data = json.loads(path.read_text())
    if not isinstance(data, dict):
        raise ValueError("LLM cache must be a JSON object.")
    return data


def cache_key(notes: str, stage: str = "") -> str:
    return hashlib.sha256(f"{PROMPT_VERSION}\0{stage}\0{notes}".encode()).hexdigest()


def build_prompt(deal: dict[str, Any]) -> str:
    stage_instruction = (
        "The stage is Needs review. Suggest one of the eight funnel stages only when the notes support it; otherwise return null, with a reason."
        if deal.get("stage") == "Needs review"
        else "The stage is already normalized. Do not suggest a different stage."
    )
    return (
        f"Deal id: {deal['id']}\n"
        f"Current stage: {deal.get('stage')}\n"
        f"Notes:\n{deal['notes']}\n\n"
        f"{stage_instruction}"
    )


class AnthropicProvider:
    def __init__(self, model: str):
        try:
            from anthropic import Anthropic
        except ImportError as exc:
            raise SystemExit(
                "Missing Anthropic dependency. Install scripts/requirements.txt."
            ) from exc
        self.client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
        self.model = model
        self.name = "anthropic"
        self.input_tokens = 0
        self.output_tokens = 0

    def extract(self, prompt: str) -> dict[str, Any]:
        response = self.client.messages.create(
            model=self.model,
            max_tokens=1600,
            system=SYSTEM_PROMPT,
            tools=[
                {
                    "name": "record_extraction",
                    "description": "Record verified facts and suggestions from the notes.",
                    "input_schema": JSON_SCHEMA,
                }
            ],
            tool_choice={"type": "tool", "name": "record_extraction"},
            messages=[{"role": "user", "content": prompt}],
        )
        usage = getattr(response, "usage", None)
        if usage is not None:
            self.input_tokens += int(getattr(usage, "input_tokens", 0) or 0)
            self.output_tokens += int(getattr(usage, "output_tokens", 0) or 0)
        for block in response.content:
            if block.type == "tool_use":
                return block.input
        raise RuntimeError("Anthropic did not return the required structured tool result.")


class OpenAIProvider:
    def __init__(self, model: str):
        try:
            from openai import OpenAI
        except ImportError as exc:
            raise SystemExit(
                "Missing OpenAI dependency. Install scripts/requirements.txt."
            ) from exc
        self.client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
        self.model = model
        self.name = "openai"
        self.input_tokens = 0
        self.output_tokens = 0

    def extract(self, prompt: str) -> dict[str, Any]:
        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "deal_note_extraction",
                    "strict": True,
                    "schema": JSON_SCHEMA,
                },
            },
        )
        usage = getattr(response, "usage", None)
        if usage is not None:
            self.input_tokens += int(getattr(usage, "prompt_tokens", 0) or 0)
            self.output_tokens += int(getattr(usage, "completion_tokens", 0) or 0)
        content = response.choices[0].message.content
        if not content:
            raise RuntimeError("OpenAI did not return structured content.")
        return json.loads(content)


def provider_from_env(
    provider_override: str | None = None,
    model_override: str | None = None,
):
    provider = (provider_override or os.environ.get("LLM_PROVIDER", "")).strip().lower()
    model = (model_override or os.environ.get("LLM_MODEL", "")).strip()
    if provider not in {"anthropic", "openai"}:
        raise SystemExit("Set LLM_PROVIDER to anthropic or openai.")
    if not model:
        raise SystemExit("Set LLM_MODEL to the provider model name.")
    if provider == "anthropic":
        if not os.environ.get("ANTHROPIC_API_KEY"):
            raise SystemExit("ANTHROPIC_API_KEY is required for Anthropic enrichment.")
        return AnthropicProvider(model)
    if not os.environ.get("OPENAI_API_KEY"):
        raise SystemExit("OPENAI_API_KEY is required for OpenAI enrichment.")
    return OpenAIProvider(model)


def _extract_with_retry(extract, prompt: str, *, notes: str, stage: str) -> tuple[dict[str, Any], int]:
    """Call extract and validate; if schema/substring check fails, retry once with feedback."""
    raw = extract(prompt)
    calls = 1
    try:
        return validate_extraction(raw, notes=notes, stage=stage), calls
    except ValueError as first_err:
        retry_prompt = (
            f"{prompt}\n\n"
            f"Previous output failed validation ({first_err}). "
            "Fix this strictly: ensure weekly_note has <= 12 words and every evidence quote "
            "is an exact verbatim substring copied from Notes."
        )
        raw_retry = extract(retry_prompt)
        calls += 1
        return validate_extraction(raw_retry, notes=notes, stage=stage), calls


def enrich_deals(
    deals: list[dict[str, Any]],
    extract,
    cache: dict[str, Any],
    *,
    limit: int | None = None,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    enriched = []
    stats = {"calls": 0, "cached": 0, "skipped": 0}
    processed = 0
    for deal in deals:
        source = dict(deal)
        notes = source.get("notes")
        if not isinstance(notes, str) or not notes.strip():
            enriched.append(source)
            stats["skipped"] += 1
            continue
        if limit is not None and processed >= limit:
            enriched.append(source)
            stats["skipped"] += 1
            continue

        processed += 1
        stage = str(source.get("stage", ""))
        key = cache_key(notes, stage)
        if key in cache:
            extraction = validate_extraction(cache[key], notes=notes, stage=stage)
            stats["cached"] += 1
        else:
            extraction, used_calls = _extract_with_retry(
                extract, build_prompt(source), notes=notes, stage=stage
            )
            stats["calls"] += used_calls

        extraction = normalize_yearless_dates(extraction, reference=REFERENCE_DATE)
        cache[key] = extraction

        source["notes_extracted"] = extraction
        source["weekly_note"] = extraction["weekly_note"]
        provenance = dict(source.get("field_provenance") or {})
        provenance.update(
            {
                "notes_extracted": "llm_suggested",
                "weekly_note": "llm_suggested",
            }
        )
        source["field_provenance"] = provenance
        enriched.append(source)

        for field in PROTECTED_FIELDS:
            if source.get(field) != deal.get(field):
                raise AssertionError(f"Enrichment changed protected field {field} on {deal['id']}.")

    return enriched, stats


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Enrich normalized deal notes with an LLM.")
    parser.add_argument("--provider", help="Override LLM_PROVIDER (openai or anthropic)")
    parser.add_argument("--model", help="Override LLM_MODEL")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print prompts without making provider calls or writing output files",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Maximum number of deals with notes to process",
    )
    return parser.parse_args(argv)


def run(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    deals = load_deals()
    if args.dry_run:
        print("=== SYSTEM PROMPT ===")
        print(SYSTEM_PROMPT)
        print()
        shown = 0
        for deal in deals:
            notes = deal.get("notes")
            if not isinstance(notes, str) or not notes.strip():
                continue
            if args.limit is not None and shown >= args.limit:
                break
            shown += 1
            print(f"--- PROMPT {shown}: {deal['id']} ---")
            print(build_prompt(deal))
            print()
        print(f"Dry run complete: {shown} prompt(s) printed, 0 provider calls made.")
        return

    cache_path = OUT_DIR / "llm_cache.json"
    cache = load_cache(cache_path)
    provider = provider_from_env(args.provider, args.model)
    enriched, stats = enrich_deals(deals, provider.extract, cache, limit=args.limit)
    cache_path.write_text(json.dumps(cache, indent=2, sort_keys=True) + "\n")
    (OUT_DIR / "deals_enriched.json").write_text(
        json.dumps(enriched, indent=2) + "\n"
    )

    total_tokens = provider.input_tokens + provider.output_tokens
    est_cost = estimate_cost_usd(
        provider.model, provider.input_tokens, provider.output_tokens
    )
    cost_str = f"${est_cost:.6f}" if est_cost is not None else "n/a"
    print(
        f"LLM enrichment complete ({provider.name}/{provider.model}): "
        f"{len(enriched)} deals, {stats['calls']} API calls, "
        f"{stats['cached']} cached, {stats['skipped']} skipped | "
        f"tokens: {provider.input_tokens} in + {provider.output_tokens} out = {total_tokens} total "
        f"(est. cost {cost_str})"
    )


if __name__ == "__main__":
    try:
        run()
    except Exception as exc:
        print(f"LLM enrichment failed: {exc}", file=sys.stderr)
        raise
