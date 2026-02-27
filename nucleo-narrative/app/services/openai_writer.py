import json
from openai import OpenAI
from app.core.config import settings


def _legacy_writer_prompt(packet: dict) -> str:
    return (
        "You are generating an audit-grade carbon emissions narrative.\n"
        "Return ONLY valid JSON. Do not include markdown, explanations, or commentary.\n"
        "Use ONLY the provided JSON packet. Do not invent numbers, documents, dates, or sources.\n"
        "If data is missing or low confidence, state this clearly in the appropriate fields.\n\n"
        "The JSON MUST follow this exact schema:\n"
        "{\n"
        '  "executive_summary": "string",\n'
        '  "methodology": "string",\n'
        '  "results": {\n'
        '    "total_emissions_kgco2e": number,\n'
        '    "scope_1_kgco2e": number,\n'
        '    "scope_2_kgco2e": number,\n'
        '    "intensity_kgco2e_per_unit": number\n'
        '  },\n'
        '  "limitations": "string",\n'
        '  "open_gaps": [\n'
        '    {\n'
        '      "field": "string",\n'
        '      "issue": "string",\n'
        '      "current_confidence": number,\n'
        '      "target_confidence": number\n'
        '    }\n'
        '  ]\n'
        "}\n\n"
        "JSON packet:\n"
        + json.dumps(packet, indent=2)
    )


def _cbam_writer_prompt(packet: dict) -> str:
    return (
        "You are generating an audit-grade CBAM quarterly narrative.\n"
        "Return ONLY valid JSON. Do not include markdown, explanations, or commentary.\n"
        "Use ONLY the provided JSON packet. Do not invent numbers, documents, dates, or sources.\n"
        "Do NOT invent electricity or natural gas content for CBAM packets.\n"
        "Use these packet sections directly:\n"
        "- case: importer_eori, reporting_year, reporting_quarter\n"
        "- shipments[].goods_lines[].goods_line: cn_code, quantity or net_mass\n"
        "- shipments[].goods_lines[].latest_emissions: direct_embedded_kgco2e, indirect_embedded_kgco2e, method, version\n"
        "- summary totals\n"
        "- data_quality.warnings\n"
        "open_gaps must be derived from: missing emissions warnings, missing/empty shipments/goods_lines, and data_quality warnings.\n\n"
        "The JSON MUST follow this exact schema:\n"
        "{\n"
        '  "executive_summary": "string",\n'
        '  "methodology": "string",\n'
        '  "results": {\n'
        '    "total_direct_embedded_kgco2e": number,\n'
        '    "total_indirect_embedded_kgco2e": number,\n'
        '    "total_embedded_kgco2e": number,\n'
        '    "total_net_mass_kg": number,\n'
        '    "goods_lines_count": number\n'
        '  },\n'
        '  "limitations": "string",\n'
        '  "open_gaps": [\n'
        '    {\n'
        '      "field": "string",\n'
        '      "issue": "string",\n'
        '      "current_confidence": number,\n'
        '      "target_confidence": number\n'
        '    }\n'
        '  ]\n'
        "}\n\n"
        "JSON packet:\n"
        + json.dumps(packet, indent=2)
    )


def _writer_prompt(packet: dict) -> str:
    if packet.get("type") == "cbam_report_package_v1":
        return _cbam_writer_prompt(packet)
    return _legacy_writer_prompt(packet)

def generate_draft(packet: dict) -> dict:
    client = OpenAI(api_key=settings.openai_api_key)

    resp = client.responses.create(
        model=settings.openai_model,
        input=_writer_prompt(packet),
        temperature=0.2,
        text={"format": {"type": "json_object"}},
    )

    raw = resp.output_text or ""

    try:
        parsed = json.loads(raw)
    except Exception as e:
        raise ValueError(f"OpenAI draft did not return valid JSON: {e}")

    required_keys = [
        "executive_summary",
        "methodology",
        "results",
        "limitations",
        "open_gaps",
    ]

    for key in required_keys:
        if key not in parsed:
            raise ValueError(f"OpenAI draft missing required key: {key}")

    return parsed
