# Incident Response Plan

**Owner:** Nucleos Compliance Ltd
**Status:** SOC 2 Type I evidence artefact (internal)
**Last reviewed:** June 2026

## 1. Definitions

An **incident** is any event that compromises the confidentiality, integrity, or
availability of operational data held in Arbor, or of the systems that hold it.

Severity levels:
- **SEV-1** — confirmed data breach, audit-chain compromise, or full outage.
- **SEV-2** — partial outage, suspected unauthorised access, sub-processor breach.
- **SEV-3** — degraded service, isolated extraction errors, single-account abuse.

## 2. Roles

- **Incident lead** — coordinates response, owns the timeline.
- **Comms owner** — handles customer and regulator notification.
- **Technical responder** — investigates and remediates.

## 3. Procedure

1. **Detect & record.** Open an incident record with timestamp, severity, and
   first observation.
2. **Contain.** For suspected account compromise, bump the user's `tokenVersion`
   to revoke all sessions and rotate affected API keys. For a sub-processor
   breach, revoke the relevant credentials.
3. **Assess.** Determine scope: which entities, which records, which period.
   Verify the audit chain (`/api/audit/[entityId]/verify`) to confirm whether any
   stored record was altered.
4. **Eradicate & recover.** Patch the cause; restore from a known-good state.
   Records are never silently corrected — corrections create superseding records.
5. **Notify.** For personal-data breaches, notify the ICO within 72 hours where
   required by UK GDPR, and notify affected entities. Use the supersession
   notification path for any record correction.
6. **Review.** Within 5 working days, complete a post-incident review with root
   cause and preventive actions.

## 4. Audit-chain compromise

If `verifyChain` fails for any entity: treat as SEV-1. The chain is HMAC-linked,
so a failure means either a record payload was altered or the secret was
exposed. Rotate `AUDIT_CHAIN_SECRET` only after forensic capture, because a
rotation re-bases all subsequent hashes.

## 5. Contacts

- Security disclosures: security@arbor.io (responsible disclosure).
- Sub-processor contacts: see DPA appendix.
