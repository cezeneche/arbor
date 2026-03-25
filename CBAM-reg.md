# Everything About CBAM — A Deep Breakdown
## Nucleos Compliance Ltd — Internal Reference Document
### March 2026

---

## Part 1: What CBAM Actually Is and Why It Exists

### The Core Problem CBAM Solves

The European Union and United Kingdom both operate carbon pricing systems — Emissions Trading Schemes (ETS) — that charge domestic manufacturers for the greenhouse gas emissions they produce. A steel plant in the UK pays for every tonne of CO2 it emits. A steel plant in China, Turkey, or India may pay nothing, or pay far less.

This creates a competitive distortion: imported goods carry embedded carbon that was never priced, while domestically produced goods carry the full cost of the ETS. Companies facing this disadvantage have two options: reduce emissions and remain competitive, or move production offshore to avoid the carbon price entirely. The second option is called **carbon leakage** — the environmental burden has not been reduced, only relocated.

CBAM is the solution. It places a carbon price on the emissions embedded in specific imported goods, equivalent to the price that would have been paid had those goods been produced domestically. It levels the playing field and removes the financial incentive to relocate production.

### The Environmental Logic

CBAM is not a trade barrier. It is a price equalisation mechanism. A UK steel producer paying £50 per tonne of CO2 under the UK ETS competes on equal terms with a foreign producer who pays the same effective carbon price after CBAM is applied. A foreign producer from a country with no carbon pricing pays the full CBAM charge. A foreign producer from a country with a linked or equivalent ETS pays nothing — they have already paid the equivalent.

This structure also creates a global incentive. Countries whose exporters face CBAM charges have a commercial reason to introduce their own carbon pricing — if they do, their exporters can deduct the domestic carbon cost from their CBAM liability, or may be exempt entirely. CBAM thus exerts pressure on global carbon pricing adoption without being a unilateral tariff.

---

## Part 2: The Two Regimes — EU CBAM and UK CBAM

There are two separate legal systems. They are similar in intent but different in design, scope, administration, and timing. Any importer dealing with both markets must manage two distinct compliance obligations.

### EU CBAM

**Legal basis:** Regulation (EU) 2023/956, as amended by Regulation (EU) 2025/2083 (Omnibus simplification package, October 2025)

**Timeline:**
- October 2023 – December 2025: Transitional phase — reporting only, no financial obligation
- January 2026 onwards: Definitive phase — financial obligations, certificate purchase required
- First annual declaration due: 31 August 2027 (for 2026 imports, deadline extended from 31 May)

**Sectors covered:**
- Iron and steel
- Aluminium
- Cement
- Fertilisers
- Hydrogen
- **Electricity** (included in EU but NOT UK)

**Administration:**
- Importers must become Authorised CBAM Declarants — registered through a national competent authority (NCA) in their EU member state
- Declarations made through the EU CBAM Registry (centralised Commission platform)
- Payment mechanism: purchase and surrender CBAM certificates (not a tax return)
- Certificate price: quarterly average of EU ETS auction price in 2026; weekly average from 2027

**Threshold:**
- Exemption for importers below 50 tonnes per year (combined net mass of covered goods)
- This exempts approximately 90% of importers while covering 99% of emissions

**Indirect emissions:**
- Included for cement and fertilisers from the start
- All other sectors must report but only pay for direct emissions in the initial phase

---

### UK CBAM

**Legal basis:** Finance (No.2) Bill 2025–26; secondary legislation published February 2026

**Timeline:**
- January 2027: Financial obligations begin immediately — no transitional period
- First annual return: 1 January – 31 December 2027; due 31 May 2028
- Quarterly returns from 1 January 2028; due two months after quarter end
- CBAM rate published quarterly from Q4 2026 (trial rate) and Q1 2027

**Sectors covered:**
- Iron and steel
- Aluminium
- Cement
- Fertilisers
- Hydrogen
- **No electricity** (excluded because most UK electricity imports come from EU/Norway which have their own ETS)

