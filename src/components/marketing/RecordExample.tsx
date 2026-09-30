'use client'

import { useId, useState } from 'react'

export function RecordExample({ compact = false }: { compact?: boolean }) {
  const [showSource, setShowSource] = useState(false)
  const evidenceId = useId()

  return (
    <div className={`mk-example${compact ? ' mk-example-compact' : ''}`} aria-label="Illustrative document-to-record example">
      <div className="mk-example-topline">
        <span className="mk-example-label">Illustrative example</span>
        <span className="mk-example-step">Document → record</span>
      </div>
      <div className="mk-example-content">
        <div className="mk-example-document">
          <div className="mk-example-document-head">
            <span className="mk-example-file" aria-hidden="true">PDF</span>
            <div>
              <strong>Electricity statement</strong>
              <span>Example supplier · April 2026</span>
            </div>
          </div>
          <div className="mk-example-document-row"><span>Billing period</span><strong>1–30 Apr 2026</strong></div>
          <div className="mk-example-document-row mk-example-highlight"><span>Electricity used</span><strong>12,480 kWh</strong></div>
          <div className="mk-example-document-row"><span>Site</span><strong>North Works</strong></div>
        </div>
        <div className="mk-example-connector" aria-hidden="true">→</div>
        <div className="mk-example-record">
          <div className="mk-example-record-head">
            <span>Operational record</span>
            <span className="mk-example-tier mk-tier-verified">Verified</span>
          </div>
          <strong className="mk-example-value">12,480 <small>kWh</small></strong>
          <span className="mk-example-metric">Electricity consumption · April 2026</span>
          <div className="mk-example-record-bottom">
            <span>Source attached · Confirmed on review</span>
            <button type="button" aria-expanded={showSource} aria-controls={evidenceId} onClick={() => setShowSource(value => !value)}>
              {showSource ? 'Hide source' : 'View source'}
            </button>
          </div>
        </div>
      </div>
      <div id={evidenceId} className="mk-example-evidence" hidden={!showSource}>
        <strong>Source evidence</strong>
        <p>“Electricity used: 12,480 kWh” was read from the statement and confirmed on review, so the record is Verified: it matches its source document. It is not an audit of the site’s electricity use.</p>
      </div>
    </div>
  )
}
