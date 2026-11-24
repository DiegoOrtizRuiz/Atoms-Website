"""Seed the normalized Site Pipeline dataset and demo users into Supabase."""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
from collections import Counter
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

try:
    from supabase import Client, create_client
except ImportError as exc:  # pragma: no cover - exercised by the script, not unit tests
    raise SystemExit(
        "Missing Supabase dependency. Run: pip install -r scripts/requirements.txt"
    ) from exc

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT_DIR = ROOT / "out"
load_dotenv(ROOT / ".env.local")
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
WEEKLY_STAGES = {
    "Pre LOI",
    "Negotiating LOI",
    "Negotiating PSA",
    "In Contract",
}
CORE_DEAL_FIELDS = {
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
    "weekly_note",
    "show_in_weekly",
    "attributes",
    "attributes_raw",
    "field_provenance",
    "notes_extracted",
    "needs_review",
    "review_reasons",
    "stage_entered_at",
    "created_at",
}


def load_json(path: Path) -> list[dict[str, Any]]:
    try:
        value = json.loads(path.read_text())
    except FileNotFoundError as exc:
        raise SystemExit(f"Required seed input not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON in {path}: {exc}") from exc
    if not isinstance(value, list) or not all(isinstance(row, dict) for row in value):
        raise SystemExit(f"Expected a JSON array of objects in {path}.")
    return value


def parse_reference_date(raw: str | None) -> date:
    if not raw:
        return datetime.now(UTC).date()
    try:
        return date.fromisoformat(raw)
    except ValueError as exc:
        raise SystemExit("SEED_REFERENCE_DATE must use YYYY-MM-DD.") from exc


def vertical_configs() -> list[dict[str, Any]]:
    def column(key: str, label: str, kind: str) -> dict[str, str]:
        return {"key": key, "label": label, "type": kind}

    return [
        {
            "tab_prefix": "food",
            "vertical": "Food",
            "sort_order": 10,
            "columns": [],
        },
        {
            "tab_prefix": "av",
            "vertical": "Autonomous Vehicle",
            "sort_order": 20,
            "columns": [
                column("zoning", "Zoning", "string"),
                column("clear_height_ft", "Clear height", "number"),
                column("dock_high_doors", "Dock-high doors", "number"),
                column("power_amps", "Power", "number"),
                column("property_type", "Property type", "string"),
                column("listing_status", "Listing status", "string"),
                column("days_on_market", "Days on market", "number"),
            ],
        },
        {
            "tab_prefix": "catering",
            "vertical": "Airline Catering",
            "sort_order": 30,
            "columns": [
                column("zoning", "Zoning", "string"),
                column("miles_from_airport", "Miles from airport", "number"),
                column("clear_height_ft", "Clear height", "number"),
                column("dock_high_doors", "Dock-high doors", "number"),
                column("grade_level_doors", "Grade-level doors", "number"),
                column("power_amps", "Power", "number"),
                column("rent_per_sf", "Rent/SF", "number"),
                column("property_type", "Property type", "string"),
                column("listing_status", "Listing status", "string"),
                column("days_on_market", "Days on market", "number"),
            ],
        },
    ]


def stage_entered_at(
    row: dict[str, Any], reference: datetime
) -> str:
    days_on_market = row.get("attributes", {}).get("days_on_market")
    if isinstance(days_on_market, (int, float)) and not isinstance(
        days_on_market, bool
    ):
        entered = reference - timedelta(days=max(0, int(days_on_market)))
    else:
        entered = reference
    return entered.isoformat()


