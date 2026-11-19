"""Evaluate enriched note extractions against the hand-labeled deal set."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
ENRICHED_PATH = ROOT / "out" / "deals_enriched.json"
LABELS_PATH = Path(__file__).with_name("llm_labels.json")


def load_json(path: Path) -> list[dict[str, Any]]:
    value = json.loads(path.read_text())
    if not isinstance(value, list):
        raise SystemExit(f"Expected an array in {path}.")
    return value


def field_correct(field: str, extracted: dict[str, Any], label: dict[str, Any]) -> bool:
    if field == "negotiated_price":
        expected = label["negotiated_price"]
        actual = extracted.get("negotiated_price")
        return actual is None if expected is None else (
            actual is not None and math.isclose(actual, expected, rel_tol=0.01)
        )
    if field == "price_context":
        if label["price_context"] is None:
            return extracted.get("price_context") is None
        return bool(
            extracted.get("price_context")
            and label["price_context"].lower()
            in str(extracted["price_context"]).lower()
        )
    if field == "has_key_date":
        return bool(extracted.get("key_dates")) is label[field]
    if field == "has_risk":
        return bool(extracted.get("risks")) is label[field]
    if field == "has_next_step":
        return bool(extracted.get("next_step")) is label[field]
    return extracted.get(field) == label[field]


def evaluate(
    enriched: list[dict[str, Any]], labels: list[dict[str, Any]]
) -> dict[str, float]:
    by_id = {deal["id"]: deal for deal in enriched}
    fields = [
        "deal_type",
        "negotiated_price",
        "price_context",
        "has_key_date",
        "has_risk",
        "has_next_step",
        "suggested_stage",
    ]
    scores = {field: [] for field in fields}
    missing = []
    for label in labels:
        deal = by_id.get(label["id"])
        extraction = deal.get("notes_extracted") if deal else None
        if not extraction:
            missing.append(label["id"])
            continue
        for field in fields:
            scores[field].append(float(field_correct(field, extraction, label)))
    if missing:
        raise SystemExit(f"Missing enriched output for: {', '.join(missing)}")
    return {
        field: sum(values) / len(values) if values else 0
        for field, values in scores.items()
    }


def run() -> None:
    if not ENRICHED_PATH.exists():
        raise SystemExit("Run scripts/llm_enrich.py before evaluation.")
    scores = evaluate(load_json(ENRICHED_PATH), load_json(LABELS_PATH))
    labels = load_json(LABELS_PATH)
    unverified = sum(label.get("verification_status") != "verified" for label in labels)
    print(f"LLM evaluation: {len(labels)} labeled deals ({unverified} TODO verify)")
    for field, score in scores.items():
        print(f"  {field:20} {score * 100:6.1f}%")
    print(f"  overall accuracy       {sum(scores.values()) / len(scores) * 100:6.1f}%")


if __name__ == "__main__":
    run()
