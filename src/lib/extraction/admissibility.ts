import { DOCUMENT_FIELD_DEFINITIONS } from './field-definitions'
import type { ExtractedFieldResult } from './types'

export type TrustTierResult = 'A' | 'B' | 'C'
export type FlagTypeResult =
  | 'ENTITY_MISMATCH'
  | 'COMPLETENESS_GAP'
  | 'MISSING_CONDITIONAL_FIELD'
  | 'LOW_CONFIDENCE'
  | 'CODE_INSUFFICIENT'
  | 'GENERIC_VALUE'
  | 'EXPIRED_CERTIFICATE'
export type SeverityResult = 'INFO' | 'WARNING' | 'CRITICAL'

export interface AdmissibilityFlag {
  fieldName: string
  flagType: FlagTypeResult
  message: string
  severity: SeverityResult
}

export interface AdmissibilityResult {
  tier: TrustTierResult
  flags: AdmissibilityFlag[]
  criticalCount: number
}

export function evaluateAdmissibility(
  documentType: string,
  extractedFields: ExtractedFieldResult[],
  entityName: string,
  reportingPeriodEnd?: Date,
): AdmissibilityResult {
  const fieldDefs = DOCUMENT_FIELD_DEFINITIONS[documentType] ?? []
  const flags: AdmissibilityFlag[] = []

  const fieldValues: Record<string, string | null> = {}
  for (const def of fieldDefs) {
    fieldValues[def.name] = null
  }
  for (const f of extractedFields) {
    fieldValues[f.fieldName] = f.rawValue ?? null
  }

  // Compulsory and conditional fields
  for (const def of fieldDefs) {
    const extracted = extractedFields.find((f) => f.fieldName === def.name)

    if (def.admissibility === 'compulsory') {
      if (!extracted || extracted.rawValue === null || extracted.rawValue === '') {
        flags.push({
          fieldName: def.name,
          flagType: 'COMPLETENESS_GAP',
          message: `Compulsory field '${def.name}' is absent. Document cannot achieve Tier A.`,
          severity: 'CRITICAL',
        })
      }
    }

    if (def.admissibility === 'conditional' && def.conditionFn) {
      if (def.conditionFn(fieldValues)) {
        if (!extracted || extracted.rawValue === null || extracted.rawValue === '') {
          flags.push({
            fieldName: def.name,
            flagType: 'MISSING_CONDITIONAL_FIELD',
            message: `Conditional field '${def.name}' required when: ${def.condition}. Field absent.`,
            severity: 'WARNING',
          })
        }
      }
    }
  }

  // Low confidence
  for (const f of extractedFields) {
    if (f.confidenceScore < 0.85 && f.rawValue !== null) {
      flags.push({
        fieldName: f.fieldName,
        flagType: 'LOW_CONFIDENCE',
        message: `Confidence ${f.confidenceScore.toFixed(2)} below 0.85 threshold for '${f.fieldName}'.`,
        severity: 'WARNING',
      })
    }
  }

  // Estimated meter read → Tier B
  if (documentType === 'ELECTRICITY_BILL' || documentType === 'GAS_BILL') {
    if (fieldValues['read_type'] === 'ESTIMATED') {
      flags.push({
        fieldName: 'read_type',
        flagType: 'COMPLETENESS_GAP',
        message:
          'Meter read is ESTIMATED. Record is Tier B. Submit an ACTUAL read for the same period to upgrade.',
        severity: 'CRITICAL',
      })
    }
  }

  // 8-digit commodity code required (CBAM / customs)
  if (documentType === 'CUSTOMS_DECLARATION' || documentType === 'CBAM_DECLARATION') {
    const code = fieldValues['commodity_code']
    if (code && code.replace(/\s/g, '').length < 8) {
      flags.push({
        fieldName: 'commodity_code',
        flagType: 'CODE_INSUFFICIENT',
        message: `Commodity code '${code}' has ${code.replace(/\s/g, '').length} digits. 8-digit CN code required for CBAM.`,
        severity: 'CRITICAL',
      })
    }
  }

  // Generic fuel type without description
  if (documentType === 'FUEL_RECEIPT') {
    if (fieldValues['fuel_type'] === 'OTHER' && !fieldValues['fuel_type_description']) {
      flags.push({
        fieldName: 'fuel_type',
        flagType: 'GENERIC_VALUE',
        message: "fuel_type is OTHER but no description provided. Generic 'fuel' is not admissible at Tier A.",
        severity: 'CRITICAL',
      })
    }
  }

  // Certificate expiry must fall within reporting period
  if (
    [
      'PRODUCT_CERTIFICATE',
      'ENVIRONMENTAL_CERTIFICATE',
      'RENEWABLE_CERTIFICATE',
      'LAND_USE_CERTIFICATE',
    ].includes(documentType)
  ) {
    const expiryStr = fieldValues['expiry_date']
    if (expiryStr && reportingPeriodEnd) {
      if (new Date(expiryStr) < reportingPeriodEnd) {
        flags.push({
          fieldName: 'expiry_date',
          flagType: 'EXPIRED_CERTIFICATE',
          message: `Certificate expired ${expiryStr}, before reporting period end. Invalid for this period.`,
          severity: 'CRITICAL',
        })
      }
    }
  }

  // Chain of Custody: custody_stages must contain at least 2 entries (spec §8.3)
  if (documentType === 'CHAIN_OF_CUSTODY') {
    const stages = fieldValues['custody_stages']
    if (stages !== null && stages !== '') {
      try {
        const parsed = JSON.parse(stages)
        if (Array.isArray(parsed) && parsed.length < 2) {
          flags.push({
            fieldName: 'custody_stages',
            flagType: 'COMPLETENESS_GAP',
            message: `Chain of Custody contains ${parsed.length} stage(s). At least 2 stages (origin + destination) are required to establish chain of custody.`,
            severity: 'CRITICAL',
          })
        }
      } catch {
        // non-JSON string — treated as non-empty, no flag
      }
    }
  }

  // BOM: empty line_items array is not admissible (spec §2.3)
  if (documentType === 'BILL_OF_MATERIALS') {
    const lineItems = fieldValues['line_items']
    if (lineItems !== null && lineItems !== '') {
      try {
        const parsed = JSON.parse(lineItems)
        if (Array.isArray(parsed) && parsed.length === 0) {
          flags.push({
            fieldName: 'line_items',
            flagType: 'COMPLETENESS_GAP',
            message: 'Bill of Materials contains zero line items. At least one material line is required.',
            severity: 'CRITICAL',
          })
        }
      } catch {
        // non-JSON string — treated as a non-empty value, no flag
      }
    }
  }

  // Delivery Note: line_items must contain at least one entry (spec §3.2)
  if (documentType === 'DELIVERY_NOTE') {
    const lineItems = fieldValues['line_items']
    if (lineItems !== null && lineItems !== '') {
      try {
        const parsed = JSON.parse(lineItems)
        if (Array.isArray(parsed) && parsed.length === 0) {
          flags.push({
            fieldName: 'line_items',
            flagType: 'COMPLETENESS_GAP',
            message: 'Delivery Note contains zero line items. At least one item is required.',
            severity: 'CRITICAL',
          })
        }
      } catch {
        // non-JSON string — treated as non-empty, no flag
      }
    }
  }

  // Supplier Invoice: line_items must contain at least one entry (spec §4.1)
  if (documentType === 'SUPPLIER_INVOICE') {
    const lineItems = fieldValues['line_items']
    if (lineItems !== null && lineItems !== '') {
      try {
        const parsed = JSON.parse(lineItems)
        if (Array.isArray(parsed) && parsed.length === 0) {
          flags.push({
            fieldName: 'line_items',
            flagType: 'COMPLETENESS_GAP',
            message: 'Supplier Invoice contains zero line items. At least one line is required.',
            severity: 'CRITICAL',
          })
        }
      } catch {
        // non-JSON string — treated as non-empty, no flag
      }
    }
  }

  // Process Data Sheet: inputs and outputs must each contain at least one entry (spec §2.4)
  if (documentType === 'PROCESS_DATA_SHEET') {
    for (const arrayField of ['inputs', 'outputs'] as const) {
      const val = fieldValues[arrayField]
      if (val !== null && val !== '') {
        try {
          const parsed = JSON.parse(val)
          if (Array.isArray(parsed) && parsed.length === 0) {
            flags.push({
              fieldName: arrayField,
              flagType: 'COMPLETENESS_GAP',
              message: `Process Data Sheet '${arrayField}' contains zero entries. At least one ${arrayField === 'inputs' ? 'input' : 'output'} is required.`,
              severity: 'CRITICAL',
            })
          }
        } catch {
          // non-JSON string — treated as a non-empty value, no flag
        }
      }
    }
  }

  // Entity name match
  const nameFields = [
    'entity_name',
    'account_holder_name',
    'certificate_holder_name',
    'declarant_name',
    'importer_name',
    'purchaser_name',
    'receiving_entity',
    'buyer_name',
  ]
  for (const nameField of nameFields) {
    const val = fieldValues[nameField]
    if (val && entityName) {
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (!norm(val).includes(norm(entityName)) && !norm(entityName).includes(norm(val))) {
        flags.push({
          fieldName: nameField,
          flagType: 'ENTITY_MISMATCH',
          message: `'${nameField}' value '${val}' does not match registered entity '${entityName}'.`,
          severity: 'WARNING',
        })
      }
    }
  }

  // CBAM Tier 1/2 must have supporting_data_reference
  if (documentType === 'CBAM_DECLARATION') {
    const tier = fieldValues['calculation_tier']
    const ref = fieldValues['supporting_data_reference']
    if ((tier === 'TIER_1' || tier === 'TIER_2') && (!ref || ref === '')) {
      flags.push({
        fieldName: 'supporting_data_reference',
        flagType: 'COMPLETENESS_GAP',
        message: `CBAM ${tier} declaration requires supporting_data_reference. Embedded figure unverifiable without it.`,
        severity: 'CRITICAL',
      })
    }
  }

  const criticalCount = flags.filter((f) => f.severity === 'CRITICAL').length
  const tier: TrustTierResult =
    documentType === 'SUPPLIER_QUESTIONNAIRE' || criticalCount > 0 ? 'B' : 'A'

  return { tier, flags, criticalCount }
}
