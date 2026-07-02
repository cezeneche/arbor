# Arbor — Defensibility Master Plan (12 Upgrades)

> **Status of this document.** This is the **master plan** — the source of truth
> from which the integration / implementation plan and all sequencing derive.
> The 12 upgrades below are grouped by pillar; each carries a shipping target, a
> technology stack, and a kill signal. When in doubt about *why* something is
> being built, this document is the root reference.
>
> **Last status update:** 2026-07-01. Working notes and file-level detail live in
> the session memory (`memory/arbor-12-upgrade-plan.md`); this file is the durable,
> in-repo reference.

## Status legend
- ✅ **Done** — built and (where noted) verified.
- 🟡 **Partial** — core shipped; specific sub-parts still pending (listed).
- ⬜ **Not started.**
- 🕓 **Deferred by design** — do not start until a stated precondition is met.

## Status at a glance

| # | Upgrade | Pillar | Status |
|---|---------|--------|--------|
| 1 | Bayesian fusion + calibration measurement | A | 🟡 measurement loop closed; model-class sub-parts pending |
| 2 | Information theory (schema + active learning) | A | ⬜ |
| 3 | Maximum-entropy completion under constraints | A | ⬜ |
| 4 | Property graph as primary representation | B | ⬜ |
| 5 | Entity resolution — HNSW + optimal transport | B | ⬜ (OT escalation 🕓) |
| 6 | Lattice-theoretic tier composition | C | ✅ |
| 7 | Merkle-DAG audit structure | C | 🟡 productized into audit package + browser verifier; shadow-compare running |
| 8 | Zero-knowledge proofs for predicate compliance | C | ⬜ |
| 9 | Graph flow consistency across supply chain | D | ⬜ |
| 10 | Differential privacy on cross-tenant aggregates | E | ⬜ |
| 11 | Categorical schema mapping between frameworks | F | 🕓 |
| 12 | Trust calibration & miscalibration-first UX | G | ⬜ |

## ▶ Next priority (updated 2026-07-02)

Two foundation threads closed on 2026-07-02:
- **Upgrade 1 measurement loop** — extraction confidence now varies (k-sample
  fusion, shipped 2026-07-01), and the loop is now *readable*: the calibration
  cron persists per-group ECE/Brier each run and evaluates the kill signal
  (ECE < 5% for supplier identity, mass, emissions intensity), surfaced at
  `GET /api/admin/calibration/health`.
- **Upgrade 7 productization** — Merkle roots persisted (`MerkleRoot`), root +
  per-record inclusion proofs embedded in the audit package, a shadow-compare
  asserting the Merkle commitment agrees with the linear HMAC chain, and a
  standalone offline browser verifier at `/verify-merkle`.

With the foundation genuinely complete, the next priority is **Weeks 8–20**:
Upgrade 5 (HNSW entity-resolution baseline) → Upgrade 4 (property graph) →
Upgrade 12 (trust UX, which surfaces the now-real calibrated confidence) →
Upgrade 2. Remaining Upgrade 1 model-class work (Platt scaling, per-doc-class
conjugate priors) is a separate, lower-priority track — see "Pending sub-parts".

**Architecture decision (2026-07-01):** heavy maths lives in a Python "brain"
service behind the TypeScript product. TS/Next.js owns the customer-facing app
and Layers 1/2/3; Python (`brain/`, its own Vercel project) owns the defensible
maths. The brain is stateless, DB-less, and never in the write path (down ⇒
degrade, never block). Exception: Upgrade 6 is definitional and stays in TS.

---

# The master plan (12 upgrades)

Grouped by pillar. Each carries a shipping target, a technology stack, and a kill signal.

## Pillar A — Confidence infrastructure

