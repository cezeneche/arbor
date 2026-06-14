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

export function UploadZone() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [documentType, setDocumentType] = useState('')
  const [reportingPeriodEnd, setReportingPeriodEnd] = useState('')
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    const dropped = e.dataTransfer.files[0]
    if (dropped) setFile(dropped)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0]
    if (selected) setFile(selected)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file || !documentType) return

    setError(null)
    setUploading(true)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('documentType', documentType)
    if (reportingPeriodEnd) {
      formData.append('reportingPeriodEnd', new Date(reportingPeriodEnd).toISOString())
    }

    try {
      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Upload failed.')
        setUploading(false)
        return
      }

      router.push(`/upload/${data.documentId}/review`)
    } catch {
      setError('Upload failed. Check your connection and try again.')
      setUploading(false)
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
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />

          {file ? (
            <div>
              <p style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.medium, color: colours.textPrimary, margin: 0 }}>
                {file.name}
              </p>
              <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textSecondary, margin: `${spacing[1]} 0 0` }}>
                {(file.size / 1024 / 1024).toFixed(2)} MB · Click to change
              </p>
            </div>
          ) : (
            <div>
              <p style={{ fontSize: typography.sizes.base, fontWeight: typography.weights.medium, color: colours.textSecondary, margin: 0 }}>
                Drop a file here, or click to browse
              </p>
              <p style={{ fontSize: typography.sizes.sm, fontWeight: typography.weights.light, color: colours.textTertiary, margin: `${spacing[1]} 0 0` }}>
                PDF, JPEG, or PNG
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

          {/* Submit — centred in right column */}
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'auto' }}>
            <button
              type="submit"
              disabled={!file || !documentType || uploading}
              style={{
                padding: '12px 28px',
                backgroundColor: !file || !documentType || uploading ? colours.textTertiary : colours.navy,
                color: colours.surface,
                fontSize: typography.sizes.sm,
                fontWeight: typography.weights.medium,
                border: 'none',
                borderRadius: '4px',
                cursor: !file || !documentType || uploading ? 'not-allowed' : 'pointer',
                letterSpacing: typography.tracking.wide,
              }}
            >
              {uploading ? 'Uploading…' : 'Upload and extract'}
            </button>
          </div>
        </div>
      </div>
    </form>
  )
}