**Administration:**
- Operates as a tax return — not a certificate mechanism
- Registration with HMRC via Government Gateway
- Self-assessment: importers calculate their own liability and submit a return
- Tax agents can submit on behalf of liable persons

**Threshold:**
- £50,000 of CBAM goods in a 12-month rolling window
- Two tests run monthly: (1) have you imported £50,000 in the past 12 months? (2) do you expect to in the next 30 days?
- If either test is met, registration is required within 30 days
- In Year 1 (2027), importers have until 31 January 2028 to register

**Indirect emissions:**
- Direct emissions only from January 2027
- Indirect emissions (electricity used in manufacturing) not included until 2029 at earliest
- This is a significant difference from the EU — particularly for aluminium and hydrogen

---

## Part 3: UK vs EU CBAM — Side-by-Side Comparison

| Feature | EU CBAM | UK CBAM |
|---|---|---|
| Start date | January 2026 (financial) | January 2027 |
| Transitional period | Yes (Oct 2023 – Dec 2025) | No |
| Payment mechanism | Certificate purchase and surrender | Tax return to HMRC |
| Threshold | 50 tonnes/year (mass) | £50,000/year (value) |
| Sectors | Steel, aluminium, cement, fertilisers, hydrogen, electricity | Steel, aluminium, cement, fertilisers, hydrogen (no electricity) |
| Indirect emissions | Yes (cement, fertilisers) | No (until 2029 at earliest) |
| Indirect emissions reporting | Required for all sectors | Not required in initial phase |
| Default values | Country and CN-code specific, with mark-ups | Single default per product (HMRC to publish) |
| Default value mark-up | 10% (2026), 20% (2027), 30% (2028+) | Not yet confirmed |
| Verification requirement | GACI-accredited verifier | IAF-accredited verifier (e.g. UKAS) |
| Reporting frequency | Annual declaration from 2026 | Annual 2027; quarterly from 2028 |
| Declaration deadline | 31 August of following year | 31 May 2028 (first return); 2 months after quarter end from 2028 |
| Certificate holding | 50% of year-to-date emissions by quarter end | N/A (tax return model) |
| Electricity imports | In scope | Excluded |
| Free allocation adjustment | Yes — CBAM cost reduced as ETS free allocation phases out | Yes — FA adjustment built into CBAM rate |
| Carbon price relief | Deduction for carbon price paid in third country | CPR mechanism (GACI-verified) |
| Scrap metal | Excluded | Excluded |
| ETS linking exemption | Norway, Iceland, Liechtenstein, Switzerland | None confirmed yet (UK-EU linking under discussion) |
| Criminal offence | Yes — fraudulent evasion | Yes — criminal offence for fraudulent evasion |
| Record retention | 4 years (CBAM registry) | 6 years (HMRC) |

---

## Part 4: What Importers Must Actually Do — The Complete Compliance Workflow

### Step 1: Determine If You Are In Scope

**What to check:**
- Do you import goods in the five (UK) or six (EU) covered sectors?
- Are the specific goods identified by their 8-digit CN code in the scope annexes?
- Does your annual import value/volume exceed the threshold?
- Are you importing for commercial purposes (private individuals are exempt)?
- Are the goods of UK/EU origin (exempt from CBAM in the domestic regime)?
- Are you importing scrap products? (Excluded in both regimes)

**Tools available:**
- EU CBAM Self-Assessment Tool (Excel, European Commission) — described in detail in Part 6
- TARIC database for CN code classification
- HMRC guidance (to be published ahead of 2027)

---

### Step 2: Register

**UK CBAM:**
- Register via Government Gateway with HMRC
- Provide: EORI number, VAT registration, business legal name and address, expected CBAM goods import value and weight
- Registration due within 30 days of meeting either threshold test
- In Year 1: register by 31 January 2028

**EU CBAM:**
- Apply for Authorised CBAM Declarant status through your national competent authority
- Access the EU CBAM Registry
- Must be registered before importing (from January 2026)

---

### Step 3: Classify Your Goods

Every CBAM good must be identified by its 8-digit CN code. This is the same code used for customs declaration purposes. The CN code determines:
- Whether the good is in scope
- What sector it belongs to
- What default emissions value applies
- What production routes are relevant

