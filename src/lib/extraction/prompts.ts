export const EXTRACTION_SYSTEM_PROMPT = `
You are a document data extraction engine for a sustainability data infrastructure platform.

Extract only what is present in the document. Never infer, estimate, or fabricate values.

Return ONLY valid JSON. No preamble. No markdown fences. No explanation.

For every field:
- rawValue: value exactly as in the document, or null if not found
- rawUnit: unit exactly as in the document, or null
- sourceText: exact verbatim text from the document containing this value
- confidenceScore: 0.0–1.0 (1.0=unambiguous, 0.9=clear but minor interpretation, 0.7=could be misread, 0.5=inferred, <0.5=set flagged true)
- flagged: true if confidenceScore < 0.85 or uncertain
- flagReason: brief explanation if flagged, null otherwise

If a field is not present: rawValue=null, confidenceScore=0.0, flagged=true, flagReason="Field not found in document".
`

const DOCUMENT_TYPE_NOTES: Record<string, string> = {
  DELIVERY_NOTE: `
Key extraction rules for delivery notes and consignment notes:
- line_items is the core compulsory field. Extract each item as an array with description, quantity, and unit. An empty array is not admissible — if no items are legible, set rawValue to null.
- delivery_note_reference is compulsory. Extract from "delivery note no.", "DN", "consignment note", "GRN" (goods received note), or similar labels.
- delivery_date is the date of physical delivery, not document creation or invoice date.
- purchase_order_reference and freight_invoice_reference are optional but should be extracted if present — they enable cross-document validation.
- shipper_name and consignee_name must both be captured; do not conflate carrier with shipper.
`,

  CUSTOMS_DECLARATION: `
Key extraction rules for customs declarations and import entries:
- commodity_code is compulsory and must be 8 digits (CN code). If the document shows a 6-digit HS code, extract as-is and flag it with confidenceScore 0.7 — do not pad or infer the extra digits.
- declaration_reference is the MRN (Movement Reference Number). Extract exactly as printed including any alphanumeric prefix.
- country_of_origin and country_of_dispatch should be ISO 3166-1 alpha-2 codes. Extract as stated if a different format is used.
- declared_value and currency must be extracted together. If value is present but currency is absent, flag currency as missing.
- commodity_description should be specific — include product form, grade, or intended use where stated.
`,

  PROCESS_DATA_SHEET: `
Key extraction rules for process data sheets:
- inputs and outputs are the core compulsory fields. Extract each as an array with type, quantity, and unit. An empty array for either is not admissible — if no entries are legible, set rawValue to null so the compulsory check fires.
- process_type should be specific — include the technology or process name (e.g. "Electric arc furnace steelmaking", "Wet cement kiln"). A generic category is not useful.
- If energy_consumption is present, energy_unit must also be extracted and paired. Flag if value present but unit absent.
- emission_factors_cited should be extracted as an array if the document states calculated emissions. Include source, value, and unit for each factor. If the document shows calculated emissions without citing the factor, set confidenceScore to 0.6 and flag it.
- period_start and period_end define the production period, not document date.
`,

  FREIGHT_INVOICE: `
Key extraction rules for freight invoices:
- mode_of_transport must resolve to one of: ROAD, RAIL, SEA, AIR, MULTIMODAL. If the document describes multiple legs, use MULTIMODAL.
- If mode_of_transport is MULTIMODAL, extract multimodal_leg_breakdown as an array of legs — each with mode, origin, destination, and distance_km. Without this breakdown, emissions cannot be calculated accurately.
- shipment_weight and weight_unit must be captured together exactly as stated. Do not convert units.
- origin_country and destination_country should be ISO 3166-1 alpha-2 codes if determinable.
- invoice_number is compulsory. Extract from "invoice no.", "freight invoice", "AWB", "BOL reference", or similar labels.
- shipment_date is the date of shipment or bill of lading, not the invoice date.
`,

  MATERIAL_INTAKE: `
Key extraction rules for material intake records:
- material_specification must be specific — include grade, composition, size, or standard (e.g. "Heavy melting steel, Grade 1A, 6-8mm"). Generic labels like "steel" are not admissible at Tier A.
- delivery_note_reference is compulsory. Extract from "delivery note no.", "DN ref", "consignment note", or similar labels.
- purchase_order_reference should be extracted if visible. If absent, note in extractionNotes whether a PO reference was expected but not found.
- quantity and unit must be captured together exactly as stated. Do not convert units.
- country_of_origin should use ISO 3166-1 alpha-2 code if determinable; otherwise extract the value as written.
`,

  BILL_OF_MATERIALS: `
Key extraction rules for bills of materials:
- line_items is the core compulsory field. Extract as an array; each element must include material_name, quantity, unit, and supplier if stated. An empty array is not admissible — if no line items are legible, set rawValue to null.
- bom_version must be captured as stated (e.g. "Rev 3", "v2.1", "2024-A"). If no explicit version is visible, set confidenceScore to 0.7 and flag it.
- product_specification must be specific — include grade, standard, or dimensions (e.g. "Universal beam UB 203x133x25, grade S355"). A generic category is not admissible.
- effective_date is the date from which this BOM version applies. If only a year is given, set confidenceScore to 0.7.
- If total_mass_per_unit is present, total_mass_unit must also be extracted. Flag if the value is present but the unit is absent.
`,

  FERTILISER_RECORD: `
Key extraction rules for fertiliser records:
- nitrogen_content_percent is compulsory. It is used to calculate N2O emissions. Extract it even if labelled as "N%" or "%N". Without this field the record cannot be used for emissions calculation.
- phosphorus_content_percent and potassium_content_percent are conditional: extract them only if the product is an NPK fertiliser (product name contains "NPK", lists three nutrient percentages, or describes itself as compound/multi-nutrient).
- application_rate_unit must capture the unit exactly as stated (e.g. "kg/ha", "litres/ha").
- If the document shows a nutrient analysis table, extract all available N, P, K percentages.
`,

  CROP_YIELD_RECORD: `
Key extraction rules for crop yield records:
- harvest_date must be a specific date, not a season or year range. If only a year is given, set confidenceScore to 0.7 and flag it.
- area_hectares should be extracted from the field area, not the farm total.
- yield_unit must be captured exactly (e.g. "tonnes/ha", "kg", "bushels"). Do not convert.
- crop_type should be the specific crop (e.g. "Winter wheat", "Oilseed rape"), not a generic category.
`,

  LIVESTOCK_RECORD: `
Key extraction rules for livestock records:
- average_herd_size should be the mean headcount over the period, not a single point-in-time count.
- feed_unit is required whenever feed_quantity is present. Extract the unit exactly (e.g. "kg", "tonnes", "kg DM").
- species must match one of: CATTLE, SHEEP, PIGS, POULTRY, OTHER. If "OTHER", note the actual species in extractionNotes.
- period_start and period_end define the recording period, not individual event dates.
`,

  LAND_USE_CERTIFICATE: `
Key extraction rules for land use certificates:
- land_parcel_reference should be the official parcel or field identifier (e.g. OS grid reference, cadastral number, LPIS parcel ID).
- land_use_type should capture the specific designation (e.g. "arable", "permanent grassland", "woodland", "wetland", "organic").
- area_hectares is the certified area, not total farm area.
- expiry_date is critical for validity checks — extract it even if labelled "valid until" or "renewal date".
- geographic_coordinates if present should be captured in WGS84 decimal degrees format.
`,

  BILL_OF_LADING: `
Key extraction rules for bills of lading:
- bill_of_lading_number is compulsory. Extract exactly as printed. Do not confuse with container numbers, booking references, or vessel voyage numbers.
- shipper_name is the party who ships the goods (exporter). consignee_name is the recipient. Do not confuse with carrier or freight forwarder.
- port_of_loading and port_of_discharge should be captured as city/port name, not country. Include country in parentheses if it helps disambiguation (e.g. "Hamburg (DE)").
- gross_weight and gross_weight_unit must be captured together exactly as stated. Weight is typically in kg or metric tonnes — do not convert.
- date_of_issue is the bill of lading date, not the sailing date, arrival date, or document date.
- vessel_name and container_numbers are optional but extract if present — they support cross-document validation against freight invoices.
- commodity_description should be specific — include HS code if stated in the document.
`,

  WASTE_RECORD: `
Key extraction rules for waste disposal records and waste transfer notes:
- record_reference is the waste transfer note (WTN) number or consignment note number. This is a legal document reference. Extract exactly as printed.
- contractor_licence is the waste carrier licence number issued by the Environment Agency (EA), SEPA, or equivalent body. Format varies — extract exactly. Do not confuse with company registration number.
- waste_classification must resolve to HAZARDOUS or NON_HAZARDOUS. If the document uses "special waste" or EWC codes beginning with asterisk (*), classify as HAZARDOUS.
- disposal_method must resolve to one of: LANDFILL, INCINERATION_WITH_RECOVERY, INCINERATION_WITHOUT_RECOVERY, RECYCLING, COMPOSTING, TREATMENT, OTHER. "Energy from waste" maps to INCINERATION_WITH_RECOVERY.
- period_start and period_end are the collection/disposal period dates, not the document date.
- waste_type should be specific — include EWC (European Waste Catalogue) code if present.
`,

  WATER_RECORD: `
Key extraction rules for water use records:
- water_source_type must resolve to one of: MAINS, GROUNDWATER, SURFACE_WATER, RECYCLED, RAINWATER. "Municipal supply" maps to MAINS. "Borehole" maps to GROUNDWATER. "River abstraction" maps to SURFACE_WATER.
- quantity_m3 is the total volume consumed. Extract the numeric value; note original unit (may be in litres or gallons) in rawUnit. The normalisation to m³ happens downstream.
- meter_reference is optional but extract if present — it enables cross-validation across periods. Format is typically an alphanumeric serial number.
- period_start and period_end should be the metering period or billing period, not document date.
- If the document shows both abstracted and returned volumes, extract the net consumed volume as quantity_m3 and note gross values in extractionNotes.
`,

  ENVIRONMENTAL_CERTIFICATE: `
Key extraction rules for environmental management certificates (ISO 14001, EMAS):
- standard must resolve to ISO_14001, EMAS, or OTHER. "ISO 14001:2015" maps to ISO_14001.
- issuing_body is the certification body that issued the certificate (e.g. BSI, Bureau Veritas, SGS, TÜV). This is distinct from the accreditation_body.
- accreditation_body is the national accreditation body that accredits the certification body (e.g. UKAS in UK, DAkkS in Germany, COFRAC in France). This is usually a smaller printed element — look for "Accredited by..." text.
- scope describes what activities are covered by the certificate. Extract in full — do not summarise.
- certificate_number must be extracted exactly as printed. Some bodies prefix with country codes or their own identifiers.
- expiry_date triggers a critical flag if expired during the reporting period. Extract precisely.
`,

  CARBON_FOOTPRINT_REPORT: `
Key extraction rules for carbon footprint reports and LCA documents:
- methodology must resolve to GHG_PROTOCOL, ISO_14064, EN_15804, PAS_2050, or OTHER. If the document names "GHG Protocol Corporate Standard" or "Scope 1/2/3", map to GHG_PROTOCOL.
- system_boundary describes the organisational and operational scope (e.g. "Operated assets, UK only", "Cradle-to-gate"). Extract the stated boundary verbatim — do not interpret.
- total_co2e is the headline emissions figure. Extract with units — may be stated as "tCO2e", "kg CO2 equivalent", "tonnes CO2e". Record the unit separately in rawUnit.
- assurance_level must resolve to NONE, LIMITED, or REASONABLE. Look for third-party assurance or verification statements. "Reasonable assurance" = REASONABLE; "Limited assurance" = LIMITED; absence of a verification statement = NONE.
- assurance_body is the verifying organisation. Only required if assurance_level is not NONE.
- scope_1_total, scope_2_total, scope_3_total are optional breakdowns. Extract if explicitly labelled — do not calculate from sub-categories.
- data_year is the reporting year (e.g. 2024 for FY2024 data), not the publication year.
`,

  RENEWABLE_CERTIFICATE: `
Key extraction rules for renewable energy certificates (REGO, REC, Guarantee of Origin):
- certificate_type must resolve to REGO, REC, GO, or OTHER. UK certificates are REGOs; US are RECs; European are Guarantees of Origin (GO).
- certificate_number is unique and compulsory. It enables duplicate detection. Extract exactly — do not truncate serial numbers.
- quantity_mwh is the energy quantity in MWh the certificate represents. Often 1 MWh per certificate but can vary for bundle documents.
- vintage_year is the year of generation. Distinct from the issue date or expiry date.
- technology_type describes the generation technology (e.g. "Onshore wind", "Solar PV", "Hydro"). Extract as stated.
- generation_country is the country where the electricity was generated, not where the certificate was issued.
- expiry_date is critical — certificates cannot be applied to periods after expiry. Extract exactly.
`,
}

export function buildExtractionPrompt(documentType: string, requiredFields: string[]): string {
  const typeNotes = DOCUMENT_TYPE_NOTES[documentType] ?? ''

  return `Extract the following fields from this ${documentType.replace(/_/g, ' ').toLowerCase()}.

Required fields: ${requiredFields.join(', ')}
${typeNotes}
Return this exact JSON structure with no other text:
{
  "documentTypeConfirmed": "your assessment of document type",
  "extractionNotes": "observations about quality or unusual features",
  "fields": [
    {
      "fieldName": "field_name_here",
      "rawValue": "value as written or null",
      "rawUnit": "unit as written or null",
      "sourceText": "exact verbatim text from document",
      "confidenceScore": 0.95,
      "flagged": false,
      "flagReason": null
    }
  ]
}`
}
