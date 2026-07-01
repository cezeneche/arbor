// Layer 1 — robust JSON extraction from an LLM response.
//
// The extraction prompts ask Claude for bare JSON, but models occasionally wrap
// the payload in a markdown ```json fence or add a sentence of preamble/trailer.
// A naive JSON.parse of the whole response then throws and a perfectly good
// extraction is lost. This isolates the JSON: prefer a fenced block, else parse
// as-is, else fall back to the outermost {...} / [...] span. Throws only when no
// parseable JSON is present.

export function parseLooseJson(text: string): unknown {
  const trimmed = text.trim()
  const candidates: string[] = []

  // 1. A fenced code block, if present (```json … ``` or ``` … ```).
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) candidates.push(fence[1].trim())

  // 2. The response as-is.
  candidates.push(trimmed)

  // 3. The outermost object / array span, to shed surrounding prose.
  const objectSpan = outermostSpan(trimmed, '{', '}')
  if (objectSpan) candidates.push(objectSpan)
  const arraySpan = outermostSpan(trimmed, '[', ']')
  if (arraySpan) candidates.push(arraySpan)

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      // try the next candidate
    }
  }
  throw new Error('could not parse JSON from response')
}

function outermostSpan(s: string, open: string, close: string): string | null {
  const start = s.indexOf(open)
  const end = s.lastIndexOf(close)
  return start !== -1 && end > start ? s.slice(start, end + 1) : null
}
