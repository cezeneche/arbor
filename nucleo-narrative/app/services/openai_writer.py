import json
from openai import OpenAI
from app.core.config import settings

def _writer_prompt(packet: dict) -> str:
    return (
        "Write an auditor-friendly emissions narrative in British English.\n"
        "Use ONLY the JSON packet. Do not invent numbers, documents, dates, or sources.\n"
        "If data is missing or low confidence, say so explicitly and reference the packet sections.\n\n"
        "Output markdown with headings:\n"
        "## Executive summary\n"
        "## Inputs and evidence\n"
        "## Method and factor set\n"
        "## Results\n"
        "## Data quality and controls\n"
        "## Open gaps and next actions\n\n"
        "JSON packet:\n"
        + json.dumps(packet, indent=2)
    )

def generate_draft(packet: dict) -> str:
    client = OpenAI(api_key=settings.openai_api_key)
    resp = client.responses.create(
        model=settings.openai_model,
        input=_writer_prompt(packet),
        temperature=0.2,
    )
    return resp.output_text or ""
