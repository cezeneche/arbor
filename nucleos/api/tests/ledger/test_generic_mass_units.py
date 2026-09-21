"""The generic extractor's reading of a declared mass.

net_mass_kg is kilograms by name, and the unit beside the number was ignored on
this path as well as in the customs parser: an invoice stating 24.5 t produced
24.5. The figure is what the embedded emissions and the CBAM charge are
computed from, so a thousandfold error here is a thousandfold error on the
return.
"""

from __future__ import annotations

import pytest

from ledger_app.services.text_ingest import run_text_ingest


def _mass(text: str) -> float | None:
    lines = run_text_ingest(text)["candidate"].get("lines") or []
    return lines[0].get("net_mass_kg") if lines else None


@pytest.mark.parametrize(
    ("stated", "expected_kg"),
    [
        ("Net mass: 24500 kg", 24500),
        ("Net mass: 24.5 t", 24500),
        ("Net mass: 24.5 tonnes", 24500),
        ("Net mass: 24,500.00 kg", 24500),
    ],
)
def test_the_mass_is_read_in_the_unit_the_invoice_states(stated, expected_kg):
    text = f"COMMERCIAL INVOICE\nCN code: 72083900\n{stated}\n"
    assert _mass(text) == pytest.approx(expected_kg)


def test_a_negative_mass_is_not_read_as_a_positive_one():
    # The sign was dropped by the capture, turning -24500 into 24500 rather
    # than refusing a mass that cannot exist.
    text = "COMMERCIAL INVOICE\nCN code: 72083900\nNet mass: -24500 kg\n"
    assert _mass(text) != 24500
