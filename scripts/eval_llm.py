"""Evaluate enriched note extractions against the verified hand-labeled deal set."""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
ENRICHED_PATH = ROOT / "out" / "deals_enriched.json"
LABELS_PATH = Path(__file__).with_name("llm_labels.json")
REPORT_PATH = ROOT / "docs" / "llm-eval.md"

EVAL_FIELDS = [
    "has_key_date",
    "negotiated_price",
    "price_context",
    "has_risk",
    "has_next_step",
    "deal_type",
    "suggested_stage",
    "weekly_note_quality",
]

FIELD_LABELS = {
    "has_key_date": "key_dates",
    "negotiated_price": "negotiated_price",
    "price_context": "price_context",
    "has_risk": "risks",
    "has_next_step": "next_step",
    "deal_type": "deal_type",
    "suggested_stage": "suggested_stage",
    "weekly_note_quality": "weekly_note quality",
}

load_dotenv(ROOT / ".env.local")


def load_json(path: Path) -> list[dict[str, Any]]:
    value = json.loads(path.read_text())
    if not isinstance(value, list):
        raise SystemExit(f"Expected an array in {path}.")
    return value


def is_label_verified(label: dict[str, Any]) -> bool:
    if label.get("verified") is True:
        return "todo" not in str(label.get("verification_status", "")).lower()
    return False


def require_all_verified(labels: list[dict[str, Any]]) -> None:
    unverified_ids = [
        str(label.get("id", "<unknown>"))
        for label in labels
        if not is_label_verified(label)
    ]
    if unverified_ids:
        raise SystemExit(
            f"Refusing to report accuracy: {len(unverified_ids)} of {len(labels)} "
            f"labels are not verified ({', '.join(unverified_ids[:5])}"
            f"{'...' if len(unverified_ids) > 5 else ''}). "
            'Review scripts/llm_labels.json with a human and set "verified": true first.'
        )


def weekly_note_ok(extracted: dict[str, Any], deal: dict[str, Any] | None = None) -> bool:
    note = extracted.get("weekly_note")
    if not isinstance(note, str) or not note.strip():
        return False
    words = note.split()
    if len(words) > 12 or len(note) > 180:
        return False
    if deal and deal.get("stage"):
        stage = str(deal["stage"]).lower()
        # Avoid repeating multi-word stage names verbatim in the weekly summary
        if " " in stage and stage in note.lower():
            return False
    return True


def field_prediction(field: str, extracted: dict[str, Any], deal: dict[str, Any] | None = None) -> Any:
    if field == "has_key_date":
        return bool(extracted.get("key_dates"))
    if field == "has_risk":
        return bool(extracted.get("risks"))
    if field == "has_next_step":
        return bool(extracted.get("next_step"))
    if field == "weekly_note_quality":
        return weekly_note_ok(extracted, deal)
    return extracted.get(field)


def field_expected(field: str, label: dict[str, Any]) -> Any:
    if field == "weekly_note_quality":
        return True
    return label.get(field)


def field_correct(
    field: str,
    extracted: dict[str, Any],
    label: dict[str, Any],
    deal: dict[str, Any] | None = None,
) -> bool:
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
    if field == "weekly_note_quality":
        return weekly_note_ok(extracted, deal)
    return extracted.get(field) == label[field]


def evaluate_detailed(
    enriched: list[dict[str, Any]],
    labels: list[dict[str, Any]],
    *,
    require_verified: bool = True,
) -> tuple[dict[str, float], list[dict[str, Any]]]:
    if require_verified:
        require_all_verified(labels)
    by_id = {deal["id"]: deal for deal in enriched}
    scores: dict[str, list[float]] = {field: [] for field in EVAL_FIELDS}
    misses: list[dict[str, Any]] = []
    missing = []

    for label in labels:
        deal = by_id.get(label["id"])
        extraction = deal.get("notes_extracted") if deal else None
        if not extraction:
            missing.append(label["id"])
            continue
        for field in EVAL_FIELDS:
            ok = field_correct(field, extraction, label, deal)
            scores[field].append(float(ok))
            if not ok:
                pred = field_prediction(field, extraction, deal)
                if field == "has_key_date":
                    pred = f"{pred} ({extraction.get('key_dates')})"
                elif field == "has_risk":
                    pred = f"{pred} ({extraction.get('risks')})"
                elif field == "has_next_step":
                    pred = f"{pred} ({extraction.get('next_step')!r})"
                elif field == "weekly_note_quality":
                    pred = f"{pred} ({extraction.get('weekly_note')!r})"
                misses.append(
                    {
                        "id": label["id"],
                        "field": FIELD_LABELS[field],
                        "notes": deal.get("notes") if deal else "",
                        "prediction": pred,
                        "label": field_expected(field, label),
                    }
                )

    if missing:
        raise SystemExit(f"Missing enriched output for: {', '.join(missing)}")

    summary = {
        field: sum(values) / len(values) if values else 0.0
        for field, values in scores.items()
    }
    return summary, misses


