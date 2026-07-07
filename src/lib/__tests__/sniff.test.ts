import { sniffFileType, extensionForType } from '@/lib/upload/sniff'

const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

describe('sniffFileType', () => {
  it('detects PDF, PNG, JPEG from magic bytes', () => {
    expect(sniffFileType(pdf)).toBe('application/pdf')
    expect(sniffFileType(png)).toBe('image/png')
    expect(sniffFileType(jpeg)).toBe('image/jpeg')
  })

  it('rejects a spoofed file (e.g. a script claiming to be PNG)', () => {
    const html = new Uint8Array([0x3c, 0x21, 0x44, 0x4f, 0x43]) // <!DOC
    expect(sniffFileType(html)).toBeNull()
  })

  it('rejects a truncated header', () => {
    expect(sniffFileType(new Uint8Array([0xff, 0xd8]))).toBeNull()
    expect(sniffFileType(new Uint8Array([]))).toBeNull()
  })

  it('maps types to extensions', () => {
    expect(extensionForType('application/pdf')).toBe('pdf')
    expect(extensionForType('image/jpeg')).toBe('jpg')
    expect(extensionForType('image/png')).toBe('png')
  })
})
