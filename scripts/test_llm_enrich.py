from copy import deepcopy
from datetime import date

import pytest

from llm_enrich import PROTECTED_FIELDS, enrich_deals
from llm_schema import JSON_SCHEMA, normalize_yearless_dates, validate_extraction
from eval_llm import evaluate


def extraction(**changes):
    value = {
        "key_dates": [],
        "negotiated_price": None,
        "price_context": None,
        "risks": [],
        "next_step": None,
        "deal_type": "unknown",
        "weekly_note": "Follow up with broker",
        "evidence": [],
        "confidence": 0.8,
        "suggested_stage": None,
        "suggested_stage_reason": None,
    }
    value.update(changes)
    return value


@pytest.fixture
def deal():
    return {
        "id": "food:2",
        "stage": "In Contract",
        "notes": "closing 11/25, deposit $250,000",
        "list_price": 3000000,
        "attributes": {"days_on_market": 10},
        "field_provenance": {"power_amps": "assumed"},
        "needs_review": False,
    }


def test_enrichment_preserves_source_fields_and_adds_only_suggestions(deal):
    result, stats = enrich_deals(
        [deal],
        lambda _prompt: extraction(
            key_dates=[
                {
                    "label": "Closing",
                    "date_text": "11/25",
                    "iso_guess": "2026-11-25",
                }
            ],
            price_context="deposit $250,000",
            evidence=[{"field": "price_context", "quote": "deposit $250,000"}],
        ),
        {},
    )

    assert stats == {"calls": 1, "cached": 0, "skipped": 0}
    assert result[0]["notes_extracted"]["confidence"] == 0.8
    assert result[0]["weekly_note"] == "Follow up with broker"
    assert result[0]["field_provenance"] == {
        "power_amps": "assumed",
        "notes_extracted": "llm_suggested",
        "weekly_note": "llm_suggested",
    }
    for field in PROTECTED_FIELDS:
        assert result[0].get(field) == deal.get(field)


def test_cache_reuses_extraction_without_provider_call(deal):
    calls = []
    cache = {}

    enrich_deals([deal], lambda prompt: calls.append(prompt) or extraction(), cache)
    _, stats = enrich_deals(
        [deal],
        lambda _prompt: pytest.fail("provider called on cache hit"),
        cache,
    )

    assert len(calls) == 1
    assert stats == {"calls": 0, "cached": 1, "skipped": 0}


def test_empty_notes_are_unchanged(deal):
    deal["notes"] = "  "
    result, stats = enrich_deals([deal], pytest.fail, {})

    assert result == [deal]
    assert stats == {"calls": 0, "cached": 0, "skipped": 1}


def test_yearless_date_resolves_to_next_occurrence():
    result = normalize_yearless_dates(
        extraction(
            key_dates=[
                {
                    "label": "Closing",
                    "date_text": "11/25",
                    "iso_guess": "2025-11-25",
                },
                {
                    "label": "Due diligence",
                    "date_text": "9/18",
                    "iso_guess": "2026-09-18",
                },
            ]
        ),
        reference=date(2026, 11, 18),
    )

    assert result["key_dates"][0]["iso_guess"] == "2026-11-25"
    assert result["key_dates"][1]["iso_guess"] == "2027-09-18"


def test_validation_rejects_unquoted_evidence():
    with pytest.raises(ValueError, match="exact substrings"):
        validate_extraction(
            extraction(
                evidence=[{"field": "next_step", "quote": "seller will respond tomorrow"}],
            ),
            notes="awaiting seller response",
            stage="In Pipeline",
        )


def test_validation_rejects_stage_suggestion_for_normalized_deal():
    with pytest.raises(ValueError, match="Only Needs review"):
        validate_extraction(
            extraction(
                suggested_stage="In Pipeline",
                suggested_stage_reason="Search underway",
            ),
            notes="search underway",
            stage="Sourcing",
        )


