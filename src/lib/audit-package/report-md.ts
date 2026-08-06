// Layer 3 — packaging only. Pure: an AuditPackage in, a Markdown string out. No
// DB, no network, no calculation.
//
// The JSON half of the package is what a verifier's tooling checks. This is what
// the person opening it reads. PRD §12.4 asks for something that can be handed
// to an accredited verifier "without further manual preparation", and a raw JSON
// blob does not meet that bar for a human.
//
// Every figure here is restated from the package. Nothing is recomputed, summed
// or converted — if a number is not already in the package, it does not appear.

import type { AuditPackage } from './generator'
import { trustTierConfig } from '@/lib/design-system'

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
}

function longDate(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d)
  return date.toLocaleDateString('en-GB', DATE_FORMAT)
}

function isoInstant(d: Date | string): string {
  return (d instanceof Date ? d : new Date(d)).toISOString()
}

/** Pipes and newlines would otherwise break out of a table cell. */
function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function tierLabel(tier: 'A' | 'B' | 'C'): string {
  return `${trustTierConfig[tier].label} (Tier ${tier})`
}

export function renderAuditReportMarkdown(pkg: AuditPackage): string {
  const docsById = new Map(pkg.sourceDocuments.map(d => [d.id, d]))
  const s = pkg.summary
  const lines: string[] = []

  lines.push(`# Audit package — ${pkg.entityName}`)
  lines.push('')
  lines.push(
    `**Period covered:** ${longDate(pkg.periodStart)} to ${longDate(pkg.periodEnd)}  `,
  )
  lines.push(`**Generated:** ${isoInstant(pkg.generatedAt)}  `)
  lines.push(`**Entity reference:** \`${pkg.entityId}\``)
  lines.push('')
  lines.push(
    'This package contains the operational data records held for the entity and period above, ' +
      'the source documents they were extracted from, and the cryptographic evidence needed to ' +
      'confirm none of it has been altered since it was recorded.',
  )
  lines.push('')

  // ── Contents ───────────────────────────────────────────────────────────────
  lines.push('## What is in this package')
  lines.push('')
  lines.push('| File | What it is |')
  lines.push('| --- | --- |')
  lines.push('| `README.md` | This report. |')
  lines.push('| `package.json` | The same package as structured data, including the Merkle inclusion proofs. Check this one with tooling. |')
  lines.push('| `documents/` | The original source documents the records were extracted from. |')
  lines.push('')

  // ── Summary ────────────────────────────────────────────────────────────────
  lines.push('## Summary')
  lines.push('')
  lines.push('| | Count |')
  lines.push('| --- | --- |')
  lines.push(`| Records | ${s.totalRecords} |`)
  lines.push(`| ${trustTierConfig.A.label} (Tier A) | ${s.tierACount} |`)
  lines.push(`| ${trustTierConfig.B.label} (Tier B) | ${s.tierBCount} |`)
  lines.push(`| ${trustTierConfig.C.label} (Tier C) | ${s.tierCCount} |`)
  lines.push(`| Source documents | ${s.sourceDocumentCount} |`)
  lines.push(`| Cross-validation passed | ${s.crossValidationPassCount} |`)
  lines.push(`| Cross-validation failed | ${s.crossValidationFailCount} |`)
  lines.push('')
  lines.push(
    `${trustTierConfig.A.label}: ${trustTierConfig.A.description} ` +
      `${trustTierConfig.B.label}: ${trustTierConfig.B.description} ` +
      `${trustTierConfig.C.label}: ${trustTierConfig.C.description}`,
  )
  lines.push('')

  // ── Integrity ──────────────────────────────────────────────────────────────
  lines.push('## Integrity')
  lines.push('')
  lines.push(`**Package integrity hash:** \`${pkg.packageIntegrityHash}\``)
  lines.push('')
  lines.push(
    `**Merkle root:** \`${pkg.merkle.root}\` (${pkg.merkle.algorithm}, ${pkg.merkle.leafCount} leaves)  `,
  )
  lines.push(
    pkg.merkle.consistent
      ? '**Proof check:** every inclusion proof in this package recomputes to the root above.'
      : '**Proof check:** at least one inclusion proof did NOT recompute to the root. Treat this package as suspect.',
  )
  lines.push('')
  lines.push('Each record carries an HMAC hash chained to the record written before it, so altering any stored value breaks the chain. The Merkle root additionally commits every record hash in this package at once: `package.json` includes a per-record inclusion proof, which lets you confirm a single record belongs to this package without being shown the others.')
  lines.push('')
  lines.push('### Verifying this package independently')
  lines.push('')
  lines.push(`${pkg.verificationInstructions.description}`)
  lines.push('')
  lines.push('```')
  lines.push(`GET ${pkg.verificationInstructions.endpoint}?packageHash=${pkg.verificationInstructions.params.packageHash}&entityId=${pkg.verificationInstructions.params.entityId}`)
  lines.push('')
  lines.push(`expected response: ${JSON.stringify(pkg.verificationInstructions.expectedResponse)}`)
  lines.push('```')
  lines.push('')

  // ── Independent verification ───────────────────────────────────────────────
  lines.push('## Independent verification')
  lines.push('')
  if (pkg.verification) {
    lines.push(
      `**${pkg.verification.status === 'INDEPENDENTLY_VERIFIED' ? 'Verified' : 'Rejected'}** by ` +
        `${pkg.verification.verifierName} on ${longDate(pkg.verification.verifiedAt)}.  `,
    )
    lines.push(`**Signature:** \`${pkg.verification.signatureHash}\``)
  } else {
    lines.push('No independent verification has been recorded for this entity and period.')
  }
  lines.push('')

  // ── Records ────────────────────────────────────────────────────────────────
  lines.push('## Records')
  lines.push('')
  if (pkg.dataRecords.length === 0) {
    lines.push('No records were held for this entity and period.')
  } else {
    lines.push('| Domain | Field | Value | Unit | Tier | Confidence | Source document | Record hash |')
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
    for (const r of pkg.dataRecords) {
      const doc = r.documentId ? docsById.get(r.documentId) : null
      // Stated rather than left blank: an empty cell reads as missing data, when
      // the real fact is that the value was declared without a document.
      const source = doc ? doc.fileName : 'No document (declared)'
      lines.push(
        `| ${cell(r.domain)} | ${cell(r.fieldName)} | ${cell(r.value)} | ${cell(r.unit)} | ` +
          `${cell(tierLabel(r.trustTier))} | ${cell(r.confidenceScore)} | ${cell(source)} | \`${cell(r.auditHash)}\` |`,
      )
    }
  }
  lines.push('')

  // ── Source text ────────────────────────────────────────────────────────────
  const withSourceText = pkg.dataRecords.filter(r => r.sourceText)
  if (withSourceText.length > 0) {
    lines.push('## Source text')
    lines.push('')
    lines.push('The exact wording each figure was read from, quoted verbatim from the source document.')
    lines.push('')
    for (const r of withSourceText) {
      lines.push(`- **${cell(r.fieldName)}** (\`${r.id}\`): "${cell(r.sourceText)}"`)
    }
    lines.push('')
  }

  // ── Source documents ───────────────────────────────────────────────────────
  lines.push('## Source documents')
  lines.push('')
  if (pkg.sourceDocuments.length === 0) {
    lines.push('No source documents are attached to the records in this package.')
  } else {
    lines.push('| File | Type | Submitted | Tier |')
    lines.push('| --- | --- | --- | --- |')
    for (const d of pkg.sourceDocuments) {
      lines.push(
        `| \`documents/${cell(d.fileName)}\` | ${cell(d.documentType)} | ${cell(isoInstant(d.submittedAt))} | ${cell(tierLabel(d.trustTier))} |`,
      )
    }
  }
  lines.push('')

  // ── Cross-validation ───────────────────────────────────────────────────────
  lines.push('## Cross-validation')
  lines.push('')
  if (pkg.crossValidationResults.length === 0) {
    lines.push('No two documents in this package covered the same figure, so no cross-check was possible.')
  } else {
    lines.push('| Field | Value A | Value B | Discrepancy | Outcome |')
    lines.push('| --- | --- | --- | --- | --- |')
    for (const c of pkg.crossValidationResults) {
      lines.push(
        `| ${cell(c.fieldName)} | ${cell(c.valueA)} | ${cell(c.valueB)} | ${cell(c.discrepancyPercent)}% | ` +
          `${c.passed ? 'Within tolerance' : 'Outside tolerance'} |`,
      )
    }
  }
  lines.push('')

  // ── Scope of certification ─────────────────────────────────────────────────
  lines.push('## What this package does and does not certify')
  lines.push('')
  lines.push(
    'Arbor certifies **provenance**: that a specific document was submitted by this entity on a ' +
      'specific date, that a specific value was extracted from a specific piece of text in it, the ' +
      'confidence at extraction, and that nothing has been altered since without the original being ' +
      'preserved and a new record created.',
  )
  lines.push('')
  lines.push(
    'Arbor does **not** certify that the submitted documents accurately reflect the entity\'s ' +
      'real-world operations, nor that the figures within them are correct. The entity remains ' +
      'responsible for the accuracy of what it submits, and any party using this data for a ' +
      'calculation, compliance submission or disclosure is responsible for the correctness of that ' +
      'output.',
  )
  lines.push('')

  return lines.join('\n')
}