Misclassification is a penalty risk. The CN code must match the customs declaration.

---

### Step 4: Determine Which Emissions to Report

**Direct emissions (Scope 1):**
Emissions generated during the production process itself — combustion of fossil fuels, chemical reactions (e.g., calcination of limestone in cement production), process heat.

Required for: all CBAM goods in both regimes.

**Indirect emissions (Scope 2):**
Emissions from the generation of electricity used in the manufacturing process. If the factory buys electricity from the grid, the carbon embedded in that electricity must be included.

Required for: EU CBAM — cement and fertilisers. UK CBAM — not required until 2029 at earliest.

**Precursor emissions:**
For complex goods — goods made from intermediate products that are themselves CBAM-covered — the embedded emissions of those precursors must be tracked and included.

Example: steel wire rope (a complex good) contains wire rod (a precursor). The emissions from producing the wire rod must be added to the emissions from producing the wire rope.

UK rule: emissions from UK-produced precursors embedded in imported complex goods are excluded (they are already under the UK ETS and have already been priced).

**Greenhouse gases covered:**
- CO2: all sectors
- N2O (nitrous oxide): fertilisers
- PFCs (perfluorocarbons): aluminium

---

### Step 5: Obtain Emissions Data From Suppliers

This is where the compliance process breaks down for most importers. The emissions data must come from the installation — the physical production facility — that manufactured the goods. This means the importer needs:

- The name and address of the producing installation
- The production route used (e.g. blast furnace-basic oxygen furnace vs. electric arc furnace for steel)
- The direct embedded emissions in tCO2e per tonne of product
- For EU and cement/fertiliser: the indirect embedded emissions (electricity-based)
- Verification of this data by an accredited third-party verifier

The supplier (overseas manufacturer) must provide this. Many cannot or will not. The EU's own data shows that 89–92% of importers were using default values rather than actual data in the first year of the EU regime — confirmation that supplier data collection is systematically difficult.

---

### Step 6: Calculate Embedded Emissions

**The three-tier hierarchy (EU 2023/1773 Article 4):**

**Tier 1 — Actual emissions (supplier-provided, verified):**
The supplier provides verified installation-level emissions data. The importer uses these values directly.
Formula: `SEE (tCO2e/t) = total_installation_emissions / total_production`

**Tier 2 — Estimated/partial data:**
Where some supplier data exists but is incomplete or not fully verified. The importer uses what is available but must flag it as estimated.

**Tier 3 — Default values:**
Where no supplier data is available. The regulator publishes default values by CN code, country of origin, and production route. These are conservative — deliberately set above actual average emissions — to incentivise data collection. The EU is adding mark-ups of 10% (2026), 20% (2027), and 30% (2028+) on top of these values.

**The CBAM calculation formula:**

```
CBAM charge = embedded_emissions_tco2e × CBAM_rate_per_tco2e

Net liability = CBAM charge - Carbon Price Relief
```

Where:
- `embedded_emissions_tco2e` = total direct (and where applicable, indirect) embedded emissions for all imported goods in the period
- `CBAM_rate_per_tco2e` = UK ETS quarterly average price × (1 - free_allocation_adjustment)
- `Carbon Price Relief` = verified carbon price already paid in country of origin, converted to GBP

---

### Step 7: Get Emissions Data Verified

**When verification is required:**
- To use actual emissions data (Tier 1) in your declaration
- To claim Carbon Price Relief (CPR)
- Verification is NOT required for default values

**Who can verify:**
- An independent body accredited to ISO 17029, ISO 14064-3, ISO 14065 and ISO 14066
- Accreditation must be from a full member of GACI (Global Accreditation Cooperation Incorporated)
- In the UK: UKAS (UK Accreditation Service) is the primary accreditation body
- Virtual site visits are permitted in some circumstances

**What verification covers:**
- The emissions data provided by the installation operator
- The production methodology
- The system boundaries (which processes and emissions are in scope)
- For CPR: the carbon price paid and the relevant free allocations or rebates received

