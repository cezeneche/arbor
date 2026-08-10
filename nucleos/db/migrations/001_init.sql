-- 001_init.sql
-- Core entities for audit-ready, versioned Scope 3/CBAM workflow

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1) Cases: the unit of work (supplier + period + product set)
CREATE TABLE IF NOT EXISTS cases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  external_ref TEXT,
  supplier_name TEXT NOT NULL,
  supplier_country TEXT,
  reporting_period_start DATE NOT NULL,
  reporting_period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'created', -- created|ingested|calculated|narrative_drafted|reconciled|recommended|submitted|signed_off|error
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2) Documents: raw evidence files (in MinIO/S3)
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT,
  storage_uri TEXT NOT NULL,            -- e.g. s3://scope3-evidence/cases/{case_id}/raw/...
  sha256 TEXT NOT NULL,
  doc_type TEXT,                        -- invoice|bill|transport|production|other
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3) Extractions: structured facts extracted from documents (versioned)
CREATE TABLE IF NOT EXISTS extractions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  version INT NOT NULL DEFAULT 1,
  extracted_json JSONB NOT NULL,         -- canonical extracted dataset
  extraction_confidence NUMERIC(5,2),     -- 0.00 - 100.00 (optional)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(case_id, version)
);

-- 4) Calculations: emissions calculation outputs (versioned)
CREATE TABLE IF NOT EXISTS calculations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  version INT NOT NULL DEFAULT 1,
  method_version TEXT NOT NULL DEFAULT 'v1',
  results_json JSONB NOT NULL,           -- calculation package (numbers, assumptions, data quality flags)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(case_id, version)
);

-- 5) Narratives: model-generated narrative drafts (versioned + provenance)
CREATE TABLE IF NOT EXISTS narratives (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  iteration INT NOT NULL DEFAULT 1,
  source_models TEXT[] NOT NULL,         -- e.g. {"gpt","claude","gemini"}
  narrative_text TEXT NOT NULL,
  notes_json JSONB,                      -- issues found, human judgement points, etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(case_id, iteration)
);

-- 6) Reconciliations: Co-Pilot checks narrative vs calculations
CREATE TABLE IF NOT EXISTS reconciliations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  narrative_id UUID NOT NULL REFERENCES narratives(id) ON DELETE CASCADE,
  calculation_id UUID NOT NULL REFERENCES calculations(id) ON DELETE CASCADE,
  passed BOOLEAN NOT NULL,
  diffs_json JSONB,                      -- list of mismatches, required corrections
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7) Recommendations: Perplexity advisory outputs with citations (separate from compliance)
CREATE TABLE IF NOT EXISTS recommendations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  calculation_id UUID NOT NULL REFERENCES calculations(id) ON DELETE CASCADE,
  recommendations_json JSONB NOT NULL,   -- category-specific recs + citations
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8) Human sign-off: accountability record
CREATE TABLE IF NOT EXISTS signoffs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  reviewer_name TEXT NOT NULL,
  reviewer_email TEXT,
  decision TEXT NOT NULL,                -- approved|rejected|needs_changes
  comments TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9) Audit log: append-only event trail
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID REFERENCES cases(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,              -- case_created|doc_uploaded|ingested|calculated|narrative_created|reconciled|recommended|signed_off|error
  actor_type TEXT NOT NULL DEFAULT 'system', -- system|human|service
  actor_id TEXT,
  event_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_documents_case ON documents(case_id);
CREATE INDEX IF NOT EXISTS idx_extractions_case ON extractions(case_id);
CREATE INDEX IF NOT EXISTS idx_calculations_case ON calculations(case_id);
CREATE INDEX IF NOT EXISTS idx_narratives_case ON narratives(case_id);
CREATE INDEX IF NOT EXISTS idx_reconciliations_case ON reconciliations(case_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_case ON recommendations(case_id);
CREATE INDEX IF NOT EXISTS idx_audit_case ON audit_log(case_id);
