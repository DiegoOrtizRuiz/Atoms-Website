"""
normalize.py — turn the messy workbook into one canonical deals dataset.

Usage:  python normalize.py <workbook.xlsx> [out_dir]
Writes: deals.json, contacts.json, import_report.json

Principles (see PROCESS_LOG):
  * Never drop a row. Anything we can't interpret is kept and flagged needs_review.
  * Always keep the raw value next to the normalized one.
  * Map columns by header name (case/space-insensitive), never by position.
  * Derived numbers ($/SF) are recomputed from inputs; disagreements are flagged, not hidden.
  * Font colour != default  ->  that cell is an *assumption* (not yet confirmed).
"""
import json
import os
import re
import sys
from pathlib import Path

import openpyxl
from dotenv import load_dotenv

# ---------------------------------------------------------------- config
# The brief mentions a config tab mapping tabs -> verticals, but the file has none.
# We recreate it here; in the app this lives in a `vertical_config` table.
VERTICAL_CONFIG = {
    "food": "Food",
    "av": "Autonomous Vehicle",
    "catering": "Airline Catering",
}
VERTICAL_ORDER = ["Food", "Autonomous Vehicle", "Airline Catering"]  # as in target_weekly_view
NON_DEAL_TABS = {"contact_tracker", "target_weekly_view"}

STAGES = [
    "Sourcing", "In Pipeline", "Pre LOI", "Negotiating LOI",
    "Negotiating PSA", "In Contract", "Closed", "On Hold",
]
STATUS_MAP = {
    "sourcing": "Sourcing",
    "in pipeline": "In Pipeline", "pipeline": "In Pipeline",
    "pre loi": "Pre LOI", "pre-loi": "Pre LOI",
    "negotiating loi": "Negotiating LOI", "nego loi": "Negotiating LOI",
    "negotiating psa": "Negotiating PSA", "nego psa": "Negotiating PSA",
    "in contract": "In Contract", "under contract": "In Contract",
    "closed": "Closed",
    "on hold": "On Hold",
    # deliberately NOT mapped: "listed" (sell-side wording, not in the acquisition funnel)
}

# canonical field -> accepted header spellings (normalized: lowercase, collapsed spaces)
CORE_COLUMNS = {
    "client": ["client name", "client"],
    "market": ["metro", "market"],
    "city": ["city"],
    "state": ["state"],
    "address": ["address"],
    "stage_raw": ["status"],
    "bldg_sf": ["bldg sf", "building sf", "sf"],
    "list_price": ["list price", "$"],
    "price_per_sf_sheet": ["list price/sf", "$/sf"],
    "lot_sf": ["lot sf", "lot size"],
    "price_per_lot_sf_sheet": ["list price/lot sf"],
    "broker": ["broker"],
    "broker_phone": ["phone #", "phone"],
    "notes": ["notes"],
}
# everything else becomes a vertical-specific attribute with a canonical key
ATTRIBUTE_ALIASES = {
    "zoning": "zoning",
    "clear height": "clear_height_ft",
    "dh doors": "dock_high_doors",
    "gl doors": "grade_level_doors",
    "power": "power_amps",
    "property type": "property_type",
    "sale status": "listing_status",
    "days on market": "days_on_market",
    "miles from airport": "miles_from_airport",
    "rent/sf": "rent_per_sf",
}
# Food tab has no State column; inferred states are flagged as such.
CITY_STATE = {"hialeah": "FL", "miami": "FL", "chicago": "IL", "seattle": "WA",
              "atlanta": "GA", "hollis": "NY", "westbury": "NY", "port washington": "NY"}

DEFAULT_FONT_COLORS = {("theme", 1), ("rgb", "FF000000"), None}


# ---------------------------------------------------------------- helpers
def norm_header(h):
    return re.sub(r"\s+", " ", str(h).strip().lower()) if h is not None else None


def clean_str(v):
    if v is None:
        return None
    s = str(v).strip()
    return s if s and s not in {"-", "—", "n/a", "N/A"} else None