---

### Step 8: Calculate Carbon Price Relief (CPR)

If your goods were produced in a country with a qualifying carbon pricing scheme, you can reduce your CBAM liability by the amount of carbon price already paid.

**What qualifies:**
- An explicit carbon pricing scheme (carbon tax or ETS)
- The scheme must be mandatory by law for the relevant installation
- The scheme rules and carbon price must be publicly available
- No currently exempted jurisdictions under UK CBAM (UK-EU ETS linking under active discussion)

**CPR formula:**
```
Effective carbon price = (carbon_price_local - free_allocations - rebates) per tCO2e
CPR (£) = verified_emissions × effective_carbon_price × exchange_rate_to_GBP
Net liability = CBAM charge - CPR (cannot go below zero)
```

**CPR requires GACI-accredited verification:**
The emissions data used for CPR calculation and the carbon price paid must be verified. This is a separate verification from the emissions verification — it covers the financial side (how much was actually paid, what free allocations were received).

---

### Step 9: Submit Your Return

**UK CBAM:**
- Via HMRC online (Government Gateway) — same channel as VAT and corporation tax
- Annual return for 2027 period; due 31 May 2028
- Quarterly from 2028; due two months after quarter end
- Must submit even if liability is nil (nil return)
- Tax agents can submit on behalf
- Content: per-consignment, per-goods-line data (see Part 5 for full field list)

**EU CBAM:**
- Via the EU CBAM Registry
- Annual declaration from 2026; due 31 August following year
- Must hold CBAM certificates covering at least 50% of year-to-date emissions by quarter end
- Purchase certificates from national competent authority at weekly-average ETS price

---

### Step 10: Keep Records — Six Years

**What records must be kept:**
- Commodity codes of all imported CBAM goods
- Import dates
- Import values (customs value)
- Net weights
- Actual emissions data used (if actual data was claimed)
- Verification reports from accredited verifiers
- CPR documentation (carbon price paid, verification forms, exchange rates)
- All source documents (invoices, mill certificates, customs declarations)

**Retention period:**
- UK: six years
- EU: four years (CBAM registry records)

---

## Part 5: The Self-Assessment Tool — What It Is and What It Does

### The EU Self-Assessment Tool

The European Commission developed a CBAM Self-Assessment Tool for importers as an Excel spreadsheet. It was maintained during the transitional period (October 2023 – December 2025) and was designed for a specific, limited purpose.

**What it does:**

The tool asks importers to input:
1. Their CN code (8-digit combined nomenclature code)
2. Country of origin of the goods
3. Customs procedure under which the goods are imported (e.g. release into free circulation, inward processing, temporary admission)

Based on these inputs, the tool outputs:
- Whether the goods are in scope of EU CBAM
- What reporting obligations apply during the transitional period
- Links to further regulatory guidance specific to that type of good

**What it does NOT do:**
- Calculate emissions
- Calculate financial liability
- Calculate the number of certificates required
- Provide any accounting or financial output
- Verify data
- Connect to the CBAM registry

**Critical limitations:**
- It was a transitional tool — officially maintained only through December 2025. It is no longer kept current for the definitive phase (January 2026 onwards).
- The Commission explicitly stated it accepts no responsibility or liability for the information the tool provides — it is guidance only, not legally binding.
- It only answered the binary question: "is this good in scope?" It did not help importers do anything about the compliance obligation once they knew they were in scope.

**Format:** Excel spreadsheet downloadable from the EU Commission's taxation and customs website (taxation-customs.ec.europa.eu).

**Version history:**
- Version 1.0: September 2024
- Version 1.1: March 2025 (updated for CN code changes to urea fertilisers)

---

### What the UK Self-Assessment Tool Will Look Like

HMRC has not yet published a UK equivalent of the EU self-assessment tool. They have committed to publishing "detailed guidance ahead of 2027" and stated they will "work closely with key stakeholders to ensure the guidance is comprehensive and easy to understand."