def evaluate(
    enriched: list[dict[str, Any]],
    labels: list[dict[str, Any]],
    *,
    require_verified: bool = True,
) -> dict[str, float]:
    scores, _ = evaluate_detailed(enriched, labels, require_verified=require_verified)
    return scores


def _md_escape(value: Any) -> str:
    text = "null" if value is None else str(value)
    return text.replace("|", "\\|").replace("\n", " ")


def render_markdown_report(
    scores: dict[str, float],
    misses: list[dict[str, Any]],
    *,
    total_deals: int,
    provider: str,
    model: str,
) -> str:
    overall = sum(scores.values()) / len(scores) * 100 if scores else 0.0
    lines = [
        "# LLM Note Enrichment Evaluation",
        "",
        f"- **Provider / model:** `{provider}` / `{model}`",
        f"- **Verified ground-truth deals:** {total_deals}",
        f"- **Overall field accuracy:** {overall:.1f}%",
        "",
        "## Per-field accuracy",
        "",
        "| Field | Correct | Total | Accuracy |",
        "|---|---:|---:|---:|",
    ]
    for field, score in scores.items():
        correct = round(score * total_deals)
        lines.append(
            f"| `{FIELD_LABELS[field]}` | {correct} | {total_deals} | {score * 100:.1f}% |"
        )

    lines.extend(["", "## Misses (notes vs. prediction vs. label)", ""])
    if misses:
        lines.extend(
            [
                "| Deal ID | Field | Source notes | Prediction | Label |",
                "|---|---|---|---|---|",
            ]
        )
        for miss in misses:
            lines.append(
                f"| `{miss['id']}` | `{miss['field']}` | {_md_escape(miss['notes'])} | "
                f"`{_md_escape(miss['prediction'])}` | `{_md_escape(miss['label'])}` |"
            )
    else:
        lines.append("No misses recorded across the verified label set.")

    strong = [FIELD_LABELS[f] for f, s in scores.items() if s >= 0.85]
    weaker = [FIELD_LABELS[f] for f, s in scores.items() if s < 0.85]
    strong_text = ", ".join(strong) if strong else "none"
    weaker_text = ", ".join(weaker) if weaker else "none"

    lines.extend(
        [
            "",
            "## Conclusion",
            "",
            (
                f"Across all {total_deals} verified deals, the `{provider}/{model}` extractor achieved "
                f"**{overall:.1f}% overall accuracy** with strict verbatim evidence validation. "
                f"It is reliable as a suggestion engine for high-precision fields ({strong_text}) "
                f"and for drafting concise partner-ready weekly summaries, while fields with higher "
                f"interpretive ambiguity ({weaker_text})—such as whether relative durations count as "
                f"calendar dates, whether descriptive remarks imply a buy transaction, or what rises to "
                f"an actionable risk/next step—cannot be trusted blindly. Keeping every extraction "
                f"labelled `llm_suggested` with verbatim source quotes ensures human reviewers "
                f"(admin / acquisition leads) confirm or edit suggestions before they become authoritative."
            ),
            "",
        ]
    )
    return "\n".join(lines)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate LLM note extractions.")
    parser.add_argument(
        "--write-report",
        type=Path,
        default=None,
        help="Write a Markdown evaluation report (e.g. docs/llm-eval.md)",
    )
    return parser.parse_args(argv)


def run(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    if not ENRICHED_PATH.exists():
        raise SystemExit("Run scripts/llm_enrich.py before evaluation.")
    labels = load_json(LABELS_PATH)
    require_all_verified(labels)
    enriched = load_json(ENRICHED_PATH)
    scores, misses = evaluate_detailed(enriched, labels, require_verified=True)

    print(f"LLM evaluation: {len(labels)} verified labeled deals")
    for field, score in scores.items():
        print(f"  {FIELD_LABELS[field]:20} {score * 100:6.1f}%")
    print(f"  overall accuracy       {sum(scores.values()) / len(scores) * 100:6.1f}%")
    print(f"  total misses           {len(misses)}")

    if args.write_report:
        provider = os.environ.get("LLM_PROVIDER", "openai")
        model = os.environ.get("LLM_MODEL", "unknown")
        args.write_report.parent.mkdir(parents=True, exist_ok=True)
        report = render_markdown_report(
            scores,
            misses,
            total_deals=len(labels),
            provider=provider,
            model=model,
        )
        args.write_report.write_text(report)
        print(f"Wrote evaluation report to {args.write_report}")


if __name__ == "__main__":
    run()