def to_number(v):
    """Numbers, '$2,850,000', '1,138.70' -> float. Unparseable -> None (raw kept by caller)."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[$,\s]", "", str(v))
    try:
        return float(s)
    except ValueError:
        return None


def parse_amps(v):
    m = re.fullmatch(r"\s*([\d,]+(?:\.\d+)?)\s*A?\s*", str(v)) if v is not None else None
    return float(m.group(1).replace(",", "")) if m else None


def font_key(cell):
    c = cell.font.color if cell.font else None
    if c is None:
        return None
    if c.type == "rgb":
        return ("rgb", c.rgb)
    if c.type == "theme":
        return ("theme", c.theme)
    return (c.type, c.indexed)


def load_live_vertical_mapping():
    root = Path(__file__).resolve().parents[1]
    load_dotenv(root / ".env.local")
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url and not service_key:
        return None
    if not url or not service_key:
        raise RuntimeError(
            "Live importer mapping requires both NEXT_PUBLIC_SUPABASE_URL and "
            "SUPABASE_SERVICE_ROLE_KEY."
        )

    import httpx
    from postgrest.exceptions import APIError
    from supabase import create_client

    try:
        client = create_client(url, service_key)
        vertical_rows = (
            client.table("vertical_config")
            .select("tab_prefix, vertical")
            .execute()
            .data
        )
        tab_rows = (
            client.table("source_tabs")
            .select("tab_name, tab_prefix")
            .execute()
            .data
        )
    except (APIError, httpx.HTTPError, ValueError) as exc:
        raise RuntimeError(
            "Unable to load importer mappings from Supabase; check the schema "
            "and Supabase credentials."
        ) from exc

    verticals = {
        row["tab_prefix"]: row["vertical"]
        for row in vertical_rows
        if row.get("tab_prefix") and row.get("vertical")
    }
    source_tabs = {
        row["tab_name"]: row.get("tab_prefix")
        for row in tab_rows
        if row.get("tab_name")
    }
    return verticals, source_tabs


def resolve_vertical(tab, vertical_mapping, source_tabs):
    prefix = source_tabs[tab] if tab in source_tabs else tab.split("_")[0].lower()
    return vertical_mapping.get(prefix) if prefix else None


# ---------------------------------------------------------------- deal tabs
def parse_deal_tab(
    ws, report, vertical_mapping=VERTICAL_CONFIG, source_tabs=None
):
    source_tabs = source_tabs or {}
    vertical = resolve_vertical(ws.title, vertical_mapping, source_tabs)
    headers = [norm_header(c.value) for c in ws[1]]
    lookup = {}
    for canon, aliases in CORE_COLUMNS.items():
        for i, h in enumerate(headers):
            if h in aliases:
                lookup[canon] = i
    attr_cols = {}
    unknown_cols = []
    for i, h in enumerate(headers):
        if h is None or i in lookup.values():
            continue
        if h in ATTRIBUTE_ALIASES:
            attr_cols[ATTRIBUTE_ALIASES[h]] = i
        else:  # unknown column: keep it, never drop
            key = re.sub(r"[^a-z0-9]+", "_", h).strip("_")
            attr_cols[key] = i
            unknown_cols.append(h)

    tab_rep = {"tab": ws.title, "vertical": vertical, "source_rows": 0, "deals": 0,
               "unknown_columns": unknown_cols, "missing_core_columns":
               [k for k in ("state", "broker", "lot_sf") if k not in lookup]}
    deals = []
    for r_idx, row in enumerate(ws.iter_rows(min_row=2), start=2):
        if all(c.value is None or str(c.value).strip() == "" for c in row):
            continue
        tab_rep["source_rows"] += 1
        get = lambda k: row[lookup[k]].value if k in lookup and lookup[k] < len(row) else None
        reasons = []

        stage_raw = clean_str(get("stage_raw"))
        stage = STATUS_MAP.get(norm_header(stage_raw)) if stage_raw else None
        if stage is None:
            reasons.append(f"unmapped status: {stage_raw!r}")
        if vertical is None:
            reasons.append(f"unconfigured tab: {ws.title}")

        city = clean_str(get("city"))
        state = clean_str(get("state"))
        state_inferred = False
        if state is None and city and city.lower() in CITY_STATE:
            state, state_inferred = CITY_STATE[city.lower()], True

        bldg_sf, price, lot_sf = to_number(get("bldg_sf")), to_number(get("list_price")), to_number(get("lot_sf"))
        psf = round(price / bldg_sf, 2) if price and bldg_sf else None
        plsf = round(price / lot_sf, 2) if price and lot_sf else None
        for label, calc, sheet in (("price_per_sf", psf, to_number(get("price_per_sf_sheet"))),
                                   ("price_per_lot_sf", plsf, to_number(get("price_per_lot_sf_sheet")))):
            if sheet is not None and calc is not None and abs(calc - sheet) > 0.01:
                reasons.append(f"{label}: sheet says {sheet}, inputs give {calc}")

        attributes, attributes_raw = {}, {}
        for key, i in attr_cols.items():
            raw = row[i].value if i < len(row) else None
            if raw is None:
                continue  # blank stays absent (unknown), never 0
            attributes_raw[key] = raw
            if key == "power_amps":
                val = parse_amps(raw)
            elif key == "clear_height_ft":
                val = to_number(raw)
                if val is None:
                    reasons.append(f"clear height not a number: {raw!r}")
            elif key in {"dock_high_doors", "grade_level_doors", "days_on_market",
                         "miles_from_airport", "rent_per_sf"}:
                val = to_number(raw)
            else:
                val = clean_str(raw)
            attributes[key] = val

        # assumptions = any non-default font colour, tracked per field
        assumed = []
        for canon, i in list(lookup.items()) + list(attr_cols.items()):
            if i < len(row) and row[i].value is not None and font_key(row[i]) not in DEFAULT_FONT_COLORS:
                assumed.append(canon)

        address = clean_str(get("address"))
        if address is None and (bldg_sf or price):
            reasons.append("property data present but address missing")
        if (city or state) and city and state_inferred:
            pass  # informational, surfaced via state_inferred

        deal = {
            "id": f"{ws.title}:{r_idx}",
            "source_tab": ws.title, "source_row": r_idx,
            "vertical": vertical,
            "unconfigured_tab": vertical is None,
            "client": clean_str(get("client")),
            "market": clean_str(get("market")),
            "city": city, "state": state, "state_inferred": state_inferred,
            "address": address,
            "stage": stage or "Needs review",
            "stage_raw": stage_raw,
            "bldg_sf": bldg_sf, "list_price": price, "lot_sf": lot_sf,
            "price_per_sf": psf, "price_per_lot_sf": plsf,
            "broker": clean_str(get("broker")),
            "broker_phone": clean_str(get("broker_phone")),
            "notes": clean_str(get("notes")),
            "attributes": attributes,
            "attributes_raw": attributes_raw,
            "assumed_fields": assumed,
            "needs_review": bool(reasons),
            "review_reasons": reasons,
        }
        deals.append(deal)
        tab_rep["deals"] += 1
    report["tabs"].append(tab_rep)
    return deals


def parse_contacts(ws):
    headers = [norm_header(c.value) for c in ws[1]]
    keys = [re.sub(r"[^a-z0-9]+", "_", h).strip("_") if h else None for h in headers]
    out = []
    for r_idx, row in enumerate(ws.iter_rows(min_row=2), start=2):
        if all(c.value is None for c in row):
            continue
        rec = {"id": f"contact:{r_idx}"}
        for k, c in zip(keys, row):
            if k:
                rec[k] = c.value if isinstance(c.value, bool) else clean_str(c.value)
        out.append(rec)
    return out


def link_contacts(deals, contacts):
    """Cross-reference outreach by shared phone number only (no fuzzy guessing)."""
    by_phone = {}
    for d in deals:
        if d["broker_phone"]:
            by_phone.setdefault(d["broker_phone"], []).append(d["id"])
    for c in contacts:
        phones = {c.get("office"), c.get("mobile")}
        c["linked_deals"] = sorted({i for p in phones if p for i in by_phone.get(p, [])})


def main(path, out_dir="."):
    wb = openpyxl.load_workbook(path)
    live_mapping = load_live_vertical_mapping()
    if live_mapping is None:
        vertical_mapping, source_tabs = VERTICAL_CONFIG, {}
        mapping_source = "offline_fallback"
    else:
        vertical_mapping, source_tabs = live_mapping
        mapping_source = "supabase"
    report = {
        "source": Path(path).name,
        "mapping_source": mapping_source,
        "tabs": [],
        "unconfigured_tabs": [],
    }
    deals, contacts = [], []
    for ws in wb.worksheets:
        if ws.title == "contact_tracker":
            contacts = parse_contacts(ws)
        elif ws.title in NON_DEAL_TABS:
            continue
        elif resolve_vertical(ws.title, vertical_mapping, source_tabs) is None:
            report["unconfigured_tabs"].append(ws.title)  # imported anyway, flagged
            deals += parse_deal_tab(ws, report, vertical_mapping, source_tabs)
        else:
            deals += parse_deal_tab(ws, report, vertical_mapping, source_tabs)
    link_contacts(deals, contacts)

    report["totals"] = {
        "source_rows": sum(t["source_rows"] for t in report["tabs"]),
        "deals": len(deals),
        "needs_review": sum(d["needs_review"] for d in deals),
        "assumed_cells": sum(len(d["assumed_fields"]) for d in deals),
        "by_stage": {s: sum(d["stage"] == s for d in deals) for s in STAGES + ["Needs review"]},
        "status_variants": sorted({d["stage_raw"] for d in deals if d["stage_raw"]}),
    }
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "deals.json").write_text(json.dumps(deals, indent=2))
    (out / "contacts.json").write_text(json.dumps(contacts, indent=2))
    (out / "import_report.json").write_text(json.dumps(report, indent=2))
    t = report["totals"]
    print(f"{t['source_rows']} source rows -> {t['deals']} deals "
          f"({t['needs_review']} need review, {t['assumed_cells']} assumed cells)")
    return deals, contacts, report


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else ".")
