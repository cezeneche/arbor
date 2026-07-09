// Validation for email-inbound attachments. Unlike the browser upload path, the
// email provider's declared contentType is fully attacker-controlled, so we sniff
// the magic bytes (same as normal uploads) and enforce size + count limits before
// anything is stored or processed. This is the only gate on the inbound path.
import { sniffFileType, type SniffedType } from '@/lib/upload/sniff'

export interface RawInboundAttachment {
  name: string
  contentType: string
  contentBase64: string
}

export interface AcceptedAttachment {
  name: string
  type: SniffedType
  bytes: Buffer
}

export interface InboundAttachmentLimits {
  maxCount: number
  maxBytes: number
}

/**
 * Decode, sniff, and size-check inbound attachments, returning only the ones that
 * are a genuine PDF/JPEG/PNG within limits. Stops once `maxCount` are accepted so a
 * flood of attachments can't fan out into unbounded storage/extraction work.
 */
export function selectInboundAttachments(
  attachments: RawInboundAttachment[],
  { maxCount, maxBytes }: InboundAttachmentLimits,
): AcceptedAttachment[] {
  const accepted: AcceptedAttachment[] = []
  for (const att of attachments) {
    if (accepted.length >= maxCount) break

    let bytes: Buffer
    try {
      bytes = Buffer.from(att.contentBase64 ?? '', 'base64')
    } catch {
      continue
    }
    if (bytes.length === 0 || bytes.length > maxBytes) continue

    const type = sniffFileType(bytes.subarray(0, 16))
    if (!type) continue

    accepted.push({ name: att.name, type, bytes })
  }
  return accepted
}