def prepare_deals(
    deals: list[dict[str, Any]], reference: datetime
) -> list[dict[str, Any]]:
    ids: set[str] = set()
    prepared: list[dict[str, Any]] = []
    first_sourcing: set[tuple[Any, Any]] = set()

    for source in deals:
        deal_id = source.get("id")
        if not isinstance(deal_id, str) or not deal_id:
            raise SystemExit("Every deal must have a non-empty string id.")
        if deal_id in ids:
            raise SystemExit(f"Duplicate deal id: {deal_id}")
        ids.add(deal_id)

        stage = source.get("stage")
        if stage not in {*STAGES, "Needs review"}:
            raise SystemExit(f"Deal {deal_id} has invalid stage: {stage!r}")

        provenance = {
            str(field): "assumed"
            for field in source.get("assumed_fields", [])
            if isinstance(field, str)
        }
        for field, status in source.get("field_provenance", {}).items():
            if status in {"assumed", "llm_suggested", "confirmed"}:
                provenance[str(field)] = status

        sourcing_key = (source.get("vertical"), source.get("market"))
        first_in_sourcing_group = (
            stage == "Sourcing" and sourcing_key not in first_sourcing
        )
        if first_in_sourcing_group:
            first_sourcing.add(sourcing_key)

        row = {
            key: source[key]
            for key in CORE_DEAL_FIELDS
            if key in source and key not in {"price_per_sf", "price_per_lot_sf"}
        }
        row.update(
            {
                "id": deal_id,
                "stage": stage,
                "field_provenance": provenance,
                "show_in_weekly": bool(
                    stage in WEEKLY_STAGES or first_in_sourcing_group
                ),
                "stage_entered_at": stage_entered_at(source, reference),
            }
        )
        row["created_at"] = row["stage_entered_at"]
        prepared.append(row)

    return prepared


