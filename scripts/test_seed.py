from datetime import UTC, date, datetime

import pytest

from seed import (
    STAGES,
    activity_rows,
    demo_users,
    missing_vertical_configs,
    prepare_deals,
    prepare_contacts,
    preserve_deal_creation_dates,
)


@pytest.fixture
def deals():
    return [
        {
            "id": "food:2",
            "vertical": "Food",
            "client": "Client A",
            "market": "Chicago",
            "stage": "Sourcing",
            "attributes": {},
            "assumed_fields": ["market"],
            "price_per_sf": 20,
            "price_per_lot_sf": 4,
        },
        {
            "id": "food:3",
            "vertical": "Food",
            "client": "Client B",
            "market": "Chicago",
            "stage": "Sourcing",
            "attributes": {},
            "assumed_fields": [],
        },
        {
            "id": "av:2",
            "vertical": "Autonomous Vehicle",
            "client": "Client A",
            "market": "Atlanta",
            "stage": "Pre LOI",
            "attributes": {"days_on_market": 12},
            "field_provenance": {"power_amps": "llm_suggested"},
            "assumed_fields": ["power_amps"],
        },
    ]


def test_prepare_deals_preserves_raw_data_and_omits_generated_values(deals):
    prepared = prepare_deals(deals, datetime(2026, 11, 19, 12, tzinfo=UTC))

    assert prepared[0]["field_provenance"] == {"market": "assumed"}
    assert "price_per_sf" not in prepared[0]
    assert "price_per_lot_sf" not in prepared[0]
    assert prepared[0]["attributes"] == {}


def test_prepare_deals_weekly_selection_uses_first_sourcing_per_group(deals):
    prepared = prepare_deals(deals, datetime(2026, 11, 19, 12, tzinfo=UTC))

    assert [row["show_in_weekly"] for row in prepared] == [True, False, True]


def test_prepare_deals_backdates_days_on_market(deals):
    prepared = prepare_deals(deals, datetime(2026, 11, 19, 12, tzinfo=UTC))

    assert prepared[2]["stage_entered_at"] == "2026-11-07T12:00:00+00:00"
    assert prepared[0]["stage_entered_at"] == "2026-11-19T12:00:00+00:00"
    assert prepared[2]["created_at"] == prepared[2]["stage_entered_at"]
    assert prepared[0]["created_at"] == prepared[0]["stage_entered_at"]


def test_seed_preserves_existing_deal_creation_dates(deals):
    prepared = prepare_deals(deals, datetime(2026, 11, 19, 12, tzinfo=UTC))
    preserve_deal_creation_dates(
        prepared,
        [{"id": prepared[2]["id"], "created_at": "2025-01-01T00:00:00+00:00"}],
    )

    assert prepared[2]["created_at"] == "2025-01-01T00:00:00+00:00"
    assert prepared[0]["created_at"] == prepared[0]["stage_entered_at"]


def test_seed_only_inserts_missing_vertical_config_defaults():
    missing = missing_vertical_configs({"food", "av", "custom"})

    assert [row["tab_prefix"] for row in missing] == ["catering"]


def test_demo_users_have_expected_role_counts_and_named_accounts(deals):
    users = demo_users(deals)

    assert len(users) == 25
    assert len({user["email"] for user in users}) == 25
    assert sum(user["role"] == "leadership" for user in users) == 3
    assert sum(user["role"] == "acq_lead" for user in users) == 4
    assert sum(user["role"] == "analyst" for user in users) == 10
    assert sum(user["role"] == "viewer" for user in users) == 7
    assert next(user for user in users if user["email"] == "analyst.a@demo.test")[
        "clients"
    ] == ["Client A"]


def test_prepare_contacts_moves_unknown_columns_to_attributes():
    prepared = prepare_contacts(
        [
            {
                "id": "contact:2",
                "contact_name": "Jamie",
                "office": "555-0100",
                "custom_score": 9,
            }
        ]
    )

    assert prepared[0]["attributes"] == {"custom_score": 9}
    assert "custom_score" not in prepared[0]


def test_activity_generation_is_deterministic_and_bounded(deals):
    users = [
        {
            "id": f"user-{index}",
            "role": "admin" if index == 0 else "viewer",
            **demo,
        }
        for index, demo in enumerate(demo_users(deals)[:2])
    ]
    first = activity_rows(users, prepare_deals(deals, datetime.now(UTC)), date(2026, 11, 19))
    second = activity_rows(users, prepare_deals(deals, datetime.now(UTC)), date(2026, 11, 19))

    assert first == second
    assert len(first[1]) == 40
    assert all(
        row["old_value"] in {*STAGES, "Needs review"}
        and row["new_value"] in {*STAGES, "Needs review"}
        for row in first[1]
    )
    assert all(row["seed_source"] == "phase-03" for row in first[1])
    assert all(row["detail"]["seeded"] for row in first[0])


def test_invalid_stage_fails_loudly(deals):
    deals[0]["stage"] = "Listed"

    with pytest.raises(SystemExit, match="invalid stage"):
        prepare_deals(deals, datetime(2026, 11, 19, 12, tzinfo=UTC))
