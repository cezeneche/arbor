'use client'

import { useState, useRef, DragEvent } from 'react'
import { useRouter } from 'next/navigation'
import { colours, typography, spacing } from '@/lib/design-system'

const DOCUMENT_TYPES = [
  { value: 'ELECTRICITY_BILL', label: 'Electricity Bill' },
  { value: 'GAS_BILL', label: 'Gas Bill' },
  { value: 'FUEL_RECEIPT', label: 'Fuel Purchase Receipt' },
  { value: 'RENEWABLE_CERTIFICATE', label: 'Renewable Energy Certificate (REGO/REC/GO)' },
  { value: 'PRODUCTION_LOG', label: 'Production Log / Batch Record' },
  { value: 'MATERIAL_INTAKE', label: 'Material Intake Record' },
  { value: 'BILL_OF_MATERIALS', label: 'Bill of Materials' },
  { value: 'PROCESS_DATA_SHEET', label: 'Process Data Sheet' },
  { value: 'FREIGHT_INVOICE', label: 'Freight Invoice' },
  { value: 'DELIVERY_NOTE', label: 'Delivery Note' },
  { value: 'CUSTOMS_DECLARATION', label: 'Customs Declaration' },
  { value: 'BILL_OF_LADING', label: 'Bill of Lading' },
  { value: 'SUPPLIER_INVOICE', label: 'Supplier Invoice' },
  { value: 'PURCHASE_ORDER', label: 'Purchase Order' },
  { value: 'CBAM_DECLARATION', label: 'CBAM Declaration' },
  { value: 'PRODUCT_CERTIFICATE', label: 'Product Certificate' },
  { value: 'ENVIRONMENTAL_CERTIFICATE', label: 'Environmental Management Certificate' },
  { value: 'CARBON_FOOTPRINT_REPORT', label: 'Carbon Footprint Report / LCA' },
  { value: 'WASTE_RECORD', label: 'Waste Disposal Record' },
  { value: 'WATER_RECORD', label: 'Water Use Record' },
  { value: 'CROP_YIELD_RECORD', label: 'Crop Yield Record' },
  { value: 'FERTILISER_RECORD', label: 'Fertiliser Application Record' },
  { value: 'LIVESTOCK_RECORD', label: 'Livestock Record' },
  { value: 'LAND_USE_CERTIFICATE', label: 'Land Use Certificate' },
  { value: 'CHAIN_OF_CUSTODY', label: 'Chain of Custody' },
  { value: 'OTHER', label: 'Other' },
]

// Gap 8.1 - per-file status while a batch uploads.
interface QueueItem {
  file: File
  status: 'queued' | 'uploading' | 'ready' | 'error'
  documentId?: string
  error?: string
}

const MAX_BATCH = 20

