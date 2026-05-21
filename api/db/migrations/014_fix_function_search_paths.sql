-- Migration 014: Fix mutable search_path on three functions
-- ---------------------------------------------------------------------------
-- Supabase linter (0011_function_search_path_mutable) flags functions whose
-- search_path is not locked.  A mutable search_path is a privilege-escalation
-- vector: an attacker who can create objects in a schema that appears early in
-- the search_path can shadow built-ins or trusted functions.
--
-- Fix: ALTER FUNCTION ... SET search_path = '' pins the search_path to empty,
-- forcing all names inside the function body to be resolved via their fully
-- qualified schema prefix (or via pg_catalog, which is always searched last
-- regardless of search_path).  All three functions below already use either
-- built-in operators / pg_catalog functions (which need no qualification) or
-- fully schema-qualified names (auth.jwt(), now()), so the empty search_path
-- does not require any body changes.
-- ---------------------------------------------------------------------------

-- public.set_updated_at() — trigger function used by updated_at columns
ALTER FUNCTION public.set_updated_at()
    SET search_path = '';

-- public.current_tenant_id() — reads app.current_tenant_id session var,
-- falls back to auth.jwt() sub claim (already schema-qualified in body)
ALTER FUNCTION public.current_tenant_id()
    SET search_path = '';

-- cbam.check_verification_transition(text, text) — pure JSONB logic,
-- no external schema references in body
ALTER FUNCTION cbam.check_verification_transition(text, text)
    SET search_path = '';
