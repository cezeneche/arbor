from __future__ import annotations

import os

from fastapi import HTTPException


def _is_text(filename: str, content_type: str | None) -> bool:
    lower_name = filename.lower()
    return lower_name.endswith(".txt") or bool(content_type and content_type.startswith("text/"))


def _is_image(filename: str, content_type: str | None) -> bool:
    lower_name = filename.lower()
    return lower_name.endswith((".png", ".jpg", ".jpeg")) or bool(
        content_type and content_type.startswith("image/")
    )


def _decode_text_bytes(data: bytes) -> str:
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("latin-1")


def _to_sequence(value):
    if isinstance(value, (str, bytes)):
        return None
    if isinstance(value, (list, tuple)):
        return list(value)
    try:
        return list(value)
    except Exception:
        return None


def _bbox_to_xy(bbox) -> tuple[float, float] | None:
    seq = _to_sequence(bbox)
    if not seq:
        return None

    first = seq[0]
    first_seq = _to_sequence(first)
    if first_seq and len(first_seq) >= 2:
        try:
            return float(first_seq[0]), float(first_seq[1])
        except (TypeError, ValueError):
            return None

    if len(seq) >= 2:
        try:
            return float(seq[0]), float(seq[1])
        except (TypeError, ValueError):
            return None
    return None


def _normalize_ocr_result(result) -> list[tuple[float, float, str]]:
    rows: list[tuple[float, float, str]] = []
    seen: set[tuple[float, float, str]] = set()

    def add_text(text, bbox=None) -> None:
        if text is None:
            return
        text_value = str(text).strip()
        if not text_value:
            return
        coords = _bbox_to_xy(bbox)
        if coords is None:
            item = (1e12, 1e12, text_value)
        else:
            x, y = coords
            item = (y, x, text_value)
        if item not in seen:
            seen.add(item)
            rows.append(item)

    def walk(node) -> None:
        if node is None:
            return

        if isinstance(node, dict):
            rec_texts = node.get("rec_texts")
            if isinstance(rec_texts, (list, tuple)):
                poly_candidates = (
                    node.get("dt_polys")
                    or node.get("rec_polys")
                    or node.get("dt_boxes")
                    or node.get("rec_boxes")
                    or []
                )
                polys = _to_sequence(poly_candidates) or []
                for idx, text_item in enumerate(rec_texts):
                    bbox_item = polys[idx] if idx < len(polys) else None
                    add_text(text_item, bbox_item)

            text = node.get("rec_text") or node.get("text") or node.get("label")
            bbox = (
                node.get("dt_polys")
                or node.get("dt_boxes")
                or node.get("bbox")
                or node.get("box")
                or node.get("points")
            )
            if text is not None:
                add_text(text, bbox)

            for value in node.values():
                if isinstance(value, (list, tuple, dict)):
                    walk(value)
            return

        if isinstance(node, (list, tuple)):
            if len(node) >= 2:
                bbox = node[0]
                text_info = node[1]
                text = None
                if isinstance(text_info, (list, tuple)) and text_info:
                    text = text_info[0]
                elif isinstance(text_info, str):
                    text = text_info
                if text is not None:
                    add_text(text, bbox)
                    return

            for item in node:
                if isinstance(item, (list, tuple, dict)):
                    walk(item)

    walk(result)
    rows.sort(key=lambda row: (row[0], row[1]))
    return rows


def _extract_text_with_paddleocr(data: bytes) -> str:
    try:
        import cv2  # type: ignore
        import numpy as np  # type: ignore
        from paddleocr import PaddleOCR  # type: ignore
    except Exception as exc:
        raise HTTPException(status_code=500, detail="paddleocr not installed") from exc

    arr = np.frombuffer(data, dtype=np.uint8)
    image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=422, detail="Unable to decode image data")

    try:
        ocr = PaddleOCR(use_textline_orientation=True, lang="en")
    except TypeError:
        # older PaddleOCR constructors
        ocr = PaddleOCR(use_angle_cls=True, lang="en")

    try:
        result = ocr.predict(image)
    except TypeError:
        # older versions
        result = ocr.ocr(image)

    normalized = _normalize_ocr_result(result)
    if not normalized:
        return ""
    return "\n".join(text for _, _, text in normalized)


def extract_text_from_upload(filename: str, content_type: str | None, data: bytes) -> str:
    if _is_text(filename, content_type):
        return _decode_text_bytes(data)

    if _is_image(filename, content_type):
        if os.getenv("OCR_DISABLED") == "1":
            return ""
        return _extract_text_with_paddleocr(data)

    raise HTTPException(status_code=415, detail="Unsupported file type")
