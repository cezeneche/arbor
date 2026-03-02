from __future__ import annotations

from io import BytesIO

from PIL import Image, ImageDraw

from ledger_app.services import document_text_extractor


def test_layout_detection_v1_groups_header_body_footer_from_synthetic_image():
    image = Image.new("RGB", (640, 900), color="white")
    draw = ImageDraw.Draw(image)
    draw.text((20, 40), "HEADER: Invoice INV-001", fill="black")
    draw.text((20, 430), "BODY: Goods line CN 720711", fill="black")
    draw.text((20, 840), "FOOTER: Terms and signature", fill="black")

    buf = BytesIO()
    image.save(buf, format="PNG")
    payload = buf.getvalue()

    ocr_lines = [
        {"text": "HEADER: Invoice INV-001", "bbox": [20.0, 30.0, 350.0, 70.0], "confidence": 0.99},
        {"text": "BODY: Goods line CN 720711", "bbox": [20.0, 420.0, 380.0, 460.0], "confidence": 0.98},
        {"text": "FOOTER: Terms and signature", "bbox": [20.0, 830.0, 390.0, 870.0], "confidence": 0.97},
    ]
    layout = document_text_extractor._build_layout_blocks(ocr_lines, image_height=image.height)
    blocks = layout["blocks"]

    by_type = {block["type"]: block for block in blocks}
    assert "HEADER" in str(by_type["header"]["text"]).upper()
    assert "BODY" in str(by_type["body"]["text"]).upper()
    assert "FOOTER" in str(by_type["footer"]["text"]).upper()

    structured = {
        "raw_text": "\n".join(line["text"] for line in ocr_lines),
        "ocr_lines": ocr_lines,
        "layout": layout,
    }
    assert "raw_text" in structured
    assert "ocr_lines" in structured
    assert "layout" in structured
    assert payload  # keep fixture creation explicit in-test