Based on the UK CBAM policy documents and the EU tool model, the UK self-assessment tool is likely to:
- Allow importers to check whether their goods are in scope (CN code + value threshold)
- Confirm which sector their goods falls into
- Provide the applicable default emissions value once HMRC publishes these
- Show the current quarterly CBAM rate

What neither the EU nor UK government tools do — and what Nucleos fills — is the operational workflow from scope confirmation through data collection, calculation, document processing, and return generation.

---

### Where the Self-Assessment Tool Ends and Nucleos Begins

The self-assessment tool answers: **"Am I affected?"**

Nucleos answers everything that comes after:

| Question | Self-Assessment Tool | Nucleos |
|---|---|---|
| Am I in scope? | ✓ | ✓ |
| When do I need to register? | ✗ | ✓ |
| How do I get emissions data from my suppliers? | ✗ | ✓ (supplier templates) |
| How do I calculate my embedded emissions? | ✗ | ✓ |
| What do I do if my supplier can't provide data? | ✗ | ✓ (default value fallback) |
| How do I reconcile conflicting documents? | ✗ | ✓ (arbitration layer) |
| How do I claim Carbon Price Relief? | ✗ | ✓ (CPR module) |
| How do I produce an audit-defensible record? | ✗ | ✓ (HMAC chain) |
| How do I generate my HMRC return? | ✗ | ✓ (UK return builder) |
| How do I generate my EU CBAM declaration? | ✗ | ✓ (EU XML builder) |

---

## Part 6: Sector-by-Sector Deep Dive

### Iron and Steel

**Why it is the most complex sector:**
Steel is produced through multiple distinct production routes, each with dramatically different carbon intensities. The production route must be identified for accurate emissions reporting.

**Key production routes:**
- **BF-BOF (Blast Furnace – Basic Oxygen Furnace):** The traditional route using iron ore and coking coal. Highest emissions. Approximately 1.8–2.2 tCO2/t of steel.
- **EAF (Electric Arc Furnace):** Uses scrap steel and electricity. Much lower direct emissions. Approximately 0.3–0.6 tCO2/t — but indirect emissions from electricity can be significant.
- **DRI-EAF (Direct Reduced Iron + Electric Arc Furnace):** Emerging lower-carbon route using natural gas or hydrogen.

**Why it matters for Nucleos:**
- Mill certificates (the primary supplier document) often state the production route
- The Annex VI default values are differentiated by production route — using the wrong route produces incorrect calculations
- Steel also has the most complex precursor tracking (pig iron, sinter, pellets, scrap are all potential precursors)

**CBAM coverage includes:**
- Basic steel products (slabs, billets, blooms)
- Flat-rolled products
- Long products (bars, rods, wire)
- Pipes and tubes
- Some downstream products (screws, bolts, nuts under certain CN codes)

**Scrap is excluded** — imported scrap steel is not subject to CBAM in either regime.

---

### Aluminium

**Emissions profile:**
- Primary aluminium (from bauxite ore via electrolysis): extremely electricity-intensive. Approximately 1.5–4.0 tCO2e/t depending on the electricity grid.
- Secondary aluminium (from recycled scrap): very low carbon intensity. Approximately 0.2–0.5 tCO2/t.
- No complex precursor inputs in primary production — simpler than steel in this respect.

**Key challenge:**
Under EU CBAM, indirect emissions (from electricity) are captured for aluminium and are highly significant. Under UK CBAM from 2027, only direct emissions are covered — which means aluminium importers face much lower UK CBAM liability than EU CBAM liability for the same goods. This creates a dual-market calculation difference that must be tracked in Nucleos.

**CBAM coverage includes:**
- Unwrought aluminium
- Aluminium powders, flakes
- Bars, rods, wire, plates, sheets
- Structures, containers, certain finished products
- **Scrap excluded in both regimes**

---

### Cement

**Emissions profile:**
The calcination of limestone (CaCO3 → CaO + CO2) produces approximately 0.5 tCO2 per tonne of cement clinker through a chemical reaction that cannot be avoided regardless of the energy source. Cement is one of the most difficult sectors to decarbonise.

