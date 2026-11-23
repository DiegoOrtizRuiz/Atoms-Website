"""Acceptance tests for the importer (rubric: 'doesn't silently drop or mangle messy rows').
Run:  WORKBOOK=path/to.xlsx pytest -q test_import.py
"""
import os

import openpyxl
import pytest

import normalize
from normalize import STAGES, font_key, DEFAULT_FONT_COLORS, main, NON_DEAL_TABS

WB = os.environ.get("WORKBOOK", "data/src.xlsx")


@pytest.fixture(scope="module", autouse=True)
def use_offline_vertical_mapping():
    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(normalize, "load_live_vertical_mapping", lambda: None)
        yield


@pytest.fixture(scope="module")
def result(tmp_path_factory):
    return main(WB, tmp_path_factory.mktemp("out"))


@pytest.fixture(scope="module")
def deals(result):
    return result[0]


def source_rows(tab):
    ws = openpyxl.load_workbook(WB)[tab]
    return [r for r in ws.iter_rows(min_row=2) if any(c.value not in (None, "") for c in r)]


def deal_tabs():
    return [t for t in openpyxl.load_workbook(WB).sheetnames if t not in NON_DEAL_TABS]


# 1. no row lost
@pytest.mark.parametrize("tab", deal_tabs())
def test_row_count_preserved(deals, tab):
    assert len([d for d in deals if d["source_tab"] == tab]) == len(source_rows(tab))


# 2. every deal has a valid stage or is explicitly in review
def test_every_deal_has_stage(deals):
    for d in deals:
        assert d["stage"] in STAGES or (d["stage"] == "Needs review" and d["needs_review"])


# 3. raw status preserved verbatim
def test_raw_status_preserved(deals):
    wb = openpyxl.load_workbook(WB)
    for d in deals:
        ws = wb[d["source_tab"]]
        col = [str(c.value).strip().lower() for c in ws[1]].index("status") + 1
        raw = ws.cell(d["source_row"], col).value
        assert d["stage_raw"] == (str(raw).strip() if raw else None)


# 4. known variants map correctly
@pytest.mark.parametrize("raw,expected", [
    ("sourcing", "Sourcing"), ("SOURCING", "Sourcing"), ("Sourcing", "Sourcing"),
    ("nego PSA", "Negotiating PSA"), ("Negotiating PSA", "Negotiating PSA"),
    ("in pipeline", "In Pipeline"), ("pre loi", "Pre LOI"),
    ("Under Contract", "In Contract"), ("On Hold", "On Hold"),
])
def test_status_mapping(deals, raw, expected):
    hits = [d for d in deals if d["stage_raw"] == raw]
    assert hits, f"variant {raw!r} not present in data"
    assert all(d["stage"] == expected for d in hits)


def test_listed_goes_to_review_not_guessed(deals):
    listed = [d for d in deals if d["stage_raw"] == "Listed"]
    assert listed and all(d["stage"] == "Needs review" for d in listed)


# 5. blank != zero
def test_zero_vs_blank(deals):
    culver = next(d for d in deals if d["address"] == "5861 Washington Blvd")
    torrance = next(d for d in deals if d["address"] == "2426 Amsler St")
    assert culver["attributes"]["dock_high_doors"] == 0
    assert "dock_high_doors" not in torrance["attributes"]
    assert torrance["bldg_sf"] is None and torrance["price_per_sf"] is None


# 6. derived math matches sheet, mismatch is flagged not hidden
def test_derived_math_mismatch_flagged(deals):
    seattle = next(d for d in deals if d["address"] == "37 S Hudson St")
    assert seattle["price_per_sf"] == 217.77
    assert any("price_per_sf" in r for r in seattle["review_reasons"])


def test_derived_math_otherwise_matches(deals):
    for d in deals:
        if d["price_per_sf"] is not None and not any("price_per_sf:" in r for r in d["review_reasons"]):
            assert d["price_per_sf"] == round(d["list_price"] / d["bldg_sf"], 2)


# 7. no source column disappears
@pytest.mark.parametrize("tab", deal_tabs())
def test_no_column_lost(deals, tab):
    ws = openpyxl.load_workbook(WB)[tab]
    for row in source_rows(tab):
        d = next(x for x in deals if x["source_tab"] == tab and x["source_row"] == row[0].row)
        non_null_src = sum(1 for c in row if c.value not in (None, ""))
        core = sum(1 for k in ("client", "market", "city", "address", "stage_raw", "bldg_sf",
                               "list_price", "lot_sf", "broker", "broker_phone", "notes")
                   if d.get(k) is not None)
        core += d["state"] is not None and not d["state_inferred"]
        derived_sheet_cols = sum(1 for c in row if c.value is not None and
                                 str(ws.cell(1, c.column).value).lower().startswith("list price/"))
        assert core + len(d["attributes_raw"]) + derived_sheet_cols == non_null_src


# 8. assumptions (coloured text) preserved one-for-one
def test_assumptions_preserved(deals, result):
    wb = openpyxl.load_workbook(WB)
    coloured = sum(1 for t in deal_tabs() for row in source_rows(t) for c in row
                   if c.value is not None and font_key(c) not in DEFAULT_FONT_COLORS)
    assert result[2]["totals"]["assumed_cells"] == coloured
    atl = next(d for d in deals if d["address"] == "635 Angier Ave")
    assert "power_amps" in atl["assumed_fields"]


# 9. idempotent
def test_idempotent(tmp_path):
    a, _, _ = main(WB, tmp_path / "a")
    b, _, _ = main(WB, tmp_path / "b")
    assert a == b and len({d["id"] for d in a}) == len(a)


# extras
def test_rows_without_address_kept(deals):
    assert len([d for d in deals if d["address"] is None]) >= 5


def test_contact_cross_reference(result):
    contacts = result[1]
    ford = next(c for c in contacts if c["contact_name"] == "James Ford")
    assert ford["linked_deals"] == ["av_clientC_atl:2"]


def test_unknown_tab_prefix_is_imported_and_flagged(tmp_path, monkeypatch):
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = "unknown_market"
    sheet.append(
        [
            "Client",
            "Metro",
            "City",
            "State",
            "Address",
            "Status",
            "Bldg SF",
            "List Price",
            "Lot SF",
            "Broker",
            "Phone",
            "Notes",
        ]
    )
    sheet.append(
        [
            "Client A",
            "Seattle",
            "Seattle",
            "WA",
            "1 Test St",
            "Sourcing",
            1000,
            100000,
            5000,
            "Test Broker",
            "555-0100",
            None,
        ]
    )
    path = tmp_path / "unknown.xlsx"
    workbook.save(path)

    deals, _, report = main(path, tmp_path / "out")

    assert len(deals) == 1
    assert deals[0]["vertical"] is None
    assert deals[0]["unconfigured_tab"] is True
    assert deals[0]["needs_review"] is True
    assert "unknown_market" in report["unconfigured_tabs"]
