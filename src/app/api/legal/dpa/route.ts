import { NextResponse } from 'next/server'
import { SUB_PROCESSORS, DPA_VERSION, DPA_LAST_UPDATED } from '@/lib/legal/subprocessors'

// Gap 7.1 — downloadable, versioned DPA with sub-processor appendix.
// Served as Markdown with an attachment disposition so a buyer's procurement
// team can save and circulate it. No PDF dependency required.
export async function GET() {
  const appendix = SUB_PROCESSORS.map(
    (s) => `- **${s.name}** — ${s.activity}. Location: ${s.location}. DPA: ${s.dpaUrl}`,
  ).join('\n')

  const body = `# Data Processing Agreement (${DPA_VERSION})

**Provider:** Nucleos Compliance Ltd (Arbor)
**Last updated:** ${DPA_LAST_UPDATED}

This Data Processing Agreement ("DPA") forms part of the agreement between the
Customer (data controller) and Nucleos Compliance Ltd (data processor) for the
use of Arbor.

> This document must be reviewed by a qualified solicitor before execution.

## 1. Subject matter and duration
The processor processes operational documents and the structured data extracted
from them on behalf of the controller, for the duration of the service agreement.

## 2. Nature and purpose of processing
Ingestion, certification, storage, and sharing of operational data. Arbor does
not perform sustainability calculations and produces no regulatory outputs.

## 3. Types of personal data
Account holder names, business email addresses, and any personal data incidentally
present in submitted operational documents.

## 4. Obligations of the processor
- Process personal data only on documented instructions from the controller.
- Ensure persons authorised to process have committed to confidentiality.
- Implement appropriate technical and organisational measures (see /security).
- Engage no sub-processor without authorisation; the current list is in the appendix.
- Assist the controller with data-subject rights and breach notification.
- Delete or return personal data at the end of the service, subject to legal retention.

## 5. Sub-processors (Appendix)
${appendix}

## 6. International transfers
Where a sub-processor is located outside the UK/EEA, Standard Contractual Clauses
are in place as noted above.

## 7. Security
Technical and organisational measures are summarised at /security and detailed in
the provider's internal information security policy.

---
Version ${DPA_VERSION} · ${DPA_LAST_UPDATED}
`

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="arbor-dpa-${DPA_VERSION}.md"`,
    },
  })
}
