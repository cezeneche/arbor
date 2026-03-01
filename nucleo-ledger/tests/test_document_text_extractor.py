from __future__ import annotations

from io import BytesIO

from PIL import Image, ImageDraw

from app.services import document_text_extractor


def _build_minimal_pdf_with_text(text: str) -> bytes:
    escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    content_stream = f"BT\n/F1 18 Tf\n72 720 Td\n({escaped}) Tj\nET\n".encode("latin-1")

    objects: list[bytes] = [
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
        (
            b"3 0 obj\n"
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\n"
            b"endobj\n"
        ),
        b"4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
        (
            b"5 0 obj\n"
            + f"<< /Length {len(content_stream)} >>\n".encode("ascii")
            + b"stream\n"
            + content_stream
            + b"endstream\nendobj\n"
        ),
    ]

    pdf = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = [0]
    for obj in objects:
        offsets.append(len(pdf))
        pdf.extend(obj)

    xref_start = len(pdf)
    pdf.extend(f"xref\n0 {len(offsets)}\n".encode("ascii"))
    pdf.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode("ascii"))

    pdf.extend(
        (
            f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\n"
            f"startxref\n{xref_start}\n%%EOF\n"
        ).encode("ascii")
    )
    return bytes(pdf)


def test_extract_text_from_upload_image_returns_text_with_inv(monkeypatch):
    monkeypatch.delenv("OCR_DISABLED", raising=False)
    monkeypatch.setattr(
        document_text_extractor,
        "_extract_image_document_with_paddleocr",
        lambda _data: {
            "raw_text": "Invoice INV-IMG-001",
            "ocr_lines": [],
            "layout": {"blocks": []},
        },
    )

    image = Image.new("RGB", (420, 120), color="white")
    draw = ImageDraw.Draw(image)
    draw.text((10, 40), "Invoice INV-IMG-001", fill="black")

    buf = BytesIO()
    image.save(buf, format="PNG")
    payload = buf.getvalue()

    text = document_text_extractor.extract_text_from_upload(
        filename="invoice_photo.png",
        content_type="image/png",
        data=payload,
    )

    assert isinstance(text, str)
    assert "INV" in text.upper()


def test_extract_text_from_upload_image_when_ocr_disabled(monkeypatch):
    monkeypatch.setenv("OCR_DISABLED", "1")
    monkeypatch.setattr(
        document_text_extractor,
        "_extract_image_document_with_paddleocr",
        lambda _data: (_ for _ in ()).throw(AssertionError("OCR should not be called")),
    )

    image = Image.new("RGB", (60, 40), color="white")
    buf = BytesIO()
    image.save(buf, format="PNG")
    payload = buf.getvalue()

    text = document_text_extractor.extract_text_from_upload(
        filename="invoice_photo.png",
        content_type="image/png",
        data=payload,
    )
    assert text == ""


def test_extract_text_from_upload_pdf_returns_invoice_token():
    pdf_bytes = _build_minimal_pdf_with_text("Invoice INV-PDF-001")
    text = document_text_extractor.extract_text_from_upload(
        filename="invoice_TEST.pdf",
        content_type="application/pdf",
        data=pdf_bytes,
    )
    assert "INV-PDF-001" in text
