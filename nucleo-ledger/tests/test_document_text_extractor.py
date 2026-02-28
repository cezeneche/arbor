from __future__ import annotations

from io import BytesIO

from PIL import Image, ImageDraw

from app.services import document_text_extractor


def test_extract_text_from_upload_image_returns_text_with_inv(monkeypatch):
    monkeypatch.delenv("OCR_DISABLED", raising=False)
    monkeypatch.setattr(
        document_text_extractor,
        "_extract_text_with_paddleocr",
        lambda _data: "Invoice INV-IMG-001",
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
        "_extract_text_with_paddleocr",
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
