"""Add cached LLM suggestions to normalized deal notes without changing source data."""

from __future__ import annotations

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
PROMPT_VERSION = "deal-notes-v1"
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

load_dotenv(ROOT / ".env.local")

SYSTEM_PROMPT = f"""You extract facts and concise meeting notes from commercial real-estate deal notes.
Return one structured result and use only facts supported by the supplied notes.
Never infer, overwrite, or suggest source-field values.
Year-less dates mean the next occurrence after {REFERENCE_DATE.isoformat()}.
Exact evidence quotes must be copied verbatim from notes and be valid for only the field they support.
negotiated_price is only an agreed or counter amount explicitly described as such.
Do not list generic transaction status as a risk or next step.
weekly_note must be partner-friendly, at most 12 words, and omit stage words already shown in Status.
For a deal not in Needs review, suggested_stage and suggested_stage_reason must be null."""


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


def cache_key(notes: str) -> str:
    return hashlib.sha256(f"{PROMPT_VERSION}\0{notes}".encode()).hexdigest()


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
        content = response.choices[0].message.content
        if not content:
            raise RuntimeError("OpenAI did not return structured content.")
        return json.loads(content)


def provider_from_env():
    provider = os.environ.get("LLM_PROVIDER", "").lower()
    model = os.environ.get("LLM_MODEL", "")
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


def enrich_deals(
    deals: list[dict[str, Any]],
    extract,
    cache: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    enriched = []
    stats = {"calls": 0, "cached": 0, "skipped": 0}
    for deal in deals:
        source = dict(deal)
        notes = source.get("notes")
        if not isinstance(notes, str) or not notes.strip():
            enriched.append(source)
            stats["skipped"] += 1
            continue

        key = cache_key(notes)
        if key in cache:
            extraction = cache[key]
            stats["cached"] += 1
        else:
            extraction = extract(build_prompt(source))
            stats["calls"] += 1
        extraction = normalize_yearless_dates(
            validate_extraction(
                extraction,
                notes=notes,
                stage=source.get("stage", ""),
            ),
            reference=REFERENCE_DATE,
        )
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


def run() -> None:
    deals = load_deals()
    cache_path = OUT_DIR / "llm_cache.json"
    cache = load_cache(cache_path)
    provider = provider_from_env()
    enriched, stats = enrich_deals(deals, provider.extract, cache)
    cache_path.write_text(json.dumps(cache, indent=2, sort_keys=True) + "\n")
    (OUT_DIR / "deals_enriched.json").write_text(
        json.dumps(enriched, indent=2) + "\n"
    )
    print(
        "LLM enrichment complete: "
        f"{len(enriched)} deals, {stats['calls']} API calls, "
        f"{stats['cached']} cached, {stats['skipped']} without notes"
    )


if __name__ == "__main__":
    try:
        run()
    except Exception as exc:
        print(f"LLM enrichment failed: {exc}", file=sys.stderr)
        raise
