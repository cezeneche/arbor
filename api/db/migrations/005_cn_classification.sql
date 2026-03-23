-- Migration 005: CN code classification confidence tracking
-- Adds columns to track how a CN code was determined and how confident the system is.
-- cn_classification_confidence: 0.00–1.00 Decimal, NULL means not yet classified
-- cn_classification_method: "keyword" | "llm" | "combined" | "extracted_from_text" | "hint" | "manual"
-- cn_requires_review: boolean flag, True means the UI should prompt the user to verify

ALTER TABLE cbam.cbam_goods_lines
    ADD COLUMN IF NOT EXISTS cn_classification_confidence NUMERIC,
    ADD COLUMN IF NOT EXISTS cn_classification_method     TEXT,
    ADD COLUMN IF NOT EXISTS cn_requires_review           BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_cbam_goods_lines_review
    ON cbam.cbam_goods_lines(cn_requires_review)
    WHERE cn_requires_review = TRUE;
