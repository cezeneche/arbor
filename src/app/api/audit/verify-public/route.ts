import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyChain, type AuditPayload } from '@/lib/layer2/audit-chain'
import { verifySubmittedPackage } from '@/lib/audit-package/verify-submitted'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/rate-limit-pure'

// Public, unauthenticated audit-package verification. An external auditor holding
// a generated package can check it without an Arbor account. Returns no records
// and no PII, and always responds 200 so the status code never reveals whether an
// entityId exists.
//
// Three separate facts, reported separately, because conflating them is how the
// previous version answered a question nobody asked:
//
//   contentsMatchHash  — the package in your hands still hashes to the value it
//                        carries. This is the tamper check, and it needs the
//                        contents; a hash quoted on its own cannot provide it.
//   hashIssuedByArbor  — Arbor's log records issuing that hash for that entity.
//   entityChainIntact  — the entity's audit chain verifies *right now*. This is
//                        about the entity today, not about the package, which was
//                        a snapshot. A later break elsewhere in the chain does not
//                        retrospectively falsify an old genuine package, so it is
//                        never folded into the package verdict.

const MAX_PACKAGE_BYTES = 20_000_000

async function rateLimited(req: NextRequest): Promise<boolean> {
  const ip = getClientIp(req.headers.get('x-forwarded-for'), req.headers.get('x-real-ip'))
  const { allowed } = await checkRateLimit(RATE_LIMITS.verifyPublic, ip)
  return !allowed
}

async function describeEntityChain(entityId: string) {
  const auditEntries = await prisma.auditEntry.findMany({
    where: { entityId },
    orderBy: { sequence: 'asc' },
    select: { hash: true, previousHash: true, payload: true },
  })
  return {
    entityChainIntact: verifyChain(
      auditEntries.map(e => ({
        hash: e.hash,
        previousHash: e.previousHash,
        payload: e.payload as unknown as AuditPayload,
      })),
    ),
    entryCount: auditEntries.length,
  }
}

// POST — the real check. Send { package: <the full package JSON> }.
export async function POST(req: NextRequest) {
  if (await rateLimited(req)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const raw = await req.text()
  if (raw.length > MAX_PACKAGE_BYTES) {
    return NextResponse.json({ error: 'Package too large to verify.' }, { status: 413 })
  }

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 })
  }

  const submitted = (body as { package?: unknown })?.package ?? body
  const verdict = verifySubmittedPackage(submitted)

  if (!verdict.ok) {
    return NextResponse.json({
      contentsMatchHash: false,
      hashIssuedByArbor: false,
      reason: 'This does not look like an Arbor audit package.',
    })
  }

  const log = await prisma.auditPackageLog.findFirst({
    where: { entityId: verdict.entityId, packageHash: verdict.recomputedHash },
    orderBy: { generatedAt: 'desc' },
  })

  const chain = await describeEntityChain(verdict.entityId)

  return NextResponse.json({
    contentsMatchHash: verdict.contentsMatchHash,
    hashIssuedByArbor: log !== null,
    packageGeneratedAt: log?.generatedAt.toISOString() ?? null,
    ...chain,
    verifiedAt: new Date().toISOString(),
    reason: verdict.contentsMatchHash
      ? log
        ? null
        : 'The package is internally consistent, but Arbor has no record of issuing this hash for this entity.'
      : 'The contents of this package do not match the integrity hash it carries. It has been altered since Arbor produced it.',
  })
}

// GET — a hash lookup, kept for the entity+hash form. It deliberately does NOT
// answer "is this package genuine": without the contents that question cannot be
// answered, and answering it anyway is what let an altered package pass.
export async function GET(req: NextRequest) {
  if (await rateLimited(req)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const sp = req.nextUrl.searchParams
  const packageHash = sp.get('packageHash')
  const entityId = sp.get('entityId')

  if (!packageHash || !entityId) {
    return NextResponse.json({
      hashIssuedByArbor: false,
      reason: 'packageHash and entityId are required',
    })
  }

  const log = await prisma.auditPackageLog.findFirst({
    where: { entityId, packageHash },
    orderBy: { generatedAt: 'desc' },
  })

  if (!log) {
    return NextResponse.json({
      hashIssuedByArbor: false,
      reason: 'Package hash not recognised',
    })
  }

  const chain = await describeEntityChain(entityId)

  return NextResponse.json({
    hashIssuedByArbor: true,
    packageGeneratedAt: log.generatedAt.toISOString(),
    ...chain,
    verifiedAt: new Date().toISOString(),
    note: 'This confirms Arbor issued a package with this hash. To confirm the package you are holding is that package, POST it to this endpoint.',
  })
}
