import { selectInboundAttachments } from '@/lib/upload/inbound-attachments'

const b64 = (bytes: number[]) => Buffer.from(bytes).toString('base64')

// Real magic-byte headers padded with filler so they exceed the sniff window.
const PDF = b64([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
const PNG = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0])
const GARBAGE = b64([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f])

const opts = { maxCount: 10, maxBytes: 1000 }

describe('selectInboundAttachments', () => {
  it('accepts a file whose magic bytes match, regardless of declared contentType', () => {
    const out = selectInboundAttachments([{ name: 'a.pdf', contentType: 'application/octet-stream', contentBase64: PDF }], opts)
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('application/pdf')
  })

  it('rejects a file that lies about its content type (garbage bytes)', () => {
    const out = selectInboundAttachments([{ name: 'evil.pdf', contentType: 'application/pdf', contentBase64: GARBAGE }], opts)
    expect(out).toEqual([])
  })

  it('rejects an attachment larger than maxBytes', () => {
    const out = selectInboundAttachments([{ name: 'big.png', contentType: 'image/png', contentBase64: PNG }], { maxCount: 10, maxBytes: 4 })
    expect(out).toEqual([])
  })

  it('caps the number of accepted attachments at maxCount', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.pdf`, contentType: 'application/pdf', contentBase64: PDF }))
    const out = selectInboundAttachments(many, { maxCount: 2, maxBytes: 1000 })
    expect(out).toHaveLength(2)
  })

  it('skips empty / undecodable content', () => {
    const out = selectInboundAttachments([{ name: 'empty.pdf', contentType: 'application/pdf', contentBase64: '' }], opts)
    expect(out).toEqual([])
  })
})
