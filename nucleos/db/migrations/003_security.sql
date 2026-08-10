-- 003_security.sql
-- Enterprise security additions: per-case ownership, ACL, and signed audit trail.

-- ── Per-case ownership + tenant isolation (legacy cases table) ────────────────
ALTER TABLE cases ADD COLUMN IF NOT EXISTS owner_sub TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS tenant_id  TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_cases_tenant   ON cases(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cases_owner    ON cases(owner_sub);

-- ── Per-case fine-grained ACL (row-level access beyond tenant) ────────────────
CREATE TABLE IF NOT EXISTS case_acl (
    case_id    UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
    sub        TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'analyst',  -- admin|analyst|viewer
    granted_by TEXT,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (case_id, sub)
);

CREATE INDEX IF NOT EXISTS idx_case_acl_sub ON case_acl(sub);

-- ── Signed audit trail ────────────────────────────────────────────────────────
-- hmac_sha256: HMAC-SHA256 hex digest of canonical event payload
-- actor_sub:   JWT sub of the actor who triggered the event (for tamper detection)
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS hmac_sha256 TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_sub   TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_sub);
