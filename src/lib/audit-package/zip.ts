// Minimal ZIP writer. Pure: Buffers in, one Buffer out. No DB, no network, no
// dependency.
//
// An audit package has to carry the source documents a verifier needs (PRD
// §12.4), which means one container holding the JSON, a readable report, and the
// original files. That container is a ZIP.
//
// STORE (no compression) deliberately: the payload is PDFs and images, already
// compressed, so DEFLATE would buy nothing and cost a dependency plus CPU on
// every generation. Hand-rolled for the same reason — the format is small and
// fully specified, and a compliance product should not take a supply-chain
// dependency it does not need.
//
// Output is byte-for-byte reproducible for a given input and timestamp: an audit
// artefact that differs between runs cannot be checked by anyone.
//
// Deliberately not implemented: DEFLATE, ZIP64, encryption, archive comments.
// ZIP64 means archives are capped at 4 GB and 65,535 entries, which is far above
// any realistic package — buildZip throws rather than emitting a corrupt archive
// if that is ever exceeded.

const LOCAL_FILE_HEADER = 0x04034b50
const CENTRAL_FILE_HEADER = 0x02014b50
const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const VERSION = 20 // 2.0 — the minimum that supports STORE with directories
const METHOD_STORE = 0

const MAX_ENTRIES = 0xffff
const MAX_SIZE = 0xffffffff

export interface ZipEntry {
  /** Path inside the archive. Forward slashes; no leading slash. */
  path: string
  data: Buffer
}

// CRC-32 (IEEE 802.3, polynomial 0xEDB88320), computed via the standard table.
// The table is built once on first use rather than being a 256-entry literal.
let crcTable: Uint32Array | null = null
function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  crcTable = table
  return table
}

export function crc32(data: Buffer): number {
  const table = getCrcTable()
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** MS-DOS date/time, the only format the ZIP header carries. 2-second resolution. */
function dosDateTime(at: Date): { time: number; date: number } {
  const year = at.getUTCFullYear()
  // The DOS epoch is 1980; anything earlier cannot be represented.
  const dosYear = Math.max(0, year - 1980)
  const time =
    (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | Math.floor(at.getUTCSeconds() / 2)
  const date = (dosYear << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate()
  return { time, date }
}

/**
 * Build a ZIP archive. `modifiedAt` is applied to every entry so the output is
 * reproducible — pass a fixed instant (the package's generatedAt), never
 * `new Date()` per entry.
 */
export function buildZip(entries: ZipEntry[], modifiedAt: Date): Buffer {
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`ZIP supports at most ${MAX_ENTRIES} entries without ZIP64; got ${entries.length}.`)
  }

  const seen = new Set<string>()
  for (const e of entries) {
    if (seen.has(e.path)) {
      throw new Error(`Duplicate path in archive: ${e.path}. Refusing to write an ambiguous ZIP.`)
    }
    seen.add(e.path)
    if (e.data.length > MAX_SIZE) {
      throw new Error(`Entry ${e.path} exceeds the 4 GB ZIP64-free limit.`)
    }
  }

  const { time, date } = dosDateTime(modifiedAt)

  const localChunks: Buffer[] = []
  const centralChunks: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.path, 'utf8')
    const checksum = crc32(entry.data)
    const size = entry.data.length

    const local = Buffer.alloc(30)
    local.writeUInt32LE(LOCAL_FILE_HEADER, 0)
    local.writeUInt16LE(VERSION, 4)
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(METHOD_STORE, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(size, 18) // compressed == uncompressed under STORE
    local.writeUInt32LE(size, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28) // extra field length
    localChunks.push(local, nameBytes, entry.data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(CENTRAL_FILE_HEADER, 0)
    central.writeUInt16LE(VERSION, 4) // version made by
    central.writeUInt16LE(VERSION, 6) // version needed
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(METHOD_STORE, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(size, 20)
    central.writeUInt32LE(size, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk number start
    central.writeUInt16LE(0, 36) // internal attributes
    central.writeUInt32LE(0, 38) // external attributes
    central.writeUInt32LE(offset, 42) // offset of this entry's local header
    centralChunks.push(central, nameBytes)

    offset += local.length + nameBytes.length + entry.data.length
  }

  const centralDirectory = Buffer.concat(centralChunks)

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0)
  eocd.writeUInt16LE(0, 4) // this disk
  eocd.writeUInt16LE(0, 6) // disk with central directory
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralDirectory.length, 12)
  eocd.writeUInt32LE(offset, 16) // central directory starts after the last entry
  eocd.writeUInt16LE(0, 20) // no archive comment

  return Buffer.concat([...localChunks, centralDirectory, eocd])
}