**Key concepts:**
- **Clinker:** The intermediate product produced by burning limestone. Approximately 60–65% of cement is clinker. The rest is supplementary materials (fly ash, slag, gypsum).
- **Clinker content matters:** Cement with lower clinker content (blended cements) has lower emissions intensity.
- **Both direct and indirect emissions are in scope for EU CBAM** — and the revised methodology allows differentiation by clinker content.

**Special complexity:**
Under the EU CBAM simplification package (2025), operators can now differentiate cement calculations by clinker content — recognising that a 90% clinker cement and a 50% clinker cement have very different emissions profiles despite sharing a CN code.

---

### Fertilisers

**Emissions profile:**
- **Ammonia (NH3) production:** The Haber-Bosch process combines nitrogen from air with hydrogen (usually from natural gas via steam methane reforming). This produces approximately 1.6–2.1 tCO2/t of ammonia.
- **Nitric acid production:** Ammonia is oxidised to produce nitric acid. N2O (nitrous oxide) is a by-product — a greenhouse gas with 298× the warming potential of CO2.
- **Urea production:** Combines ammonia and CO2. The CO2 can come from the ammonia production process — carbon that was captured is re-emitted when urea breaks down in the soil.

**Why fertilisers are complex:**
- Multiple greenhouse gases (CO2 and N2O)
- Complex multi-stage production processes
- Both direct and indirect emissions covered in both UK and EU CBAM

**CBAM coverage includes:**
- Ammonia (anhydrous and aqueous)
- Nitric acid, sulphuric acid
- Nitrates of potassium
- Mixed NPK fertilisers
- Urea

---

### Hydrogen

**Emissions profile:**
Hydrogen's carbon intensity depends entirely on how it is produced:
- **Grey hydrogen** (steam methane reforming without carbon capture): approximately 9–12 tCO2/t H2
- **Blue hydrogen** (steam methane reforming with carbon capture): approximately 2–4 tCO2/t H2
- **Green hydrogen** (electrolysis using renewable electricity): approximately 0 tCO2/t H2

**Why it matters:**
The production route determines whether hydrogen is a high-carbon or near-zero-carbon product. CBAM should incentivise green hydrogen imports. The platform must capture the production route to apply the correct emissions intensity.

---

## Part 7: The Free Allocation Adjustment

This is one of the most technically complex aspects of CBAM and is frequently misunderstood.

**Background:**
Under ETS schemes, domestic producers receive some allowances for free — they do not have to buy them at auction. These free allowances protect energy-intensive industries from the full carbon cost until their competitors face comparable obligations. As CBAM is introduced, the carbon leakage risk is reduced, so free allocations are being phased out.

**The link to CBAM:**
The CBAM charge is not based on the full ETS carbon price. It is based on the **effective carbon price** — the ETS price minus the value of free allocations the domestic producer would have received. This prevents a windfall for importers (who would face no CBAM charge) while domestic producers effectively get free allowances.

**UK formula:**
```
CBAM rate = UK_ETS_price × (1 - free_allocation_factor_for_sector)
```

The free allocation factor decreases over time as free allocations phase out — meaning the CBAM rate increases toward the full ETS price as the free allocation phase-out progresses.

**EU formula:**
```
CBAM cost = embedded_emissions × certificate_price × (1 - free_allocation_phase_in_factor)
```

The CBAM factor starts low and increases annually from 97.5% in 2026, to 51.5% in 2030, to 14% in 2033, reaching 100% by 2034 when free allocations are fully phased out.

**Why this matters for Nucleos:**
The CBAM rate is not simply "ETS price." It includes a sector-specific free allocation adjustment that changes quarterly. The platform must use the correct quarterly CBAM rate — not the raw ETS price — for every calculation.

---

## Part 8: The Expanding Scope — What Is Coming

### Near-Term EU Expansion (2027–2028)

The European Commission has proposed extending CBAM scope to **180 downstream products** made with steel and aluminium — including car components, garden tools, appliances, and machinery. This expansion is driven by the risk that CBAM on raw materials creates an incentive to process those materials outside the EU before importing the finished goods (circumvention).

