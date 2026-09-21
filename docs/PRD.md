# Product Requirements Document
## Arbor — Operational Data Infrastructure Platform
**Version:** 1.3
**Status:** Foundation Draft
**Principle:** Every requirement traces to a first principle. No feature exists without a reason rooted in the core problem.

---

## Table of Contents

1. [The Problem](#1-the-problem)
2. [The First Principle](#2-the-first-principle)
3. [What We Are Building](#3-what-we-are-building)
4. [The Most Valuable Asset](#4-the-most-valuable-asset)
5. [Who This Is For](#5-who-this-is-for)
6. [The Core Transformation](#6-the-core-transformation)
7. [The Simplicity Constraint](#7-the-simplicity-constraint)
8. [System Architecture](#8-system-architecture)
9. [Data Domains](#9-data-domains)
10. [Data Entity Model](#10-data-entity-model)
11. [Document Universe](#11-document-universe)
12. [Quality and Certification Framework](#12-quality-and-certification-framework)
13. [The Three-Layer System](#13-the-three-layer-system)
14. [Unit Conversion Engine](#14-unit-conversion-engine)
15. [The Relational Query Engine](#15-the-relational-query-engine)
16. [Statistical Modelling and Analytics](#16-statistical-modelling-and-analytics)
17. [The Supplier Portal](#17-the-supplier-portal)
18. [The Buyer Interface](#18-the-buyer-interface)
19. [The Database](#19-the-database)
20. [Audit and Traceability](#20-audit-and-traceability)
21. [Data Sharing and Export](#21-data-sharing-and-export)
22. [Commercial Model](#22-commercial-model)
23. [Data Liability](#23-data-liability)
24. [Phased Execution](#24-phased-execution)
25. [Non-Requirements](#25-non-requirements)

---

## 1. The Problem

A UK manufacturer receives a data request from their largest customer. The customer needs energy consumption, production output, and materials intake data for the last two quarters — for their own sustainability reporting. The manufacturer forwards it to their office manager. The office manager searches through three filing systems, two spreadsheets, and a folder of scanned invoices. Three days later they produce a spreadsheet. The figures are inconsistent with what they sent the same customer six months ago. Nobody notices. Nobody can check.

This is not an isolated failure. It is the normal operating condition for thousands of UK SMEs supplying goods and services across every sector.

**The data that exists is:**
- Fragmented across accounting software, spreadsheets, email attachments, paper records, and filing cabinets
- Inconsistent in units, formats, and definitions across sites, periods, and the customers asking for it
- Unverifiable — collected through manual reconstruction with no traceable source
- Rebuilt from scratch every time a customer, auditor, or regulator asks for it
- Different every time it is rebuilt, because no canonical version exists

**The consequence for SME suppliers:**
- Hours or days spent responding to each customer data request
- The same underlying operational data reconstructed differently for each customer
- No record of what was submitted, to whom, when, and from which source document
- Growing exposure as customer data requirements and regulatory obligations multiply

**The consequence for large company buyers:**
- Supplier data received as unverifiable spreadsheets with no source documentation
- The same supplier answering the same question differently across reporting periods
- No ability to query across their supply chain without chasing each supplier individually
- Decisions made on data quality that cannot be trusted

**The consequence for regulators and institutions:**
- No credible structured dataset of real supplier operational data exists at national scale
- Policy and compliance frameworks built on assumptions rather than verified activity data

The problem is infrastructure. No system exists that captures a company's operational reality once, structures it correctly, certifies its provenance, and makes it permanently available whenever anyone legitimately needs it.

---

## 2. The First Principle

**Operational data should be captured once, structured correctly, and remain permanently available for any legitimate use.**

A manufacturer's energy consumption in Q3 is a fact. It happened. It is recorded somewhere — in a utility bill, a production log, a meter reading. That fact should exist once, in one place, correctly structured, in a form that can answer any future question from any authorised party: a customer data request, a regulatory audit, an ESG disclosure, a benchmark comparison, an internal operational query.

Instead, it is currently reconstructed repeatedly, inconsistently, at cost, under time pressure, and with degrading accuracy each time.

Every product decision must be evaluated against this principle. The platform exists to make operational reality permanently accessible. Features that do not serve this are not built.

---

## 3. What We Are Building

Arbor is a certified operational data repository for manufacturers, suppliers, and producers.

Companies submit their operational documents — energy bills, production logs, delivery notes, invoices, environmental records, certificates. The platform extracts the structured data from those documents, certifies its provenance, and stores it permanently in a relational database with a cryptographic audit chain.

When any authorised party — a customer, a supplier, an auditor, a regulator — needs that data, the company shares it directly from the store. The data is clean, structured, and provenance-certified. The receiving party uses it for whatever purpose they require: their own sustainability reporting, compliance submissions, supply chain due diligence, benchmarking, or operational analysis. The calculations happen in their systems. Arbor holds the data.

**The platform does four things:**

1. **Ingests** operational documents and extracts structured data fields with confidence scores and source text
2. **Certifies** the provenance of every data point through a transparent three-tier trust system and a cryptographic audit chain
3. **Stores** every record permanently in a relational database, queryable across entities, periods, and domains
4. **Shares** structured data on demand to authorised parties in the format they need, with a unit conversion engine that makes data usable across different measurement systems

Arbor does not perform sustainability calculations. It does not produce CBAM returns, Scope 3 inventories, or ESG disclosures. It holds the verified operational data that those calculations and disclosures require. The calculations happen elsewhere — in the customer's tools, their accountant's models, or regulatory systems. Arbor is the data source, not the processing engine.

---

## 4. The Most Valuable Asset

The database.

Not the portal. Not the extraction pipeline. Not the query engine. Those are the means of filling and accessing the database.

The database accumulates verified, document-backed, activity-level operational data from real companies across sectors and regions. Every record represents a real operational fact, a real source document, a real submission with traceable provenance.

**Why it is defensible:**
- It cannot be replicated by a competitor with engineering resources alone. It took years to fill.
- It improves with every additional record — completeness, accuracy, sector coverage, query usefulness
- It creates a network effect: more contributors make sector benchmarks more accurate, which makes the platform more valuable, which attracts more contributors
- It becomes the foundation for institutional and government data partnerships that no software product alone can achieve
- A company's audit trail and data history create structural switching costs — leaving means abandoning a certified historical record

**The implication for every product decision:**
Every feature must either fill the database, improve the quality of existing records, or make the database more accessible to legitimate users. Features that do none of these are deferred.

---

## 5. Who This Is For

### Primary users — Data contributors

**UK SME manufacturers and suppliers**
Companies with 5–249 employees across all sectors, starting with those in CBAM-adjacent industries: steel, aluminium, cement, fertiliser, hydrogen, agricultural production, chemicals, and logistics. Their operational data is already being generated — energy bills, production logs, delivery records, invoices. It is not being captured in any organised, accessible form.

What they need from Arbor: one place where their operational data lives permanently, so they can respond to any customer data request in minutes rather than days, without reconstructing the same information repeatedly.

The person using the platform is typically an office manager, accounts administrator, or business owner. No sustainability background. No prior knowledge of emissions frameworks or regulatory requirements. The platform must be usable by this person without training.

**SME importers in CBAM sectors**
UK businesses importing steel, aluminium, cement, fertiliser, or hydrogen, many of whom will face data requests from customers and regulators connected to CBAM obligations from 2027. Their operational documents — customs declarations, freight invoices, supplier invoices — contain the data their customers and regulators will need. Currently that data is not organised or accessible.

**Agricultural producers and processors**
Farms, cooperatives, and agri-food processors whose customers — food and beverage companies, retailers — are increasingly requesting verified operational data on crop yields, inputs, land use, and processing. Currently answered informally or not at all.

### Secondary users — Data consumers

**Large company buyers and importers**
Manufacturers, retailers, and trading companies that need verified operational data from their supply chains — for their own sustainability reporting, for compliance submissions, for supply chain due diligence. They are the demand-side pressure that pulls SME suppliers onto the platform.

What they need from Arbor: structured, certified data from each supplier, queryable across the supply chain, with provenance visible, without chasing each supplier individually by email.

**Corporate sustainability and procurement teams**
Teams responsible for supply chain data collection, ESG disclosure preparation, and regulatory compliance. They need verified, structured, auditable data at scale. Currently blocked by the quality and consistency of what suppliers provide.

**Auditors and verifiers**
Third-party verifiers who need structured, traceable data packages to verify corporate disclosures. Arbor reduces audit preparation time by organising source documents, extraction records, and the audit chain in advance.

### Tertiary users — Institutional consumers (Phase 3)

Government bodies, development finance institutions, trade associations, and sector regulators that need credible structured operational data at national or sector scale for policy, benchmarking, and emissions inventory purposes.

---

## 6. The Core Transformation

```
Fragmented documents in filing cabinets → Certified, permanently accessible operational data record
```

**Before:**
A small steel stockholder receives a data request from their largest customer. The customer needs energy consumption and production volumes for the last two quarters. The office manager searches through utility bills in one folder, production records in a spreadsheet, and delivery notes in an email archive. Three days later they send a spreadsheet. The figures cannot be verified. Three months later, a different customer asks for overlapping data. The process starts again. The figures are slightly different.

**After:**
The same office manager uploads the documents they already have — utility bills, delivery notes, production records — to Arbor. The platform reads them, extracts the data, flags anything uncertain, and asks for confirmation. Everything is stored with full provenance. When the first customer requests Q3 data, the office manager shares a structured, certified data record in seconds. When the second customer asks three months later, the same certified record is already there. It has not changed. It is the same fact it was the first time.

The company does not change its operations. It changes where its operational data lives.

---

## 7. The Simplicity Constraint

The platform's internal architecture handles eight data domains, a relational database with cross-entity querying, a cryptographic audit chain, a unit conversion engine, and a statistical analytics layer. None of this complexity is visible to an SME user. If it is, the product has failed.

**The constraint, enforced at every phase:**

At Phase 1, an SME user needs to understand exactly three things to use the product:
1. Upload the documents you already have
2. Check what the platform found in them
3. Share your data when a customer asks

Nothing else. Not domains. Not trust tiers. Not unit systems. Not frameworks. The platform handles all of that internally and surfaces only what requires the user's decision.

**How this is enforced:**

- Every screen has one primary action. If it has two, remove one.
- Every label is plain English. No technical jargon, no regulatory terminology, no acronyms without explanation.
- The user is never asked to categorise their own data. The platform categorises it. If uncertain, it asks one specific plain English question — not a menu of options.
- If a feature requires an explanation to use, it is redesigned, not documented.
- Trust tier labels visible to the SME user are: **Verified** (Tier A), **Declared** (Tier B), **Estimated** (Tier C). The underlying architecture remains intact; the labels the user sees are plain English.
- The buyer-facing interface uses full technical detail — trust tiers, confidence scores, source text, domain classification — because buyers are sophisticated users who need that detail to make decisions.

**The test for every new feature:**
Could the office manager of a five-person steel stockholder, with no sustainability or data background, use this without asking for help? If the answer is no, the feature is not ready.

---

## 8. System Architecture

Arbor is a three-layer system sitting on top of a relational database and an audit chain.

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1 — Ingestion                                    │
│  Documents → structured fields + confidence + source   │
├─────────────────────────────────────────────────────────┤
│  Layer 2 — Storage and Certification                    │
│  Relational database + trust tier + audit chain        │
├─────────────────────────────────────────────────────────┤
│  Layer 3 — Access and Sharing                          │
│  Query engine + unit conversion + export formatting    │
└─────────────────────────────────────────────────────────┘
```

**Layer 1 — Ingestion**
Takes raw documents as input. Uses AI extraction to identify document type, extract structured data fields, assign confidence scores, and record source text. Assigns each record to a data domain. Flags fields below the confidence threshold for human review. Writes nothing to the database until the user has confirmed or corrected flagged fields.

**Layer 2 — Storage and Certification**
The relational database. Every confirmed record is written with its full attribute set — entity, domain, value, unit, period, source text, confidence score, trust tier, extraction method, timestamp, and audit hash. Records are never overwritten. The HMAC audit chain links every record to the previous one. Any tampering breaks the chain.

**Layer 3 — Access and Sharing**
The query engine, unit conversion layer, and export formatter. Authorised parties query the database for the records they need. The unit conversion engine converts stored values to the unit requested by the recipient. The export formatter structures the output for the receiving system — CSV, JSON, XML, or a structured data share within the platform.

**What is not in the architecture:**
There is no calculation engine. Arbor does not compute sustainability metrics, compliance figures, or emissions inventories. It stores the operational facts that others use to compute those things. The distinction is absolute and enforced at the architecture level.

---

## 9. Data Domains

The platform organises all operational data across eight domains. Every data point is assigned to exactly one domain. Domain assignment is handled by the platform during ingestion — the user never assigns a domain manually.

| Domain | What it covers | Example data points |
|---|---|---|
| Energy | All energy inputs and consumption | Electricity kWh by period, gas consumption m³, fuel type and volume, renewable energy certificates |
| Materials | Raw material and input flows | Material type, quantity, grade or specification, supplier, country of origin |
| Production | Manufacturing and processing output | Product type, quantity, production period, process stage, yield rate, batch reference |
| Logistics | Movement of goods | Mode of transport, origin, destination, carrier, shipment weight, distance, date |
| Emissions | Directly reported emissions figures | CO2e figures as declared in submitted documents — not calculated by the platform |
| Agriculture | Land-based production inputs and outputs | Crop type, yield, area, fertiliser inputs, water use, harvest date |
| Waste and water | Disposal, treatment, and water flows | Waste type, quantity, disposal method, water source, volume |
| Compliance | Regulatory declarations and certifications | Customs declarations, regulatory filings, certificates, audit reports |

**Note on the Emissions domain:** This domain stores emissions figures that appear in submitted documents — a carbon footprint report, an emissions declaration, a certified LCA. It does not store figures calculated by the platform. Arbor does not calculate emissions. It stores what companies have declared or had certified.

---

## 10. Data Entity Model

Every data record stored in the database has the following mandatory attributes. No record is written without all mandatory fields present.

```
entity_id          — the registered company the data belongs to
document_id        — the source document from which the data was extracted (null for manual entry)
data_point_id      — unique identifier for this specific record
domain             — one of the eight domains (assigned by platform at ingestion)
field_name         — the specific data field (e.g. total_consumption_kwh, product_quantity)
value              — the numeric or categorical value
unit_original      — the unit as it appeared in the source document
unit_stored        — the SI base unit in which the value is stored
value_original     — the value as it appeared in the source document before normalisation
period_start       — start of the period this data covers
period_end         — end of the period this data covers
source_text        — the exact verbatim text from the source document
confidence_score   — extraction confidence (1.00 = manually confirmed, <1.00 = AI-extracted)
trust_tier         — A (document-verified), B (supplier-declared), C (default factor applied)
submitted_at       — timestamp of submission
submitted_by       — user account that submitted
extraction_method  — document_ai, manual_entry, or system_integration
superseded_by      — points to the record that replaced this one (null if current)
is_active          — false if superseded, true if current
audit_hash         — HMAC of all above fields, chained to the prior record's hash
```

**Storage normalisation:** All numeric values are normalised to SI base units on ingestion. The original value and unit are always preserved. The user always sees the value in the units they submitted. The stored SI unit enables cross-entity and cross-period querying without unit mismatch errors.

---

## 11. Document Universe

### 11.1 Phase 1 priority documents

The document types that UK SME manufacturers, importers, and suppliers in CBAM-adjacent sectors are most likely to already have. The extraction pipeline is trained and validated on these first.

- Electricity bills
- Gas bills
- Fuel purchase receipts
- Production logs and batch records
- Material intake records
- Freight invoices
- Customs declarations and import entries
- Supplier invoices
- Delivery notes and consignment notes
- Purchase orders

### 11.2 Phase 2 expansion documents

- Bills of lading
- Bill of materials
- Process data sheets
- Waste disposal records
- Water use records
- Environmental management certificates (ISO 14001, EMAS)
- Renewable energy certificates (REGOs, RECs)
- Carbon footprint reports and LCA documents
- Supplier questionnaire responses

### 11.3 Phase 3 expansion documents

- Crop yield records
- Fertiliser application records
- Livestock records
- Land use certificates
- ESG and sustainability disclosure reports
- Chain of custody documents
- Product certifications (ISCC, RSPO, FSC, organic, CE)
- Third-party audit reports

### 11.4 Universal quality checks — applied to every document

| Check | What is verified |
|---|---|
| Entity match | Company name on document matches the registered entity |
| Date validity | Document covers the stated period and is not expired |
| Unit consistency | All quantities use consistent units; any conversions are stated explicitly |
| Completeness | All compulsory fields for this document type are present; gaps are flagged |
| Internal consistency | Figures cross-reference correctly within the document itself |
| Source text capture | Exact verbatim text for every extracted field is recorded |
| Confidence score | AI-extracted fields carry a score; below 0.85 is flagged for human review |
| Duplication check | This document or the same period has not already been submitted by this entity |
| Cross-document validation | Where multiple documents cover the same activity, figures are compared |

---

## 12. Quality and Certification Framework

### 12.1 The three-tier trust system

Every data record carries a trust tier. This tier is permanent, visible to all authorised parties, and cannot be hidden or suppressed. The user-facing labels are plain English. The internal tier codes are used in the database schema and API.

| Internal tier | User-facing label | What it means |
|---|---|---|
| Tier A | Verified | Extracted from a submitted source document. Source text recorded. Document passed quality checks. Confidence at or above threshold, or manually confirmed. |
| Tier B | Declared | Entered directly by the user without an attached supporting document, or the document failed one or more quality checks that did not prevent submission. |
| Tier C | Estimated | No company-specific data available. A published default reference value has been applied. Source cited. Always labelled as estimated. Never presented as actual activity data. |

### 12.2 Tier upgrade pathway

A Tier B record upgrades to Tier A when a supporting document is subsequently submitted and passes quality checks for the same entity, field, and period. A Tier C record upgrades to Tier B on direct declaration and to Tier A on document submission. Original records are never deleted — they are superseded and the audit chain preserves all versions.

The upgrade pathway is surfaced to the user as a plain English prompt: "You can improve the status of this record by uploading a supporting document." No technical terminology is used.

### 12.3 Cross-document validation

Where two or more documents cover the same entity, field, and period, the platform cross-checks the extracted values.

- **Within tolerance:** figures agree within the defined tolerance for this field type. Record passes silently.
- **Discrepancy flagged:** figures differ beyond tolerance. User is shown both values in plain English with their source texts. User resolves or accepts the discrepancy with a note.
- **Accepted:** discrepancy recorded in audit chain with the user's note.
- **Resolved:** corrected document submitted. Original records superseded, not deleted.

Cross-validation failures are never silent and never presented in technical language.

### 12.4 Third-party audit package

On demand for any entity and period, the platform generates a structured audit package containing: all data records for the scope, source documents for Tier A records, confidence scores, source text extracts, the full audit chain, and a cross-validation report. The package is designed to be handed directly to an accredited third-party verifier without further manual preparation.

---

## 13. The Three-Layer System

Every operation in the platform belongs to exactly one layer. Layers do not mix.

### Layer 1 — Ingestion
**Input:** Raw documents (PDF, image, CSV, XML, spreadsheet)
**Output:** Structured data fields with confidence scores, source text, and domain assignment

Rules:
- AI extraction lives here only
- Always outputs confidence score and exact source text for every field
- Fields below 0.85 confidence are flagged for human review before any record is written
- Unrecognised document types are rejected with a plain English reason — never partially processed
- Domain assignment happens here — users never assign domains manually
- No record is written to the database until Layer 1 output has been reviewed and confirmed

### Layer 2 — Storage and Certification
**Input:** Confirmed structured fields from Layer 1 or manual entry
**Output:** Permanent, certified, immutable data records in the relational database

Rules:
- Every record is written with the full entity model from Section 10
- Every record is immediately linked to the audit chain via HMAC hash
- Records are never overwritten — corrections create new records that supersede the original
- Trust tier is assigned at write time and cannot be changed without creating a new record
- Unit normalisation to SI base unit happens at write time

### Layer 3 — Access and Sharing
**Input:** Authorised queries against the relational database
**Output:** Structured data in the requested format, with unit conversion applied

Rules:
- No modification of stored data — Layer 3 is read-only
- Unit conversion happens here, on output, not on stored data
- Trust tier and plain English certification label travel with every data point in every output
- Export format adapts to the recipient's needs — the underlying data does not change
- No calculation logic in Layer 3 — it translates and formats, nothing more

---

## 14. Unit Conversion Engine

The unit conversion engine is part of Layer 3. It serves a single purpose: making stored data usable by recipients who work in different measurement systems, without any change to what is stored.

### 14.1 How it works

Data is stored in SI base units. When a buyer or customer requests data, they specify the unit they need. The conversion engine converts the stored value to the requested unit before sending. The original stored value and unit remain unchanged.

Example: a supplier's gas consumption is stored as MJ. A buyer's system expects therms. The engine converts on output. The stored record remains in MJ.

### 14.2 Supported conversions

| Dimension | Stored unit | Convertible to |
|---|---|---|
| Energy | MJ | kWh, GJ, BTU, therms, toe, kcal |
| Mass | kg | tonnes (metric), g, lbs, short tons, long tons, oz |
| Volume | m³ | litres, ml, gallons (UK), gallons (US), barrels, ft³ |
| Area | m² | hectares, acres, km², ft², yd² |
| Distance | km | miles, nautical miles, m |
| Emissions | kg CO2e | tonnes CO2e, g CO2e, lbs CO2e |

### 14.3 What the conversion engine does not do

The conversion engine converts units of measurement. It does not:
- Convert between different physical quantities (e.g. energy to emissions)
- Apply emission factors
- Perform any calculation that changes the meaning of the data
- Derive a new value from stored values

Any conversion that requires a factor, a formula, or domain knowledge is a calculation. Calculations are not performed by Arbor.

### 14.4 Conversion transparency

Every converted value shared with a recipient includes: the original stored value and unit, the converted value and unit, and the conversion factor applied. The recipient always knows what the original figure was.

---

## 15. The Relational Query Engine

The relational query engine is the core of Layer 3. It allows authorised users to query structured records across entities, domains, periods, and fields.

### 15.1 What it enables

**Entity-level queries:** A company queries their own data. All energy records for Q3 2026. All production records for a specific product. All logistics records for a specific supplier. Filterable by domain, field, period, trust tier, and source document.

**Supply chain queries (buyer):** A buyer queries across their authorised supplier relationships. Which suppliers have energy records for Q3 2026? What is the total production volume across all steel suppliers for the year? Which records are Verified versus Declared? All without contacting each supplier individually.

**Gap queries:** Where is data missing for a required set of entities, fields, and periods? Which suppliers have not submitted production records for Q4? What is the trust tier distribution across the buyer's supply chain for a given domain?

**Historical queries:** How has a company's energy consumption changed quarter-on-quarter? Which periods have complete records? What was the trust tier of each record at submission time?

### 15.2 Query rules

- Every query is scoped to what the requesting user is authorised to see
- Entity-scoped data is only accessible to the entity and to parties the entity has explicitly authorised
- Buyers can only query supplier data that the supplier has shared with them
- Query results include trust tier labels on every record — data quality is always visible
- No query result removes or suppresses provenance information

### 15.3 What the query engine does not do

The query engine retrieves and presents stored records. It does not aggregate records into calculated outputs (e.g. total emissions). It does not apply weights, factors, or formulas to retrieved records. Aggregation and calculation are the responsibility of the party receiving the data.

---

## 16. Statistical Modelling and Analytics

Built on top of the relational database, the analytics layer provides read-only statistical views of the accumulated data. All analytics are derived from stored records — no new data is created by the analytics layer.

### 16.1 Entity-level analytics (available to the submitting entity)

**Completeness dashboard:** For each domain and period, what percentage of expected fields have been submitted? What is the trust tier distribution? Where are the gaps?

**Period-over-period comparison:** How do submitted values for a given field compare across quarters or years? Presented as a data summary — not a calculation of change. The user draws their own conclusions.

**Submission history:** Timeline of all document submissions, extractions, and record writes. When was each record created? Has anything been superseded?

### 16.2 Supply chain analytics (available to buyers)

**Coverage map:** Across the buyer's supplier relationships, which entities have submitted data for which domains and periods? What is the trust tier distribution?

**Data quality summary:** Across the supply chain, what proportion of records are Verified, Declared, or Estimated for a given domain and period?

**Gap identification:** Which entities, fields, and periods are missing records? Presented as a structured list — not a calculation of impact.

### 16.3 Aggregated sector analytics (Phase 3 — institutional)

**Sector benchmarks:** Where sufficient Tier A records exist across multiple entities in the same sector, the platform computes statistical distributions — median, quartiles, range — for specific fields. For example: energy consumption per tonne of production across UK steel manufacturers.

These are statistical summaries of stored data. They are not emission factors. They are not calculations. They are distributions of real operational figures from real companies, presented as benchmarks.

**Minimum population floor:** No aggregated benchmark is computed from fewer than 10 entities. Below this floor, the data is not shown.

**Anonymisation:** No individual entity's data is identifiable in any aggregated output.

### 16.4 What the analytics layer does not do

The analytics layer does not perform sustainability calculations, does not produce compliance outputs, and does not apply emission factors. It presents statistical summaries and distributions of the operational data stored in the database. The user interprets and applies those summaries.

---

## 17. The Supplier Portal

### 17.1 Purpose

The supplier portal is where operational data enters the platform. The design principle is zero required knowledge. A user who does not know what a data domain is, has never heard of embedded emissions, and has no sustainability background must be able to complete the core workflow without assistance or documentation.

If a user needs to ask for help to complete a task, the task must be redesigned.

### 17.2 Onboarding — plain English first

Before asking for any document, the platform explains in plain English what Arbor does, why the user is here, and what they will do — in three sentences or fewer. Then it asks them to upload their first document.

No jargon. No regulatory context. No mention of frameworks, categories, or compliance requirements on the onboarding screen.

### 17.3 Two entry modes

**Customer-requested (primary mode):**
A buyer sends a data request to a supplier. The supplier receives a plain English email: "[Company name] needs some operational data from you. It should take about 10 minutes. Click here to get started." The link opens a scoped submission form showing only the fields the customer needs, in plain English labels.

**Self-initiated (secondary mode):**
A company signs up independently to build and maintain their own data record. Motivated by: "Your customers may ask you for this data. Having it ready means you can respond in minutes instead of days."

### 17.4 Document upload flow

1. User is shown a plain English prompt: "Upload documents from your business — energy bills, invoices, delivery notes, production records. Arbor reads them and organises the information."
2. User uploads documents. Drag and drop. No file type knowledge required.
3. Platform identifies document type. If confident, proceeds silently. If uncertain, asks one plain English question.
4. Extraction runs. Progress indicator: "Reading your document..."
5. Results shown as a plain English field list: what was found, from which text. Flagged fields highlighted: "We are not sure about this value. Here is what we found: [source text]. Does this look right?"
6. User confirms or corrects flagged fields. One at a time.
7. Platform confirms in plain English: "Done. Your [document type] for [period] has been saved."
8. Cross-validation runs in the background. Conflicts surfaced at next login in plain English.

### 17.5 Manual entry

Where a user has no document to upload for a specific field, they can enter a value directly. The platform accepts it and assigns Tier B (Declared). The user is prompted to upload a document later to upgrade to Tier A (Verified). Manual entry is never the primary flow — it is a fallback.

### 17.6 What the SME supplier sees

Three sections only:

**Your documents:** List of uploaded documents. Each row: document name, what type it is in plain English, the period it covers, status (Reading / Needs attention / Ready).

**Your data:** Summary by time period. Plain English: "Q3 2026 — Energy, production output, and 4 deliveries — Verified." No domain codes. No tier codes. Tap to expand shows field-level detail.

**Requests:** Incoming data requests from customers. Each row: who is asking, what they need, deadline. One action: "Respond →". The response form is pre-filled from existing data where available.

### 17.7 What happens invisibly

Domain assignment, trust tier assignment, confidence scoring, SI unit normalisation, cross-document validation, audit chain entry. All of this happens without the user seeing it. A technical view is available to the user on request but is not surfaced by default.

---

## 18. The Buyer Interface

### 18.1 Purpose

The buyer interface serves large company buyers and corporate teams who need structured, certified operational data from their supply chains. These are sophisticated users. The buyer interface uses full technical detail because that detail is what they need to assess data quality and make decisions.

### 18.2 Core functions

**Supply chain map:** All supplier entities the buyer has relationships with. Per supplier: data coverage by domain and period, trust tier distribution, last submission date. Gaps are immediately visible.

**Data requests:** Send a structured data request to a supplier. Specify: which entity, which domain, which fields, which period, deadline. The supplier receives a plain English email. The buyer tracks from sent to responded.

**Data query:** Query across the supply chain. Which suppliers have energy records for Q3? What is the production volume across all steel suppliers for the year? What is the trust tier breakdown? Results include full provenance on every record.

**Gap identification:** Which suppliers, fields, and periods are missing. What the trust tier distribution is across the supply chain for a given domain. Which suppliers, if they submitted records, would complete the buyer's required data set.

**Data assembly for sharing:** The buyer can assemble a structured data set from across their supply chain for any domain and period, with trust tiers visible, for export or sharing to their own reporting tools. Arbor assembles and exports the records. The buyer's reporting tools perform whatever calculations their frameworks require.

---

## 19. The Database

### 19.1 Structure

**Entity-scoped records:** A company's own data, fully accessible to them and to parties they have explicitly authorised. Private by default. Shared only by deliberate action.

**Aggregated and anonymised analytics:** Statistical summaries computed from the accumulated dataset. No individual entity is identifiable. Available from Phase 3 once minimum population thresholds are met.

### 19.2 Relational structure

The database is relational. Records are structured for efficient querying across the following dimensions:
- Entity (company)
- Domain (one of eight)
- Field (specific data point within a domain)
- Period (start and end date)
- Trust tier (A, B, or C)
- Document (source document)
- Submission timestamp

Any combination of these dimensions can be queried by an authorised user.

### 19.3 Data governance

- Entity-scoped data is never included in aggregated outputs without explicit consent, granted at onboarding and revocable at any time
- Aggregated outputs are computed from a minimum of 10 entities — no output below this floor
- Anonymisation is verified before any aggregated dataset is released externally
- A data governance committee reviews and approves aggregated data use rules before the aggregated product launches

---

## 20. Audit and Traceability

### 20.1 The audit chain

Every data record is linked by a cryptographic HMAC chain. Each record's hash includes the hash of the previous record for that entity. No record can be altered without breaking the chain. The chain is verifiable on demand for any entity and any period.

This is invisible to the SME user. It is the technical guarantee that underpins the Verified status of every Tier A record.

### 20.2 Traceability requirement

Every data record shared with any authorised party must carry:
- The specific record identifier
- The source document reference (Tier A) or declaration event reference (Tier B)
- The exact source text (Tier A)
- The confidence score at extraction
- The trust tier
- The submission timestamp
- The audit chain reference

Provenance information cannot be stripped from any shared record.

### 20.3 Version control

Records are never overwritten. When a record is corrected or superseded:
- The original is preserved with its original timestamp and hash
- A new record is created with the updated value
- The supersession relationship is logged
- Both versions are visible in the audit chain
- The entity and any authorised buyers are notified of the correction

### 20.4 Audit package

On demand, the platform generates a structured audit package for any entity and period containing: all records, source documents index, confidence scores, source text, full audit chain, and cross-validation report. Designed for handoff to a third-party verifier without further preparation.

---

## 21. Data Sharing and Export

### 21.1 Sharing within the platform

A supplier authorises a buyer to access specific domains and periods from their entity-scoped record. The authorisation is:
- Explicit — requires a deliberate action by the supplier
- Scoped — covers only what the supplier specifies (domain, period, fields)
- Revocable — the supplier can withdraw access at any time
- Logged — every authorisation and revocation is recorded in the audit chain

The buyer sees the shared records in their buyer interface with full provenance visible. The supplier sees a log of what they have shared and with whom.

### 21.2 Export formats

Records can be exported from the platform in the following formats. The underlying data does not change — the format adapts to the recipient's needs.

- **CSV** — tabular export of records with all attributes, for import into spreadsheets or other tools
- **JSON** — structured export for API integration and developer use
- **XML** — structured export for systems requiring XML input
- **Structured data share** — within-platform share to an authorised buyer without file download

Every export includes trust tier labels and provenance references on every record. These cannot be removed.

### 21.3 What Arbor does not produce

Arbor does not produce:
- CBAM returns or regulatory submission files
- Scope 3 inventories or GHG Protocol outputs
- ESG disclosure documents
- Carbon footprint calculations
- Compliance certificates

These outputs are the responsibility of the party receiving the data. Arbor provides the certified operational data those outputs are built from. The calculations and formatting for regulatory or disclosure purposes happen in the recipient's own tools or their advisors' tools.

---

## 22. Commercial Model

### 22.1 Free tier — the onboarding mechanism

Any supplier can receive and respond to any number of customer-initiated data requests for free, indefinitely. This is not a trial. It is the permanent free tier.

The reasoning: buyers pull suppliers onto the platform by sending data requests. If suppliers face any cost to respond, adoption stalls. The free tier removes this friction entirely. Suppliers respond for free. Buyers pay for the ability to send structured requests and query assembled supply chain data.

### 22.2 Supplier subscription — paid tier

Suppliers and manufacturers who want to proactively manage their data record — uploading documents independently of customer requests, maintaining a complete historical record, querying their own data — pay a subscription.

Pricing by company size:
- Micro (under 10 employees): £29/month
- Small (10–49 employees): £79/month
- Medium (50–249 employees): £149/month with multi-user access

### 22.3 Buyer subscription

Large company buyers pay to send structured data requests, query supply chain data, assemble data sets for export, and access the gap identification tools. Pricing by supply chain size — number of active supplier relationships managed.

- Standard (up to 25 suppliers): £299/month
- Growth (up to 100 suppliers): £599/month
- Enterprise (unlimited suppliers): £1,499/month

### 22.4 Audit package generation (Phase 2)

Production of a structured audit package for a third-party verifier is a paid service per entity per period.

### 22.5 Sector analytics and benchmarks (Phase 3)

Aggregated, anonymised sector statistical benchmarks available as a data product. Primary buyers: corporate sustainability teams, consultancies, financial institutions, government bodies.

### 22.6 Institutional data partnerships (Phase 3)

Data supply agreements with government bodies, development finance institutions, or sector regulators for access to aggregated anonymised operational data at national or sector scale.

---

## 23. Data Liability

### 23.1 What Arbor certifies

Arbor certifies the following for every Tier A data record:
- A specific document was submitted by a specific registered entity
- On a specific date and time
- A specific value was extracted from a specific piece of text in that document
- The confidence score at extraction was X
- No subsequent alteration has been made without a new record being created and the original preserved
- The audit chain is unbroken

This is provenance certification. It is not truth certification.

### 23.2 What Arbor does not certify

Arbor does not certify that:
- The submitted document accurately reflects the entity's real-world operations
- The figures in any submitted document are correct
- Any output produced by a third party using Arbor data is accurate or compliant
- The entity has met any regulatory requirement

The entity remains solely responsible for the accuracy of whatever they submit. The party using Arbor data for any calculation, compliance submission, or disclosure is solely responsible for the correctness of that output. Arbor provides certified data provenance — nothing more.

### 23.3 User acknowledgement

At onboarding every entity acknowledges in plain English: "Arbor organises and certifies your business documents. It does not check whether your documents are accurate. You are responsible for ensuring the information you submit is correct." This acknowledgement is recorded in the audit chain.

### 23.4 Error handling

When an extraction error is identified: the original record is preserved with its original hash, a corrected record is created, the correction is logged in the audit chain with the reason, and both the submitting entity and any authorised buyers are notified. Arbor does not silently correct errors. Every correction is visible and auditable.

---

## 24. Phased Execution

The ingestion pipeline and relational database are built once. The go-to-market is phased by sector and by document type. The database fills as a byproduct of every phase.

### Phase 1 — Foundation (months 1–6)

**What is built:**
- Document ingestion pipeline for Phase 1 priority documents (Section 11.1)
- Three-tier trust system with plain English labels
- Cryptographic audit chain
- Relational database with full entity model
- Unit conversion engine for all supported dimensions
- Supplier portal: plain English onboarding, document upload, customer-requested submission, data view
- Buyer interface: supply chain map, data requests, data query, gap identification
- CSV and JSON export with full provenance on every record

**What is not in Phase 1:**
- Statistical analytics and benchmarking
- Audit package generation
- Agricultural document types
- API integration layer
- Sector benchmark product
- Supplier Data Readiness Score

**Who it serves:**
- UK SME manufacturers, importers, and suppliers in steel, aluminium, cement, fertiliser, and hydrogen sectors
- Their customers who need structured, certified operational data from them

**Success criteria for Phase 1:**
- An SME with no data or sustainability background can upload a document and have data extracted and stored within 10 minutes of signing up
- A buyer can send a data request and receive a Verified response within 48 hours
- A buyer can export a structured data set with full provenance across 5+ suppliers in under 5 minutes
- Zero cases of a data record shared with incorrect trust tier labelling

**Database state at end of Phase 1:**
- Verified energy, production, logistics, and materials records for Phase 1 sector entities
- Every record with an unbroken audit chain
- Unit conversion operational across all supported dimensions

### Phase 2 — Expansion (months 7–18)

**What is built:**
- Phase 2 expansion document types (Section 11.2)
- Statistical analytics for entity and supply chain levels
- Audit package generation
- API integration layer for ERP and accounting system ingestion
- Supplier Data Readiness Score
- XML export format
- Customer data share workflow with scoped access controls

**Who it serves:**
- Agricultural producers and agri-food processors
- Corporate sustainability and procurement teams
- Third-party auditors and verifiers

### Phase 3 — Institutional (months 19–36)

**What is built:**
- Phase 3 document types (Section 11.3)
- Aggregated sector benchmark product with minimum population controls
- Institutional data partnership programme
- Full analytics suite

**Who it serves:**
- Government bodies and regulators
- Development finance institutions
- Sector trade associations
- Financial institutions

---

## 25. Non-Requirements

*(Note: Section 25 was truncated in the source document. The following is the partial content received.)*

**A calculation engine.** Arbor does not calculate sustainability metrics, emissions figures, compliance liabilities, or any derived output. It holds the operational data that others calculate from. This is not a limitation — it is the architecture.

**CBAM returns, Scope 3 inventories, or ESG reports.** Arbor does not produce regulatory or disclosure outputs. It provides the certified data those outputs require. The output is the responsibility of the entity or advisor producing it.

---

*This document is a living specification. Every addition requires a stated first principle. Every removal requires a stated reason.*

**Document version:** 1.3
**Last updated:** June 2026