export function UploadZone({ initialType = '' }: { initialType?: string }) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [documentType, setDocumentType] = useState(initialType)
  const [reportingPeriodEnd, setReportingPeriodEnd] = useState('')
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [queue, setQueue] = useState<QueueItem[]>([])

  function addFiles(list: FileList | null) {
    if (!list) return
    const incoming = Array.from(list)
    setFiles((prev) => [...prev, ...incoming].slice(0, MAX_BATCH))
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault()
    setDragging(true)
  }

  function handleDragLeave() {
    setDragging(false)
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    addFiles(e.dataTransfer.files)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    addFiles(e.target.files)
  }

  async function uploadOne(file: File): Promise<QueueItem> {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('documentType', documentType)
    if (reportingPeriodEnd) {
      formData.append('reportingPeriodEnd', new Date(reportingPeriodEnd).toISOString())
    }
    try {
      const res = await fetch('/api/documents/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) return { file, status: 'error', error: data.error ?? 'Upload failed.' }
      return { file, status: 'ready', documentId: data.documentId }
    } catch {
      return { file, status: 'error', error: 'Network error.' }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (files.length === 0 || !documentType) return

    setError(null)
    setUploading(true)
    setQueue(files.map((file) => ({ file, status: 'queued' })))

    const results: QueueItem[] = []
    for (let i = 0; i < files.length; i++) {
      setQueue((prev) => prev.map((q, idx) => (idx === i ? { ...q, status: 'uploading' } : q)))
      const result = await uploadOne(files[i])
      results.push(result)
      setQueue((prev) => prev.map((q, idx) => (idx === i ? result : q)))
    }

    setUploading(false)

    // Single successful file: jump straight to its review (unchanged behaviour).
    const successes = results.filter((r) => r.status === 'ready')
    if (results.length === 1 && successes.length === 1) {
      router.push(`/upload/${successes[0].documentId}/review`)
    }
  }

  const labelStyle = {
    display: 'block',
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    color: colours.textSecondary,
    letterSpacing: typography.tracking.wider,
    textTransform: 'uppercase' as const,
    marginBottom: '6px',
  }

  const inputStyle = {
    width: '100%',
    padding: '10px 12px',
    fontSize: typography.sizes.base,
    fontWeight: typography.weights.light,
    color: colours.textPrimary,
    backgroundColor: colours.surface,
    border: `1px solid ${colours.border}`,
    borderRadius: '4px',
    outline: 'none',
    boxSizing: 'border-box' as const,
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: spacing[3] }}>

      {/* Two-column area */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing[3], alignItems: 'stretch' }}>

        {/* Left: drop zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? colours.navy : colours.border}`,
            borderRadius: '8px',
            padding: spacing[4],
            textAlign: 'center',
            cursor: 'pointer',
            backgroundColor: dragging ? colours.background : colours.surface,
            transition: 'border-color 0.15s, background-color 0.15s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            multiple
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />

          {files.length > 0 ? (
            <div>
              <p style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0 }}>
                {files.length === 1 ? files[0].name : `${files.length} files selected`}
              </p>
              <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: `${spacing[1]} 0 0` }}>
                Click to add more · up to {MAX_BATCH}
              </p>
            </div>
          ) : (
            <div>
              <p style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.medium, color: colours.textSecondary, margin: 0 }}>
                Drop files here, or click to browse
              </p>
              <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary, margin: `${spacing[1]} 0 0` }}>
                PDF, JPEG, or PNG · upload several at once
              </p>
            </div>
          )}
        </div>

        {/* Right: document type + period + button */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing[3] }}>
          <div>
            <label htmlFor="documentType" style={labelStyle}>
              Document type
            </label>
            <select
              id="documentType"
              value={documentType}
              onChange={e => setDocumentType(e.target.value)}
              required
              style={inputStyle}
            >
              <option value="">Select document type…</option>
              {DOCUMENT_TYPES.map(dt => (
                <option key={dt.value} value={dt.value}>
                  {dt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="reportingPeriodEnd" style={labelStyle}>
              Reporting period end
              <span style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, marginLeft: '6px', textTransform: 'none', letterSpacing: 0 }}>
                (optional)
              </span>
            </label>
            <input
              id="reportingPeriodEnd"
              type="date"
              value={reportingPeriodEnd}
              onChange={e => setReportingPeriodEnd(e.target.value)}
              style={inputStyle}
            />
            <p style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.light, color: colours.textTertiary, margin: '6px 0 0' }}>
              Used for certificate expiry checks.
            </p>
          </div>

          {/* Error */}
          {error && (
            <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.red, backgroundColor: colours.redBg, padding: '10px 12px', borderRadius: '4px', margin: 0 }}>
              {error}
            </p>
          )}

          {/* Submit - centred in right column */}
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'auto' }}>
            <button
              type="submit"
              disabled={files.length === 0 || !documentType || uploading}
              style={{
                padding: '12px 28px',
                backgroundColor: files.length === 0 || !documentType || uploading ? colours.textTertiary : colours.navy,
                color: colours.surface,
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.medium,
                border: 'none',
                borderRadius: '4px',
                cursor: files.length === 0 || !documentType || uploading ? 'not-allowed' : 'pointer',
                letterSpacing: typography.tracking.wide,
              }}
            >
              {uploading ? 'Uploading…' : files.length > 1 ? `Upload ${files.length} and extract` : 'Upload and extract'}
            </button>
          </div>
        </div>
      </div>

      {/* Gap 8.1 - upload queue with per-file status */}
      {queue.length > 0 && (
        <div style={{ border: `1px solid ${colours.border}`, borderRadius: '8px', overflow: 'hidden' }}>
          {queue.map((item, i) => {
            const statusLabel =
              item.status === 'queued' ? 'Queued'
              : item.status === 'uploading' ? 'Reading…'
              : item.status === 'ready' ? 'Ready'
              : 'Failed'
            const statusColour =
              item.status === 'ready' ? colours.green
              : item.status === 'error' ? colours.red
              : item.status === 'uploading' ? colours.navy
              : colours.textTertiary
            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px 14px',
                  borderBottom: i < queue.length - 1 ? `1px solid ${colours.border}` : 'none',
                }}
              >
                <span style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, maxWidth: '60%' }}>
                  {item.file.name}
                </span>
                <span style={{ display: 'flex', gap: spacing[2], alignItems: 'center' }}>
                  {item.status === 'ready' && item.documentId && (
                    <a href={`/upload/${item.documentId}/review`} style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: colours.navy, textDecoration: 'none' }}>
                      Review →
                    </a>
                  )}
                  <span style={{ fontSize: typography.sizes.xs, fontWeight: typography.weights.medium, color: statusColour, letterSpacing: typography.tracking.wide }}>
                    {statusLabel}
                  </span>
                </span>
              </div>
            )
          })}
        </div>
      )}
    </form>
  )
}