def prepare_contacts(
    contacts: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    columns = {
        "id",
        "contact_name",
        "company",
        "client",
        "vertical",
        "title",
        "office",
        "mobile",
        "email",
        "notes",
        "linked_deals",
    }
    ids: set[str] = set()
    prepared: list[dict[str, Any]] = []
    for source in contacts:
        contact_id = source.get("id")
        if not isinstance(contact_id, str) or not contact_id:
            raise SystemExit("Every contact must have a non-empty string id.")
        if contact_id in ids:
            raise SystemExit(f"Duplicate contact id: {contact_id}")
        ids.add(contact_id)
        prepared.append(
            {
                **{key: source.get(key) for key in columns},
                "attributes": {
                    key: value
                    for key, value in source.items()
                    if key not in columns
                },
                "linked_deals": source.get("linked_deals") or [],
            }
        )
    return prepared


def demo_users(deals: list[dict[str, Any]]) -> list[dict[str, Any]]:
    clients = sorted({row["client"] for row in deals if row.get("client")})
    if not clients:
        clients = ["Client A", "Client B"]
    verticals = ["Food", "Autonomous Vehicle", "Airline Catering"]
    specs: list[dict[str, Any]] = []

    def add(email: str, full_name: str, role: str, assigned_verticals=(), assigned_clients=()):
        specs.append(
            {
                "email": email,
                "full_name": full_name,
                "role": role,
                "verticals": list(assigned_verticals),
                "clients": list(assigned_clients),
            }
        )

    add("admin@demo.test", "Demo Admin", "admin")
    add("leadership@demo.test", "Demo Leadership", "leadership")
    add("leadership.ops@demo.test", "Operations Leadership", "leadership")
    add("leadership.partners@demo.test", "Partner Leadership", "leadership")

    leads = [
        ("lead.food@demo.test", "Food Lead", ["Food"]),
        ("lead.av@demo.test", "Autonomous Vehicle Lead", ["Autonomous Vehicle"]),
        ("lead.catering@demo.test", "Airline Catering Lead", ["Airline Catering"]),
        ("lead.commercial@demo.test", "Commercial Acquisitions Lead", verticals),
    ]
    for email, name, assigned in leads:
        add(email, name, "acq_lead", assigned)

    named_analysts = [
        ("analyst.a@demo.test", "Analyst A", ["Client A"]),
        ("analyst.b@demo.test", "Analyst B", ["Client B"]),
    ]
    for email, name, assigned in named_analysts:
        add(
            email,
            name,
            "analyst",
            assigned_clients=[client for client in assigned if client in clients],
        )
    for index in range(3, 11):
        client_indexes = [(index - 1) % len(clients)]
        if index % 2 == 0:
            client_indexes.append(index % len(clients))
        assigned = sorted({clients[i] for i in client_indexes})
        add(
            f"analyst.{index:02d}@demo.test",
            f"Analyst {index}",
            "analyst",
            assigned_clients=assigned,
        )

    add("viewer@demo.test", "Demo Viewer", "viewer")
    for index in range(2, 8):
        add(f"viewer.{index:02d}@demo.test", f"Viewer {index}", "viewer")

    if len(specs) != 25:
        raise AssertionError(f"Expected 25 demo users, generated {len(specs)}.")
    if len({spec["email"] for spec in specs}) != 25:
        raise AssertionError("Demo email addresses must be unique.")
    return specs


def activity_rows(
    users: list[dict[str, Any]],
    deals: list[dict[str, Any]],
    reference_date: date,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    rng = random.Random("site-pipeline-seed-v1")
    activity: list[dict[str, Any]] = []
    history: list[dict[str, Any]] = []
    paths = ["/deals", "/weekly", "/rollup"]

    for day_offset in range(29, -1, -1):
        day = reference_date - timedelta(days=day_offset)
        for user in users:
            probability = 0.82 if day.weekday() < 5 else 0.22
            if rng.random() > probability:
                continue
            login_time = datetime.combine(
                day, time(rng.randint(7, 11), rng.randint(0, 59)), UTC
            )
            activity.append(
                {
                    "user_id": user["id"],
                    "event": "login",
                    "path": "/login",
                    "detail": {"seeded": True},
                    "created_at": login_time.isoformat(),
                }
            )
            path_count = 1 + rng.randrange(3)
            for index in range(path_count):
                activity.append(
                    {
                        "user_id": user["id"],
                        "event": "page_view",
                        "path": rng.choice(paths),
                        "detail": {"seeded": True},
                        "created_at": (
                            login_time + timedelta(minutes=4 + index * 9)
                        ).isoformat(),
                    }
                )

    if deals:
        if not any(
            user["role"] in {"admin", "acq_lead", "analyst"} for user in users
        ):
            return activity, history
        for index in range(40):
            deal = deals[index % len(deals)]
            editable_users = [
                user
                for user in users
                if user["role"] == "admin"
                or (
                    user["role"] == "acq_lead"
                    and deal.get("vertical") in user["verticals"]
                )
                or (
                    user["role"] == "analyst"
                    and deal.get("client") in user["clients"]
                )
            ]
            user = editable_users[index % len(editable_users)]
            stage_index = STAGES.index(deal["stage"]) if deal["stage"] in STAGES else 0
            old_stage = STAGES[stage_index - 1] if stage_index > 0 else "Needs review"
            changed_at = datetime.combine(
                reference_date - timedelta(days=index % 30),
                time(8 + (index % 8), 15 + (index % 4) * 10),
                UTC,
            )
            history.append(
                {
                    "deal_id": deal["id"],
                    "changed_by": user["id"],
                    "changed_at": changed_at.isoformat(),
                    "field": "stage",
                    "old_value": old_stage,
                    "new_value": deal["stage"],
                    "seed_source": "phase-03",
                }
            )
            activity.append(
                {
                    "user_id": user["id"],
                    "event": "deal_edit",
                    "path": f"/deals/{deal['id']}",
                    "detail": {
                        "seeded": True,
                        "field": "stage",
                        "deal_id": deal["id"],
                    },
                    "created_at": changed_at.isoformat(),
                }
            )

    return activity, history


def response_rows(response: Any) -> list[dict[str, Any]]:
    error = getattr(response, "error", None)
    if error:
        raise RuntimeError(str(error))
    data = getattr(response, "data", None)
    if data is None:
        raise RuntimeError("Supabase returned no data.")
    return data


def upsert_rows(
    client: Client, table: str, rows: list[dict[str, Any]], on_conflict: str
) -> None:
    if rows:
        response_rows(
            client.table(table).upsert(rows, on_conflict=on_conflict).execute()
        )


def missing_vertical_configs(existing_prefixes: set[str]) -> list[dict[str, Any]]:
    return [
        row
        for row in vertical_configs()
        if row["tab_prefix"] not in existing_prefixes
    ]


def ensure_vertical_configs(client: Client) -> int:
    existing_rows = response_rows(
        client.table("vertical_config").select("tab_prefix").execute()
    )
    existing_prefixes = {row["tab_prefix"] for row in existing_rows}
    missing_rows = missing_vertical_configs(existing_prefixes)
    if missing_rows:
        response_rows(client.table("vertical_config").insert(missing_rows).execute())

    response = (
        client.table("vertical_config")
        .select("tab_prefix", count="exact", head=True)
        .execute()
    )
    error = getattr(response, "error", None)
    if error:
        raise RuntimeError(str(error))
    count = getattr(response, "count", None)
    if count is None:
        raise RuntimeError("Supabase returned no vertical configuration count.")
    return count


def preserve_deal_creation_dates(
    deals: list[dict[str, Any]], existing_rows: list[dict[str, Any]]
) -> None:
    existing_dates = {
        row["id"]: row["created_at"]
        for row in existing_rows
    }
    for deal in deals:
        if deal["id"] in existing_dates:
            deal["created_at"] = existing_dates[deal["id"]]


def seed_users(
    client: Client, specs: list[dict[str, Any]], password: str
) -> list[dict[str, Any]]:
    existing = {}
    page = 1
    while True:
        response = client.auth.admin.list_users(page=page, per_page=1000)
        users = (
            response
            if isinstance(response, list)
            else getattr(response, "users", [])
        )
        if not users:
            break
        for user in users:
            existing[user.email] = user
        if len(users) < 1000:
            break
        page += 1

    seeded = []
    for spec in specs:
        auth_user = existing.get(spec["email"])
        attributes = {
            "password": password,
            "email_confirm": True,
            "user_metadata": {"full_name": spec["full_name"]},
        }
        if auth_user is None:
            response = client.auth.admin.create_user(
                {"email": spec["email"], **attributes}
            )
            auth_user = response.user
        else:
            response = client.auth.admin.update_user_by_id(auth_user.id, attributes)
            auth_user = response.user

        if not auth_user or not auth_user.id:
            raise RuntimeError(f"Could not create or update {spec['email']}.")
        seeded.append({"id": str(auth_user.id), **spec})

    profiles = [
        {
            "id": user["id"],
            "email": user["email"],
            "full_name": user["full_name"],
            "role": user["role"],
            "verticals": user["verticals"],
            "clients": user["clients"],
            "active": True,
        }
        for user in seeded
    ]
    upsert_rows(client, "profiles", profiles, "id")
    return seeded


def reconcile(client: Client, expected: dict[str, int]) -> dict[str, int]:
    actual: dict[str, int] = {}
    for table, count in expected.items():
        response = (
            client.table(table).select("*", count="exact", head=True).execute()
        )
        actual[table] = response.count or 0
        if actual[table] != count:
            raise RuntimeError(
                f"{table} count mismatch: expected {count}, found {actual[table]}"
            )
    return actual


def build_enrichment_patches(
    enriched_deals: list[dict[str, Any]],
    existing_deals: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Build updates touching ONLY notes_extracted, weekly_note, and field_provenance."""
    existing_by_id = {row["id"]: row for row in existing_deals}
    patches: list[dict[str, Any]] = []
    for source in enriched_deals:
        deal_id = source.get("id")
        if not deal_id or deal_id not in existing_by_id:
            continue
        if "notes_extracted" not in source and "weekly_note" not in source:
            continue
        existing = existing_by_id[deal_id]
        provenance = dict(existing.get("field_provenance") or {})
        if source.get("notes_extracted") is not None:
            provenance["notes_extracted"] = "llm_suggested"
        if source.get("weekly_note") is not None:
            provenance["weekly_note"] = "llm_suggested"
        patches.append(
            {
                "id": deal_id,
                "notes_extracted": source.get("notes_extracted"),
                "weekly_note": source.get("weekly_note"),
                "field_provenance": provenance,
            }
        )
    return patches


def run_enrichment_only(client: Client) -> None:
    enriched_path = DEFAULT_OUT_DIR / "deals_enriched.json"
    if not enriched_path.exists():
        raise SystemExit(
            f"Enriched deals file not found: {enriched_path}. Run scripts/llm_enrich.py first."
        )
    enriched_deals = load_json(enriched_path)
    before_rows = response_rows(client.table("deals").select("*").execute())
    before_by_id = {row["id"]: row for row in before_rows}

    patches = build_enrichment_patches(enriched_deals, before_rows)
    for patch in patches:
        deal_id = patch["id"]
        response_rows(
            client.table("deals")
            .update(
                {
                    "notes_extracted": patch["notes_extracted"],
                    "weekly_note": patch["weekly_note"],
                    "field_provenance": patch["field_provenance"],
                }
            )
            .eq("id", deal_id)
            .execute()
        )

    after_rows = response_rows(client.table("deals").select("*").execute())
    allowed_changed = {
        "notes_extracted",
        "weekly_note",
        "field_provenance",
        "version",
        "updated_at",
        "updated_by",
    }
    column_change_counts: Counter[str] = Counter()
    unexpected_changes: list[str] = []
    for after in after_rows:
        before = before_by_id.get(after["id"])
        if before is None:
            unexpected_changes.append(f"unexpected new row {after['id']}")
            continue
        for col, new_val in after.items():
            if before.get(col) != new_val:
                column_change_counts[col] += 1
                if col not in allowed_changed:
                    unexpected_changes.append(f"{after['id']}.{col}")

    if unexpected_changes:
        raise RuntimeError(
            f"--enrichment-only unexpectedly modified protected columns: {', '.join(unexpected_changes)}"
        )

    print("Enrichment-only seed reconciliation passed:")
    print(f"  source: {enriched_path.relative_to(ROOT)}")
    print(f"  deals patched: {len(patches)}")
    print(f"  changed columns: {dict(column_change_counts)}")
    print("  protected source columns changed: 0")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed Site Pipeline into Supabase.")
    parser.add_argument(
        "--enrichment-only",
        action="store_true",
        help="Update only notes_extracted, weekly_note, and llm_suggested provenance on existing deals.",
    )
    return parser.parse_args(argv)


def run(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if args.enrichment_only:
        if not url or not service_key:
            raise SystemExit(
                "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before seeding."
            )
        client = create_client(url, service_key)
        run_enrichment_only(client)
        return

    password = os.environ.get("DEMO_PASSWORD")
    if not url or not service_key or not password:
        raise SystemExit(
            "Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and "
            "DEMO_PASSWORD before seeding."
        )

    enriched = DEFAULT_OUT_DIR / "deals_enriched.json"
    deals_path = enriched if enriched.exists() else DEFAULT_OUT_DIR / "deals.json"
    raw_deals = load_json(deals_path)
    contacts = prepare_contacts(load_json(DEFAULT_OUT_DIR / "contacts.json"))
    if not raw_deals:
        raise SystemExit("Seed input contains no deals.")

    reference = parse_reference_date(os.environ.get("SEED_REFERENCE_DATE"))
    reference_time = datetime.combine(reference, time(12), UTC)
    deals = prepare_deals(raw_deals, reference_time)
    user_specs = demo_users(deals)

    client = create_client(url, service_key)
    vertical_config_count = ensure_vertical_configs(client)
    existing_rows = []
    for offset in range(0, len(deals), 100):
        ids = [deal["id"] for deal in deals[offset : offset + 100]]
        existing_rows.extend(
            response_rows(
                client.table("deals").select("id, created_at").in_("id", ids).execute()
            )
        )
    preserve_deal_creation_dates(deals, existing_rows)
    upsert_rows(client, "deals", deals, "id")
    upsert_rows(client, "contacts", contacts, "id")
    users = seed_users(client, user_specs, password)
    activity, history = activity_rows(users, deals, reference)

    client.table("activity_log").delete().contains(
        "detail", {"seeded": True}
    ).execute()
    response_rows(
        client.table("deal_history")
        .delete()
        .eq("seed_source", "phase-03")
        .execute()
    )
    if history:
        response_rows(client.table("deal_history").insert(history).execute())
    if activity:
        response_rows(client.table("activity_log").insert(activity).execute())

    counts = reconcile(
        client,
        {
            "vertical_config": vertical_config_count,
            "deals": len(deals),
            "contacts": len(contacts),
            "profiles": 25,
        },
    )
    role_counts = Counter(user["role"] for user in users)
    print("Seed reconciliation passed:")
    print(f"  source: {deals_path.relative_to(ROOT)}")
    print(f"  deals: {len(deals)} JSON = {counts['deals']} DB")
    print(f"  vertical configs: {counts['vertical_config']} DB")
    print(f"  contacts: {len(contacts)} JSON = {counts['contacts']} DB")
    print(f"  users/profiles: {counts['profiles']} ({dict(role_counts)})")
    print(f"  generated activity: {len(activity)}")
    print(f"  generated history: {len(history)}")


if __name__ == "__main__":
    try:
        run()
    except Exception as exc:
        print(f"Seed failed: {exc}", file=sys.stderr)
        raise
