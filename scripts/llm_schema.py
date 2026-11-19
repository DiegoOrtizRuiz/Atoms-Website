"""Validation and date normalization for additive deal-note enrichment."""

from __future__ import annotations

import re
from datetime import date
from typing import Any

STAGES = [
    "Sourcing",
    "In Pipeline",
    "Pre LOI",
    "Negotiating LOI",
    "Negotiating PSA",
    "In Contract",
    "Closed",
    "On Hold",
]

JSON_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "key_dates": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "label": {"type": "string"},
                    "date_text": {"type": "string"},
                    "iso_guess": {"type": ["string", "null"]},
                },
                "required": ["label", "date_text", "iso_guess"],
            },
        },
        "negotiated_price": {"type": ["number", "null"]},
        "price_context": {"type": ["string", "null"]},
        "risks": {"type": "array", "items": {"type": "string"}},
        "next_step": {"type": ["string", "null"]},
        "deal_type": {"type": "string", "enum": ["buy", "lease", "unknown"]},
        "weekly_note": {"type": "string", "maxLength": 180},
        "evidence": {
            "type": "object",
            "additionalProperties": {"type": "string"},
        },
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "suggested_stage": {"type": ["string", "null"], "enum": [*STAGES, None]},
        "suggested_stage_reason": {"type": ["string", "null"]},
    },
    "required": [
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
}


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def validate_extraction(value: Any, *, notes: str, stage: str) -> dict[str, Any]:
    _require(isinstance(value, dict), "LLM response must be a JSON object.")
    _require(
        set(value) == set(JSON_SCHEMA["required"]),
        "LLM response fields do not match the required schema.",
    )
    key_dates = value["key_dates"]
    _require(isinstance(key_dates, list), "key_dates must be an array.")
    for item in key_dates:
        _require(
            isinstance(item, dict)
            and set(item) == {"label", "date_text", "iso_guess"}
            and isinstance(item["label"], str)
            and isinstance(item["date_text"], str)
            and (item["iso_guess"] is None or isinstance(item["iso_guess"], str)),
            "Each key date must contain label, date_text, and iso_guess.",
        )

    negotiated = value["negotiated_price"]
    _require(
        negotiated is None
        or (isinstance(negotiated, (int, float)) and not isinstance(negotiated, bool)),
        "negotiated_price must be numeric or null.",
    )
    _require(
        value["deal_type"] in {"buy", "lease", "unknown"},
        "deal_type is invalid.",
    )
    _require(
        isinstance(value["risks"], list)
        and all(isinstance(item, str) for item in value["risks"]),
        "risks must contain only strings.",
    )
    for field in ("price_context", "next_step", "suggested_stage_reason"):
        _require(
            value[field] is None or isinstance(value[field], str),
            f"{field} must be a string or null.",
        )
    _require(isinstance(value["weekly_note"], str), "weekly_note must be a string.")
    _require(
        len(value["weekly_note"].split()) <= 12,
        "weekly_note must contain no more than 12 words.",
    )
    _require(
        isinstance(value["evidence"], dict)
        and all(
            isinstance(key, str) and isinstance(quote, str)
            for key, quote in value["evidence"].items()
        ),
        "evidence must map field names to strings.",
    )
    for quote in value["evidence"].values():
        _require(quote in notes, "Evidence quotes must be exact substrings of notes.")
    _require(
        isinstance(value["confidence"], (int, float))
        and not isinstance(value["confidence"], bool)
        and 0 <= value["confidence"] <= 1,
        "confidence must be between 0 and 1.",
    )
    _require(
        value["suggested_stage"] is None or value["suggested_stage"] in STAGES,
        "suggested_stage is invalid.",
    )
    if stage != "Needs review":
        _require(
            value["suggested_stage"] is None
            and value["suggested_stage_reason"] is None,
            "Only Needs review deals can receive a stage suggestion.",
        )
    return value


def normalize_yearless_dates(
    extraction: dict[str, Any], *, reference: date
) -> dict[str, Any]:
    result = {**extraction}
    normalized_dates = []
    for item in extraction["key_dates"]:
        normalized = {**item}
        date_text = item["date_text"]
        if not re.search(r"\b(?:19|20)\d{2}\b", date_text):
            match = re.search(r"\b(\d{1,2})[/-](\d{1,2})\b", date_text)
            if match:
                month, day = map(int, match.groups())
                year = reference.year
                try:
                    candidate = date(year, month, day)
                    if candidate <= reference:
                        candidate = date(year + 1, month, day)
                    normalized["iso_guess"] = candidate.isoformat()
                except ValueError:
                    normalized["iso_guess"] = None
        normalized_dates.append(normalized)
    result["key_dates"] = normalized_dates
    return result
