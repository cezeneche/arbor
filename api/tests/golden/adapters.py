"""Adapters that run one golden case and return a JSON-comparable result.

Each adapter is the thinnest possible call into production code. Anything it
does beyond marshalling the input and normalising the output is behaviour the
golden set would be testing about itself rather than about the engine.

Determinism is a precondition, not an aspiration: an adapter that can return
two different answers for the same input cannot pin anything. The live
extraction adapter therefore runs the regex-only path, which is what the
extractor falls back to when no API key is present.
"""
from __future__ import annotations

import dataclasses
import os
import tempfile
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable

__all__ = ["ADAPTERS", "VOLATILE_KEYS", "normalise", "run_case"]

# Fields the engine stamps from the clock at build time. They differ on every
# run, so a golden case containing one can never pass twice.
#
# They are replaced with a marker rather than dropped, so the case still proves
# the field is present and still a string — only its value stops being asserted.
# Keep this list short and explicit: every key added here is one the golden set
# stops checking, and a genuinely wrong value hides just as well as a volatile
# one behind a marker.
VOLATILE_KEYS = frozenset({"generated_at"})

_VOLATILE_MARKER = "<volatile>"


def normalise(value: Any) -> Any:
    """Convert an engine result into stable, JSON-comparable data.

    Decimals become strings rather than floats: a golden file holding 0.1 as a
    float would compare equal to a value that is not 0.1, which defeats the
    point of freezing an exact figure.
    """
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return normalise(dataclasses.asdict(value))
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {
            str(k): (_VOLATILE_MARKER if str(k) in VOLATILE_KEYS and v is not None
                     else normalise(v))
            for k, v in sorted(value.items(), key=lambda kv: str(kv[0]))
        }
    if isinstance(value, (list, tuple)):
        return [normalise(v) for v in value]
    if isinstance(value, (str, int, bool)) or value is None:
        return value
    if isinstance(value, float):
        # Round-trip through repr so the frozen text is the exact float.
        return value
    return str(value)


def _customs_declaration(inp: dict[str, Any]) -> Any:
    from ledger_app.services.cbam_customs_parser import (
        is_customs_declaration,
        parse_customs_declaration,
    )

    text = inp["text"]
    return {
        "detected": is_customs_declaration(text),
        "parsed": parse_customs_declaration(text),
    }


def _mill_certificate(inp: dict[str, Any]) -> Any:
    from ledger_app.services.cbam_mill_cert_parser import (
        is_mill_certificate,
        parse_mill_certificate,
    )

    text = inp["text"]
    return {
        "detected": is_mill_certificate(text),
        "parsed": parse_mill_certificate(text),
    }


def _spreadsheet_csv(inp: dict[str, Any]) -> Any:
    from ledger_app.services.cbam_spreadsheet_parser import parse_csv

    return parse_csv(inp["csv"].encode(inp.get("encoding", "utf-8")))


def _xml_declaration(inp: dict[str, Any]) -> Any:
    from ledger_app.services.cbam_xml_declaration_parser import (
        parse_cbam_xml_declaration,
    )

    return parse_cbam_xml_declaration(inp["xml"].encode("utf-8"))


def _live_extraction(inp: dict[str, Any]) -> Any:
    """The production extraction path with its Claude gap-fill absent.

    Removing ANTHROPIC_API_KEY selects the extractor's own regex-only fallback,
    so what is frozen here is the deterministic layer exactly as production runs
    it when the model is unavailable. The Claude merge rules are covered by
    their own unit tests; they cannot be frozen because their input is not
    reproducible.
    """
    from ledger_app.services import cbam_extractor

    previous = os.environ.pop("ANTHROPIC_API_KEY", None)
    tmp = Path(tempfile.mkdtemp()) / "document.txt"
    tmp.write_text(inp["text"], encoding="utf-8")
    try:
        return cbam_extractor.extract(str(tmp))
    finally:
        if previous is not None:
            os.environ["ANTHROPIC_API_KEY"] = previous
        tmp.unlink(missing_ok=True)


def _emissions_selection(inp: dict[str, Any]) -> Any:
    from ledger_app.services.cbam_emissions_selector import select_and_calculate

    kwargs = dict(inp)
    for money in ("net_mass_kg", "direct_kgco2e_supplier", "indirect_kgco2e_supplier"):
        if kwargs.get(money) is not None:
            kwargs[money] = Decimal(str(kwargs[money]))
    return select_and_calculate(**kwargs)


def _free_allocation(inp: dict[str, Any]) -> Any:
    from app.services.cbam_free_allocation import (
        get_cbam_application_factor,
        get_free_allocation_factor,
    )

    return {
        str(year): {
            "free_allocation_factor": get_free_allocation_factor(year),
            "cbam_application_factor": get_cbam_application_factor(year),
        }
        for year in inp["years"]
    }


def _default_value_markup(inp: dict[str, Any]) -> Any:
    from app.services.cbam_default_markup import get_default_value_markup

    return {
        f"{juris}:{year}": get_default_value_markup(year, juris)
        for juris in inp["jurisdictions"]
        for year in inp["years"]
    }


def _hmrc_return(inp: dict[str, Any]) -> Any:
    from app.services.hmrc_return_builder import HMRCReturnInput, build_hmrc_return

    payload = dict(inp["return_input"])
    payload["cbam_rate_gbp_per_tco2e"] = Decimal(str(payload["cbam_rate_gbp_per_tco2e"]))
    return build_hmrc_return(inp["report_package"], HMRCReturnInput(**payload))


ADAPTERS: dict[str, Callable[[dict[str, Any]], Any]] = {
    "customs_declaration": _customs_declaration,
    "mill_certificate": _mill_certificate,
    "spreadsheet_csv": _spreadsheet_csv,
    "xml_declaration": _xml_declaration,
    "live_extraction": _live_extraction,
    "emissions_selection": _emissions_selection,
    "free_allocation": _free_allocation,
    "default_value_markup": _default_value_markup,
    "hmrc_return": _hmrc_return,
}


def run_case(adapter: str, inp: dict[str, Any]) -> Any:
    if adapter not in ADAPTERS:
        raise KeyError(
            f"Unknown golden adapter {adapter!r}. "
            f"Known adapters: {', '.join(sorted(ADAPTERS))}"
        )
    return normalise(ADAPTERS[adapter](inp))
