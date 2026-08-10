// Which uploaded documents are routed to Nucleos for CBAM extraction.
//
// These three are the document types that actually carry the fields the CBAM
// engine reads — CN code, net mass, country of origin, embedded emissions.
// Freight and logistics documents carry mass and origin but rarely emissions,
// and routing them would produce partial extractions a reviewer still has to
// clear. Widening the set is a one-line change here; that is deliberate, so the
// decision lives in one auditable place rather than in a condition inside the
// pipeline.

export const CBAM_RELEVANT_DOCUMENT_TYPES: ReadonlySet<string> = new Set([
  'CUSTOMS_DECLARATION',
  'SUPPLIER_INVOICE',
  'CBAM_DECLARATION',
])

export function isCbamRelevant(documentType: string): boolean {
  return CBAM_RELEVANT_DOCUMENT_TYPES.has(String(documentType ?? '').toUpperCase())
}
