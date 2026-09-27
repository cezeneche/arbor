// "Why this number?" — the words on the document a figure came from. Pure.
//
// Nucleos returns the evidence Arbor sent when the case was opened: the value,
// the text it was read from, how confident the reading was, and whether a
// person corrected it. This turns that into plain English for the importer.

export interface ExplainedSource {
  text: string
  how: string
  /** The document's review page, when the evidence names an Arbor document. */
  documentHref: string | null
}

export interface PresentedExplanation {
  available: boolean
  sources: ExplainedSource[]
}

interface Atom {
  field?: unknown
  source?: unknown
  confidence?: unknown
  snippet?: unknown
  source_ref?: unknown
}

const DOCUMENT_REF = /^arbor:document:([A-Za-z0-9_-]+)$/

function how(atom: Atom): string {
  if (atom.source === 'arbor_reviewer_corrected') {
    return 'Corrected by a person on review. The document text is shown as it was read.'
  }
  const confidence = typeof atom.confidence === 'number' ? Math.round(atom.confidence * 100) : null
  return confidence === null ? 'Read from the document.' : `Read from the document (${confidence}% sure).`
}

export function presentExplanation(
  body: { chosen_value?: unknown; evidence?: unknown } | null,
): PresentedExplanation {
  const atoms = Array.isArray(body?.evidence) ? (body!.evidence as Atom[]) : []
  const sources = atoms
    .filter(a => typeof a.snippet === 'string' && a.snippet.trim() !== '')
    .map(a => {
      const doc = typeof a.source_ref === 'string' ? DOCUMENT_REF.exec(a.source_ref) : null
      return {
        text: (a.snippet as string).trim(),
        how: how(a),
        documentHref: doc ? `/upload/${doc[1]}/review` : null,
      }
    })
  return { available: sources.length > 0, sources }
}
