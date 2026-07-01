// Coarse field-type classification for calibration grouping (Upgrade 1).
//
// The plan's kill signal tracks Expected Calibration Error for three field types
// — supplier identity, mass, emissions intensity. Extraction produces many raw
// field names across document types; this maps the ones that belong to those
// three semantic buckets so calibration measures them as a whole. Everything
// else returns null and is calibrated under its own field name.

export type FieldType = 'supplier_identity' | 'mass' | 'emissions_intensity'

const FIELD_TYPE_BY_NAME: Record<string, FieldType> = {
  // Who the counterparty is — the identity-resolution surface.
  supplier_name: 'supplier_identity',
  account_holder_name: 'supplier_identity',
  holder_name: 'supplier_identity',
  certificate_holder_name: 'supplier_identity',

  // Mass / weight readings.
  shipment_weight: 'mass',
  declared_weight: 'mass',
  gross_weight: 'mass',
  quantity_tonnes: 'mass',
  total_mass_per_unit: 'mass',

  // Per-unit emissions and emission factors.
  embedded_emissions_per_tonne: 'emissions_intensity',
  factor_value: 'emissions_intensity',
}

/** Coarse kill-signal field type for a raw field name, or null if uncategorised. */
export function classifyFieldType(fieldName: string): FieldType | null {
  return FIELD_TYPE_BY_NAME[fieldName] ?? null
}
