# Risk Register

**Owner:** Nucleos Compliance Ltd
**Status:** SOC 2 Type I evidence artefact (internal)
**Last reviewed:** June 2026

Top risks to the confidentiality, integrity, and availability of operational data
held in Arbor, with mitigations. Likelihood/impact are L/M/H.

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|------------|--------|------------|
| 1 | **Data breach / unauthorised access** | M | H | Role-based access, mandatory 2FA for admins, entity-scoped API keys (bcrypt-hashed), `tokenVersion` session revocation, TLS 1.3, AES-256 at rest. See WISP §2–3. |
| 2 | **Extraction error writes a wrong value** | M | M | Confidence threshold (0.85) with calibration for non-English/degraded docs; sub-threshold fields are routed to human review and never silently accepted; corrections create superseding records, never overwrite. |
| 3 | **Audit-chain failure / tampering** | L | H | HMAC-SHA256 chain per entity; `verifyChain` on demand; public package-hash verification; secret stored only in env, never logged. Incident path: INCIDENT_RESPONSE §4. |
| 4 | **Third-party / sub-processor failure or breach** | M | M | DPA with sub-processor list; credentials encrypted (AES-256-GCM); rate limiting fails open but logs; integration credentials never returned in API responses. |
| 5 | **GDPR enforcement / data-subject rights** | L | M | DPA, privacy policy, data minimisation (we store provenance, not derived outputs); entity-scoped data is private by default and shared only by deliberate, revocable grant. |

## Review

This register is reviewed at least annually and after any SEV-1/SEV-2 incident.
New risks are added with an owner and a target mitigation date.
