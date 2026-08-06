// A minimal ZIP writer, so an audit package can carry the source documents a
// verifier needs alongside the machine-verifiable JSON (PRD §12.4).
//
// STORE (no compression) on purpose: the payload is PDFs and JPEGs, which are
// already compressed, so DEFLATE would add a dependency and CPU for ~nothing.
// Hand-rolled rather than pulling a package in — the format is small and fully
// specified, and a compliance product should not take a supply-chain dependency
// it does not need. That trade only holds if the output is genuinely verified,
// so these tests assert the byte structure and a real `unzip` round-trip is run
// against the built output before shipping.

import { buildZip, crc32, type ZipEntry } from '../zip'

const FIXED = new Date('2026-08-06T10:30:00.000Z')

const LOCAL_HEADER = 0x04034b50
const CENTRAL_HEADER = 0x02014b50
const EOCD = 0x06054b50

describe('crc32', () => {
  it('matches the known CRC-32 of "123456789"', () => {
    // The standard check value for IEEE 802.3 CRC-32.
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
  })

  it('is 0 for empty input', () => {
    expect(crc32(Buffer.alloc(0))).toBe(0)
  })

  it('differs when a single byte changes', () => {
    expect(crc32(Buffer.from('hello'))).not.toBe(crc32(Buffer.from('hellp')))
  })
})

describe('buildZip', () => {
  const entries: ZipEntry[] = [
    { path: 'README.md', data: Buffer.from('# Audit package\n') },
    { path: 'package.json', data: Buffer.from('{"a":1}') },
    { path: 'documents/bill.pdf', data: Buffer.from('%PDF-1.4 fake') },
  ]

  it('starts with a local file header signature', () => {
    const zip = buildZip(entries, FIXED)
    expect(zip.readUInt32LE(0)).toBe(LOCAL_HEADER)
  })

  it('ends with an end-of-central-directory record naming every entry', () => {
    const zip = buildZip(entries, FIXED)
    const eocdOffset = zip.length - 22 // no archive comment
    expect(zip.readUInt32LE(eocdOffset)).toBe(EOCD)
    expect(zip.readUInt16LE(eocdOffset + 8)).toBe(3) // entries on this disk
    expect(zip.readUInt16LE(eocdOffset + 10)).toBe(3) // total entries
  })

  it('places the central directory where the EOCD says it does', () => {
    const zip = buildZip(entries, FIXED)
    const eocdOffset = zip.length - 22
    const cdSize = zip.readUInt32LE(eocdOffset + 12)
    const cdOffset = zip.readUInt32LE(eocdOffset + 16)

    expect(zip.readUInt32LE(cdOffset)).toBe(CENTRAL_HEADER)
    expect(cdOffset + cdSize).toBe(eocdOffset)
  })

  it('records STORE as the compression method', () => {
    const zip = buildZip(entries, FIXED)
    expect(zip.readUInt16LE(8)).toBe(0)
  })

  it('stores each entry uncompressed, so sizes match and the bytes are findable', () => {
    const zip = buildZip(entries, FIXED)
    expect(zip.readUInt32LE(18)).toBe(entries[0].data.length) // compressed size
    expect(zip.readUInt32LE(22)).toBe(entries[0].data.length) // uncompressed size
    expect(zip.includes(Buffer.from('# Audit package'))).toBe(true)
    expect(zip.includes(Buffer.from('%PDF-1.4 fake'))).toBe(true)
  })

  it('writes the CRC of the content into the local header', () => {
    const zip = buildZip(entries, FIXED)
    expect(zip.readUInt32LE(14)).toBe(crc32(entries[0].data))
  })

  it('keeps directory paths, so documents/ survives extraction', () => {
    const zip = buildZip(entries, FIXED)
    expect(zip.includes(Buffer.from('documents/bill.pdf'))).toBe(true)
  })

  it('is byte-for-byte reproducible for the same input and timestamp', () => {
    // An audit artefact that differs run to run cannot be checked by a verifier.
    expect(buildZip(entries, FIXED).equals(buildZip(entries, FIXED))).toBe(true)
  })

  it('produces a valid empty archive for no entries', () => {
    const zip = buildZip([], FIXED)
    expect(zip.length).toBe(22)
    expect(zip.readUInt32LE(0)).toBe(EOCD)
    expect(zip.readUInt16LE(10)).toBe(0)
  })

  it('handles binary content without corrupting it', () => {
    const binary = Buffer.from([0x00, 0xff, 0x50, 0x4b, 0x03, 0x04, 0x1a])
    const zip = buildZip([{ path: 'raw.bin', data: binary }], FIXED)
    // The payload contains a ZIP signature itself — the reader must rely on the
    // central directory, not on scanning, which is why offsets are written.
    expect(zip.includes(binary)).toBe(true)
    expect(zip.readUInt32LE(14)).toBe(crc32(binary))
  })

  it('rejects a duplicate path rather than writing an ambiguous archive', () => {
    expect(() =>
      buildZip(
        [
          { path: 'a.txt', data: Buffer.from('one') },
          { path: 'a.txt', data: Buffer.from('two') },
        ],
        FIXED,
      ),
    ).toThrow(/duplicate/i)
  })
})