def test_validation_rejects_long_weekly_note():
    with pytest.raises(ValueError, match="12 words"):
        validate_extraction(
            extraction(weekly_note=" ".join(["word"] * 13)),
            notes="word",
            stage="Sourcing",
        )


def test_source_object_is_not_mutated(deal):
    original = deepcopy(deal)
    enrich_deals([deal], lambda _prompt: extraction(), {})

    assert deal == original


def test_evaluation_reports_per_field_scores():
    extracted = extraction(
        negotiated_price=3000000,
        price_context="agreed to $3M",
        key_dates=[
            {"label": "Closing", "date_text": "11/25", "iso_guess": "2026-11-25"}
        ],
        risks=["Permit timing"],
        next_step="Finalize terms",
        deal_type="buy",
        suggested_stage=None,
    )
    labels = [
        {
            "id": "deal:1",
            "verified": True,
            "deal_type": "buy",
            "negotiated_price": 3000000,
            "price_context": "agreed to $3M",
            "has_key_date": True,
            "has_risk": True,
            "has_next_step": True,
            "suggested_stage": None,
        }
    ]
    scores = evaluate(
        [{"id": "deal:1", "notes_extracted": extracted}],
        labels,
    )

    assert scores
    assert set(scores.values()) == {1.0}


def test_evaluate_refuses_unverified_labels():
    with pytest.raises(SystemExit, match="Refusing to report accuracy"):
        evaluate(
            [{"id": "deal:1", "notes_extracted": extraction()}],
            [
                {
                    "id": "deal:1",
                    "verification_status": "TODO verify",
                    "deal_type": "unknown",
                    "negotiated_price": None,
                    "price_context": None,
                    "has_key_date": False,
                    "has_risk": False,
                    "has_next_step": False,
                    "suggested_stage": None,
                }
            ],
        )


def test_json_schema_is_openai_strict_mode_compatible():
    """Validate every node in JSON_SCHEMA against OpenAI Structured Outputs strict rules."""
    unsupported_keywords = {
        "minLength",
        "maxLength",
        "pattern",
        "format",
        "minimum",
        "maximum",
        "exclusiveMinimum",
        "exclusiveMaximum",
        "multipleOf",
        "minItems",
        "maxItems",
        "uniqueItems",
        "patternProperties",
        "additionalItems",
        "minProperties",
        "maxProperties",
    }

    assert JSON_SCHEMA["type"] == "object"
    assert JSON_SCHEMA["properties"]["evidence"]["type"] == "array"
    evidence_item = JSON_SCHEMA["properties"]["evidence"]["items"]
    assert evidence_item["type"] == "object"
    assert set(evidence_item["properties"]) == {"field", "quote"}
    assert evidence_item["additionalProperties"] is False
    assert set(evidence_item["required"]) == {"field", "quote"}

    def check_node(node: dict, path: str) -> None:
        bad = set(node) & unsupported_keywords
        assert not bad, f"Unsupported OpenAI strict keyword(s) at {path}: {bad}"

        if node.get("type") == "object":
            assert node.get("additionalProperties") is False, (
                f"Object at {path} must set additionalProperties: False"
            )
            props = node.get("properties")
            assert isinstance(props, dict), f"Object at {path} must define properties"
            required = node.get("required")
            assert isinstance(required, list), f"Object at {path} must define required"
            assert set(required) == set(props), (
                f"Object at {path} must require every property: "
                f"required={set(required)} vs properties={set(props)}"
            )
            for key, child in props.items():
                check_node(child, f"{path}.{key}")

        if "items" in node and isinstance(node["items"], dict):
            check_node(node["items"], f"{path}[]")

        for combinator in ("anyOf", "oneOf", "allOf"):
            if combinator in node:
                for idx, branch in enumerate(node[combinator]):
                    check_node(branch, f"{path}.{combinator}[{idx}]")

    check_node(JSON_SCHEMA, "$")