### Long-Term EU Expansion (by 2030)

The EU intends to expand CBAM to cover all sectors currently under the EU ETS by 2030. This could include chemicals, polymers, glass, ceramics, pulp and paper, and more. The EU ETS currently covers approximately 40% of EU GHG emissions — CBAM's long-term potential scope is enormous.

### UK Scope Review

The UK government has committed to keeping its CBAM scope under review. Glass and ceramics were originally included but removed for 2027 due to feasibility concerns — they may be added later. Indirect emissions will be added from 2029 at earliest. Refineries are under consideration.

### Implications for Nucleos

Every scope expansion is a new module opportunity. The platform's modular architecture is specifically designed to add sectors without rebuilding the core engine. This long-term scope expansion is the primary driver of the platform's revenue growth beyond Year 3.

---

## Part 9: The Global Context

### Other Countries Watching

Since the EU CBAM entered force, more than 25 countries have accelerated work on domestic carbon pricing specifically to avoid CBAM charges. This includes China (which has expanded its ETS), Japan (introducing a carbon levy), and several emerging economies. Russia has filed a WTO dispute complaint against EU CBAM (May 2025) — the EU considers this unfounded.

### UK-EU ETS Linking

At the UK-EU Summit in May 2025, both governments committed to exploring linking their ETS systems. If successfully linked, UK goods exported to the EU would be exempt from EU CBAM charges (because the UK ETS would be recognised as equivalent). Similarly, EU goods imported into the UK might be exempt from UK CBAM. This would be a significant change to the compliance landscape — but no timeline has been confirmed and "exploring" is not "implementing."

### The US Position

The US has not introduced a CBAM equivalent. US exporters to the EU face EU CBAM charges on their steel, aluminium and other covered goods. This is creating political pressure and trade tensions, but as of March 2026 no comprehensive US federal carbon pricing system has been enacted.

---

## Part 10: What All of This Means for Nucleos Product Design

### Implications for the Platform

**1. Jurisdiction selector is non-optional.**
UK and EU CBAM have different scope (electricity in EU, not UK), different indirect emissions requirements, different calculation methodologies, different output formats, different default value sets, and different verification requirements. The platform must handle both regimes correctly.

**2. Default value updates are ongoing.**
Both regimes publish and update default values regularly. The platform's factor table with versioned rows is exactly the right architecture — inserting new rows rather than updating existing ones preserves historical accuracy.

**3. The free allocation adjustment must be dynamic.**
The CBAM rate is not a fixed number. It changes quarterly (UK) and is calculated differently by sector in both regimes. The platform needs to maintain a table of published CBAM rates and apply the correct rate for the correct period.

**4. Indirect emissions exclusion must be explicit for UK.**
When processing a UK CBAM case, the platform must not include indirect emissions in the calculation, even if the supplier has provided them. This is not an omission — it is a legal requirement. The platform must flag when indirect emissions data is available but not applicable for UK purposes, and store it for future use when indirect emissions are added to UK CBAM from 2029.

**5. Precursor exclusion for UK must be enforced.**
UK-produced precursor goods embedded in imported complex goods are excluded from UK CBAM. The platform must identify and exclude these. The EU has no equivalent exclusion.

**6. The expanding scope is a product roadmap, not a speculation.**
The EU Commission has formally proposed 180 downstream products. The UK has committed to scope review. Building the platform's sector modules to be self-contained and addable confirms it was designed for the product's actual growth trajectory.

**7. Carbon Price Relief is commercially important, not marginal.**
For importers sourcing from EU countries (EU ETS), the CPR mechanism could reduce CBAM liability to near zero if correctly claimed. Failing to implement CPR means customers overpay their CBAM liability — which is both a financial harm to them and a credibility problem for the platform.

**8. The self-assessment tool gap is real and persistent.**
The EU Commission's tool was an Excel spreadsheet that answered one binary question and has not been updated since March 2025. HMRC has not yet published a UK equivalent. The Nucleos scope checker fills a specific, documented void — not a speculative one.

---

*Compiled March 2026*
*Nucleos Compliance Ltd*
