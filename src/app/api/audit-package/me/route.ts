import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/session'
import { requireAuth } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { assembleAuditPackage } from '@/lib/audit-package/assemble'
import { renderAuditReportMarkdown } from '@/lib/audit-package/report-md'
import { buildZip, type ZipEntry } from '@/lib/audit-package/zip'
import { assertAuditPackageAllowed } from '@/lib/plan-guard'
import { fetchDocumentAsBase64 } from '@/lib/storage-retrieval'

// Layer 3 — generate the caller's own audit package, including any third-party
// verification block and the integrity hash + public verification instructions.
// Generation is logged for later public verification.
//
// Delivered as a ZIP, because PRD §12.4 asks for something that can be handed to
// an accredited verifier "without further manual preparation" and a verifier
// cannot check provenance against a filename. The archive carries:
//
//   README.md     the package as a readable report
//   package.json  the same package as structured data, with the Merkle proofs
//   documents/    the original source documents the records came from
//
// The JSON stays canonical: packageIntegrityHash is computed over the core
// object, so neither the Markdown nor the archive framing affects verification.
//
// Scoped by ?periodStart / ?periodEnd. Unscoped still means "everything", which
// is a deliberate default for a supplier with one year of data, not an oversight.

export const dynamic = 'force-dynamic'

/** Source documents are fetched in parallel, but bounded so a large package
 *  cannot open hundreds of concurrent connections to storage. */
const DOCUMENT_FETCH_CONCURRENCY = 5

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return results
}

/** Unique, filesystem-safe name per document, preserving the original where possible. */
function archiveName(fileName: string, documentId: string, taken: Set<string>): string {
  const cleaned = fileName.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[-.]+/, '') || 'document'
  let candidate = cleaned
  if (taken.has(candidate)) {
    // Two documents can legitimately share a filename; the id disambiguates
    // without hiding which is which.
    const dot = cleaned.lastIndexOf('.')
    const stem = dot > 0 ? cleaned.slice(0, dot) : cleaned
    const ext = dot > 0 ? cleaned.slice(dot) : ''
    candidate = `${stem}-${documentId.slice(-8)}${ext}`
  }
  taken.add(candidate)
  return candidate
}

export async function GET(req: NextRequest) {
  const { session, response } = await requireAuth()
  if (!session) return response!
  const entityId = getSessionUser(session).entityId as string
  const userId = getSessionUser(session).id

  // PRD §22.4 — generation is a paid service, not a free button on every plan.
  const entitlement = await assertAuditPackageAllowed(entityId)
  if (!entitlement.allowed) {
    return NextResponse.json({ error: entitlement.reason, code: 'PLAN_LIMIT' }, { status: 403 })
  }

  const sp = req.nextUrl.searchParams
  const periodStartRaw = sp.get('periodStart')
  const periodEndRaw = sp.get('periodEnd')

  for (const [name, raw] of [['periodStart', periodStartRaw], ['periodEnd', periodEndRaw]] as const) {
    if (raw && Number.isNaN(Date.parse(raw))) {
      return NextResponse.json({ error: `Invalid ${name}.` }, { status: 400 })
    }
  }
  const periodStart = periodStartRaw ? new Date(periodStartRaw) : null
  const periodEnd = periodEndRaw ? new Date(periodEndRaw) : null
  if (periodStart && periodEnd && periodStart > periodEnd) {
    return NextResponse.json({ error: 'periodStart must be on or before periodEnd.' }, { status: 400 })
  }

  const { package: pkg, chainIntegrityVerified, auditEntryCount, merkleShadow } =
    await assembleAuditPackage({
      entityId,
      periodStart,
      periodEnd,
      logRequestedById: userId,
    })

  const body = {
    generatedAt: pkg.generatedAt.toISOString(),
    entityId,
    entityName: pkg.entityName,
    periodStart: periodStartRaw,
    periodEnd: periodEndRaw,
    recordCount: pkg.summary.totalRecords,
    summary: pkg.summary,
    records: pkg.dataRecords,
    sourceDocuments: pkg.sourceDocuments,
    crossValidations: pkg.crossValidationResults,
    auditChain: { entryCount: auditEntryCount, chainIntegrityVerified },
    // Merkle commitment + per-record inclusion proofs, plus the shadow-compare
    // confirming it agrees with the linear HMAC chain.
    merkle: pkg.merkle,
    merkleShadow,
    verification: pkg.verification,
    packageIntegrityHash: pkg.packageIntegrityHash,
    verificationInstructions: pkg.verificationInstructions,
  }

  // Fetch the original documents. Fail-soft per document: one unreadable file
  // must not deny the supplier the rest of their package, and the report states
  // which are missing rather than silently omitting them.
  const blobRows = await prisma.document.findMany({
    where: { id: { in: pkg.sourceDocuments.map(d => d.id) } },
    select: { id: true, blobUrl: true, fileName: true },
  })
  const blobById = new Map(blobRows.map(r => [r.id, r]))

  const fetched = await mapWithConcurrency(pkg.sourceDocuments, DOCUMENT_FETCH_CONCURRENCY, async doc => {
    const row = blobById.get(doc.id)
    if (!row?.blobUrl) return { doc, data: null as Buffer | null }
    try {
      const { base64 } = await fetchDocumentAsBase64(row.blobUrl)
      return { doc, data: Buffer.from(base64, 'base64') }
    } catch {
      return { doc, data: null as Buffer | null }
    }
  })

  const taken = new Set<string>()
  const documentEntries: ZipEntry[] = []
  const missing: string[] = []
  for (const { doc, data } of fetched) {
    if (!data) {
      missing.push(doc.fileName)
      continue
    }
    documentEntries.push({
      path: `documents/${archiveName(doc.fileName, doc.id, taken)}`,
      data,
    })
  }

  let markdown = renderAuditReportMarkdown(pkg)
  if (missing.length > 0) {
    markdown +=
      `\n> **Note:** ${missing.length} source document${missing.length === 1 ? '' : 's'} ` +
      `could not be read from storage at generation time and ${missing.length === 1 ? 'is' : 'are'} ` +
      `not included in \`documents/\`: ${missing.join(', ')}.\n`
  }

  // One fixed timestamp for every entry, so the same package generated twice is
  // byte-identical.
  const zip = buildZip(
    [
      { path: 'README.md', data: Buffer.from(markdown, 'utf8') },
      { path: 'package.json', data: Buffer.from(JSON.stringify(body, null, 2), 'utf8') },
      ...documentEntries,
    ],
    pkg.generatedAt,
  )

  const safeName =
    pkg.entityName.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'entity'
  const scope =
    periodStartRaw && periodEndRaw
      ? `-${periodStartRaw.slice(0, 10)}-to-${periodEndRaw.slice(0, 10)}`
      : ''
  const filename = `arbor-audit-package-${safeName}${scope}.zip`

  return new NextResponse(new Uint8Array(zip), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(zip.length),
    },
  })
}