### 1. Bayesian fusion + calibration measurement  🟡
*(my #1 + your S1 + your S2, merged)*

**What it is.** Every field, every record, and every arbitrated fact carries a calibrated posterior with a stated credible interval. Confidence displayed on screen is empirically calibrated against a labelled ground-truth sample. Reliability diagrams, Brier score, and Expected Calibration Error are tracked as headline internal metrics and eventually surfaced to customers as a data-quality health indicator.

**Why.** The single most impactful upgrade in the entire plan. It transforms "confidence score" from a UI decoration into an audit-defensible property. It closes the automation-bias failure mode by making uncertainty numerically honest.

**Stack.** SpaCy / fine-tuned classifiers with softmax outputs; Bayesian fusion in Python with conjugate priors per document class; sklearn.calibration with isotonic or Platt scaling; reliability curves in matplotlib; PostgreSQL JSONB per-field confidence sidecar.

**Kill signal.** If, at three months of production data, the calibration ECE cannot be brought below 5% for the top three field types (supplier identity, mass, emissions intensity), the model class is wrong — escalate to a different family before shipping further.

### 2. Information theory across schema inference and active learning  ⬜
*(my #2 + your M1, kept as one pillar with two applications)*

**What it is.** Shannon entropy and mutual information used for two decisions: (a) at intake, to choose how to group fields into a schema that preserves signal and discards noise, and (b) at review time, to rank which field to ask the human to confirm next, prioritising expected information gain over the corpus's downstream query set.

**Why.** Schema decisions become mathematically justifiable. SME review burden falls because Arbor stops asking about fields whose confirmation adds nothing.

**Stack.** scipy.stats.entropy, sklearn.feature_selection.mutual_info_* for the primitives; a custom scoring function for schema candidates; expected-information-gain ranker for review queue.

**Kill signal.** If SME confirmation rate on ranked-high fields does not exceed rate on random fields by a factor of two on an A/B test, the mutual-information channel isn't picking up the right signal.

### 3. Maximum-entropy completion under algebraic constraints  ⬜
*(my #3, reframed — same math, no physics label)*

**What it is.** When a field is missing, don't fall back to a published default. Compute the maximum-entropy distribution over the missing field consistent with (a) the other known fields for that record, and (b) the algebraic constraints the record must satisfy — mass balance, energy balance, stoichiometric ratios, and regulatory bounds. Report the completed value with the entropy of the posterior as its uncertainty.

**Why.** Tier-C records gain real signal instead of using industry averages. Physically impossible documents are rejected at intake, not at audit. Fraudulent claims that violate stoichiometric bounds surface immediately.

**Stack.** MaxEnt solver (scipy.optimize with Lagrange multipliers, or cvxpy for convex formulations). Constraint library maintained per sector (steel, aluminium, cement, fertiliser, hydrogen) — each sector's algebraic sanity constraints codified once. Reuses the Bayesian infrastructure from Upgrade 1.

**Kill signal.** If constraint violations detected by MaxEnt overlap >85% with violations already detected by the rule-based admissibility spec, MaxEnt isn't adding a distinct signal — narrow its scope or defer.

## Pillar B — Data structure and resolution

### 4. Property graph as primary representation  ⬜
*(your M2, adopted as first-class)*

**What it is.** After Arbor writes a record to the relational store, it also writes nodes and edges to a graph representation: suppliers, installations, batches, buyers, documents, certificates, and the relationships between them. Both representations coexist; queries pick the one that fits.

**Why.** Multi-hop questions ("show me every buyer whose last-quarter certified supplier is a subsidiary of a sanctioned entity") are answerable in Cypher in one query and impossible cleanly in SQL. This is the foundation that makes any future aiOS reasoning layer actually intelligent instead of a fuzzy search.

**Stack.** Neo4j Community for graph storage; NetworkX for offline analytics; GraphQL over Cypher for the query API; LlamaIndex graph index integration.

**Kill signal.** If, after six months, no product feature meaningfully depends on multi-hop graph queries (i.e. all real queries are one-hop and could be a join), the graph is unearning its operational cost — collapse back to relational and revisit later.

### 5. Entity resolution — HNSW baseline plus optimal transport escalation  ⬜ (OT 🕓)
*(your M3 as baseline + my #6 as escalation)*

**What it is.** Every named entity gets a sentence-transformer embedding indexed with HNSW; cosine similarity produces candidate matches; blocking on postcode, registration number, and sector keeps it O(n log n). For pairs that fall in the ambiguous band around the similarity threshold, escalate to an optimal-transport match over an attribute distribution (location, sector code, historical throughput, ownership graph position) — Wasserstein distance handles cases that string embeddings cannot.

**Why.** The certified-data network effect from earlier depends on suppliers matching correctly across buyers. Missed matches fragment the network into singletons and destroy the moat.

**Stack.** sentence-transformers (all-MiniLM-L6-v2 as baseline); pgvector with HNSW index; dedupe.io for blocking; POT (Python Optimal Transport) for the escalation path.

**Kill signal.** If the OT escalation improves precision-at-fixed-recall by less than 3 percentage points over the HNSW baseline on a labelled test set, drop OT and keep the baseline alone.

## Pillar C — Trust semantics and audit structure

### 6. Lattice-theoretic tier composition  ✅
*(my #7)*

**What it is.** Trust tiers form a semilattice: C ≺ B ≺ A. When aggregating N records into an answer, the aggregate carries a meet tier (the lowest tier present) plus a distribution vector showing what fraction of the aggregate achieves each tier. Every export, every questionnaire answer, every buyer response reports both.

**Why.** Eliminates the ambiguity of "what tier is a set?" that today has no defined answer. Buyers can set minimum acceptance thresholds. Auditors get honest labelling of composite claims.

**Stack.** Roughly 200 lines of Python. Purely definitional work. Zero external dependencies.

**Kill signal.** N/A. This one either ships or is redesigned in an afternoon.

### 7. Merkle-DAG audit structure  🟡
*(my #4)*

**What it is.** Replace the linear HMAC chain with a Merkle-DAG. Each record hash is a leaf; internal nodes are hashes of children; a single root commits the corpus. A record's proof of inclusion is a Merkle path of length log₂(n), verifiable offline without exposing the rest of the chain.

**Why.** Signed exports become possible without leaking structure. Any auditor can independently verify a single record's authenticity. This is the missing plumbing under every buyer-facing sharing story.

**Stack.** Two weeks of engineering. Merkle libraries are mature (merkletools in Python, or hand-rolled — the primitive is 30 lines).

**Kill signal.** N/A. This is drop-in with strict upside.

### 8. Zero-knowledge proofs for predicate compliance  ⬜
*(my #5)*

**What it is.** Given the Merkle root as a public commitment, generate SNARK proofs that Arbor's records satisfy a threshold predicate ("Scope 1 < X", "no sanctioned origin", "renewable share > Y%") without revealing the records themselves. Buyer verifies the proof in milliseconds.

**Why.** Every buyer-facing compliance question that today requires exposing the underlying data becomes answerable without exposure. Privacy-preserving CDP, EcoVadis, B Corp re-certification, bank ESG questionnaires. A feature competitors cannot retrofit.

**Stack.** Halo2 or Circom + Groth16 for proving; snarkjs for verification. First-cut circuits for three predicate templates (numeric inequality, set membership, weighted sum threshold).

**Kill signal.** If proving time for a 10,000-record predicate exceeds 5 minutes on standard hardware, the circuit design isn't ready for production — hold at internal tooling until it is.

## Pillar D — Physical / supply-chain consistency

### 9. Graph flow consistency across the supply chain  ⬜
*(my #8, reframed under graph theory rather than physics)*

**What it is.** Treat the supply chain as a directed flow network over the graph from Upgrade 4. At each node, enforce Kirchhoff-style balance: flow-in equals flow-out plus stored plus lost. Cross-tenant visibility means Arbor can detect double-counting (same lot certified to two buyers), impossible-capacity claims, and low-emission-certificate laundering — none of which are visible from any single tenant's records.

**Why.** This is the fraud detection layer nobody else in the carbon-data space can build, because nobody else holds the multi-buyer, multi-supplier graph.

**Stack.** NetworkX for graph algorithms; pulp or cvxpy for the LP formulation of flow feasibility; runs offline as an anomaly detector, not in the write path.

**Kill signal.** If the flow-consistency detector produces false-positive rate above 10% on early cases (i.e. flagging real but legitimate discrepancies), the constraint model is too tight — loosen tolerances before shipping.

## Pillar E — Corpus economics

### 10. Differential privacy on cross-tenant aggregates  ⬜
*(my #9)*

**What it is.** Publish sector-level statistics (median emissions intensity per commodity code per country per quarter) from the aggregate corpus with ε-differential privacy guarantees. No individual SME's contribution is statistically detectable.

**Why.** Monetises the corpus without touching tenant data or trust. Creates a second revenue stream — sector benchmarks sold to banks, regulators, journalists, larger enterprises — that grows automatically as customer count grows.

**Stack.** Google's differential-privacy library or OpenDP. Query language wrapper for a fixed vocabulary of publishable aggregate types.

**Kill signal.** If at 200 tenants the noise required to guarantee ε ≤ 1 makes the published benchmarks less accurate than existing public reference values, the sample is too small — hold until N is sufficient.

## Pillar F — Long-horizon regulatory scaling

### 11. Categorical schema mapping between frameworks  🕓
*(my #10)*

**What it is.** Each regulatory schema (CBAM, CSRD, CDP, ISSB, EcoVadis, B Corp) modelled as a category. Mappings are functors. Composition is provably consistent; round-trip identity is a checkable property.

**Why.** Adding the eleventh framework becomes O(1) rather than O(N). Translation errors between frameworks become detectable as failure of round-trip identity — diagnosable, not mysterious.

**Stack.** CQL or Catlab (research-grade, but usable). Only earn this after four regulatory schemas are live in production and bespoke mapping cost is measurable.

**Kill signal.** Do not start until (a) at least four regulatory schemas are live, and (b) bespoke translation between them consumes >20% of engineering time. Premature otherwise.

## Pillar G — Human factors

### 12. Trust calibration and miscalibration-first UX  ⬜
*(your P1 + your P2, merged into a single human-factors pillar)*

**What it is.** UI-level enforcement of appropriate trust. Every field shows its calibrated confidence prominently. Every field's provenance chain is one click away. Low-confidence records break the user's scanning pattern visually — never displayed identically to high-confidence records. Onboarding includes a mandatory ten-record review exercise mixing correct and incorrect Arbor outputs, trained-in scepticism before automation bias sets in. Correction events are logged, surfaced back to the user as agency reinforcement, and fed into the calibration pipeline (Upgrade 1) as ground-truth signal.

**Why.** Every other upgrade in this plan produces calibrated numbers. Without a UX that respects them, users default to automation bias and the calibration is wasted. Skitka's finding — that miscalibrated trust is worse than no automation — makes this a first-class architectural concern.

**Stack.** Next.js UI redesign; provenance chain rendering; visual-treatment specification for the low-confidence break-out state; onboarding-flow exercise; correction-event logging into Postgres.

**Kill signal.** If A/B test after 30 days shows that users of the calibrated UI don't catch more Arbor errors than users of the pre-existing UI, the UI treatments aren't strong enough — escalate visual differentiation until they do.

---

# Integrated sequencing

The build order that respects both dependency graphs and product urgency.

**Weeks 0–8 (Foundation — everything else depends on these three):**
- **Upgrade 1** — Bayesian fusion + calibration measurement (confidence infra other upgrades assume).
- **Upgrade 7** — Merkle-DAG audit structure (unlocks buyer-facing sharing; no downside).
- **Upgrade 6** — Lattice-theoretic tier composition (an afternoon of design, half a sprint of implementation).

**Weeks 8–20 (Data structure and human factors):**
- **Upgrade 5** — HNSW entity resolution baseline (defer OT escalation until after Bayesian is calibrated).
- **Upgrade 4** — Property graph as primary representation.
- **Upgrade 12** — Trust calibration UX (depends on Upgrade 1 producing calibrated numbers and on entity resolution producing consistent identities).
- **Upgrade 2** — Information-theoretic schema inference and active learning.

**Weeks 20–36 (Constraints and physical checks):**
- **Upgrade 3** — MaxEnt completion under algebraic constraints (depends on Upgrade 1's Bayesian infra).
- **Upgrade 9** — Graph flow consistency (depends on Upgrade 4's graph representation).

**Weeks 36–52 (Corpus economics and advanced disclosure):**
- **Upgrade 10** — Differential privacy aggregates (depends on Upgrade 5's clean entity resolution to define aggregation units).
- **Upgrade 8** — Zero-knowledge proofs (depends on Upgrade 7's Merkle-DAG for the commitment).

**Deferred (build when earned):**
- **Upgrade 5's OT escalation** — only if the HNSW baseline plateaus.
- **Upgrade 11** — Categorical schema mapping — only when four regulatory schemas are live and translation cost is measurable.

---

# Current status & what's pending (2026-07-01)

## ✅ Done — Weeks 0–8 foundation

**Upgrade 6 — Lattice tier composition — complete.**
- `src/lib/layer3/tier-composition.ts` (`composeTiers` = meet + distribution, `aggregateMeetsThreshold`).
- Wired into `src/lib/layer3/record-quality.ts` and `src/lib/aggregation/sector-benchmark.ts`.

**Upgrade 1 — Bayesian calibration — loop built and verified live in production.**
- Substrate: `DataRecord.confidencePosterior` JSONB sidecar + `GroundTruthLabel` table + `GroundTruthSource` enum.
- Capture: `src/lib/confidence/ground-truth.ts`, `src/lib/confidence/review-capture.ts` (wired into the confirm route).
- Brain: `brain/` FastAPI, `POST /calibration/fit` — pure-stdlib PAV isotonic + Brier + ECE + reliability (`brain/app/calibration.py`). Own Vercel project, fail-closed internal auth.
- TS seam: `src/lib/brain/` (typed client, `classifyFieldType` for kill-signal groups, metrics, fail-soft).
- Backfill: `src/app/api/cron/calibrate/route.ts` + `src/lib/confidence/posterior.ts` + `backfill.ts` (writes calibrated posteriors back; daily cron; `?minSamples` override for verification).
- **Verified end-to-end in production:** upload → extract → review/confirm → `GroundTruthLabel` → brain fit → `confidencePosterior` on a record.

**Upgrade 7 — Merkle-DAG — core primitive built and tested.**
- `src/lib/layer2/merkle.ts` — RFC 6962 (domain-separated hashing, power-of-two split), pinned to RFC vectors. `merkleRoot`, `buildInclusionProof`, `verifyInclusionProof`.

## 🟡 Pending sub-parts within the "done" foundation

**Upgrade 1 — pending (the plan's full vision):**
- ✅ **Real probabilistic confidence at extraction** (k-sample self-consistency fusion; shipped 2026-07-01). Confidence now varies instead of being a constant 1.0.
- ✅ **Headline ECE/Brier tracking + kill-signal monitoring** (2026-07-02). The calibration cron persists a `CalibrationRun` + per-group `CalibrationGroupMetric` each fit and evaluates the kill signal (ECE < 5% for supplier identity, mass, emissions intensity, judged only on sufficient groups). Read at `GET /api/admin/calibration/health`. Pure core: `src/lib/confidence/calibration-metrics.ts`.
- **Platt scaling** (only isotonic/PAV implemented) — separate model-class track.
- **True Bayesian fusion with conjugate priors per document class** (current is isotonic calibration only) — separate model-class track.
- **Surfacing** the posterior + reliability diagram as a *customer-facing* data-quality health indicator (`confidencePosterior` is written and now tracked internally, but not shown to customers) — belongs with Upgrade 12.
- Selection-bias caveat: only human-reviewed docs produce labels (auto-accepted low-stakes docs do not) — by design, but caveats the ECE claim.

**Upgrade 7 — productized (2026-07-02):**
- ✅ Persist Merkle roots (`MerkleRoot` table; written when an audit package is generated).
- ✅ Root + per-record inclusion proofs embedded in the audit package (`generator.ts` `buildMerkleCommitment`; surfaced in the `/api/audit-package/me` response).
- ✅ Browser-side (Web Crypto) verifier for buyers/auditors at `/verify-merkle` (`src/lib/layer2/merkle-browser.ts`, cross-checked against the Node RFC 6962 impl).
- ✅ Shadow-compare (Merkle vs linear HMAC) — `assemble.ts` `merkleShadow` asserts the chain verifies, every Merkle leaf is in the chain, and every proof recomputes to the root, on every package generation.
- Remaining: fold the Merkle root into CSV/XML tabular exports if those ever need standalone provenance (the audit package is the current signed-export vehicle).

## ⬜ Not started
Upgrades **2, 3, 4, 5, 8, 9, 10, 12** — see sequencing above.

## 🕓 Deferred by design
- Upgrade 5's optimal-transport escalation (only if HNSW plateaus).
- Upgrade 11 (only once ≥4 regulatory schemas live and translation cost measurable).

## 🧹 Non-upgrade follow-ups
- Re-verify the numeric-parsing + `rawOutput`-on-failure fixes on a fresh production upload (deployed, not yet re-checked end-to-end).
- Preview-environment `SUPABASE_SERVICE_ROLE_KEY` (set 2026-07-01; applies on next preview deploy).

---

*Related references: PRD (`memory/project_arbor_prd.md`), admissibility spec
(`memory/project_arbor_admissibility.md`), and the live working log
(`memory/arbor-12-upgrade-plan.md`).*
