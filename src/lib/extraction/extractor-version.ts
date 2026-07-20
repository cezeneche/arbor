// Extractor version stamp (MLOps guardrail — Layer 1). Pure: no SDK, no DB.
//
// "Which extractor produced this record?" must be answerable, or a later
// accuracy regression cannot be attributed to the change that caused it — the
// silent-drift failure mode for an LLM (the provider updates the model under
// you, or a prompt edit ships, and nothing fails loudly). The answer is one
// deterministic string: the model id + the prompt version. It is stamped on
// every ExtractionJob and carried onto every GroundTruthLabel, so the accuracy
// monitor can slice correctness by the exact model/prompt that ran.
//
// Bump PROMPT_VERSION whenever the extraction prompt (EXTRACTION_SYSTEM_PROMPT or
// the per-document builders in ./prompts) changes in a way that could move
// extraction behaviour. Changing EXTRACTION_MODEL changes the stamp on its own.

/** The Anthropic model Layer 1 extraction runs against. Single source of truth. */
export const EXTRACTION_MODEL = 'claude-sonnet-4-6'

/** Monotonic tag for the extraction prompt. Bump on any material prompt change. */
export const PROMPT_VERSION = 'v1'

/** Deterministic "which extractor" identifier: model id + prompt version. */
export function composeExtractorVersion(model: string, promptVersion: string): string {
  return `${model}+${promptVersion}`
}

/** The live extractor stamp — what this build actually runs. */
export const EXTRACTOR_VERSION = composeExtractorVersion(EXTRACTION_MODEL, PROMPT_VERSION)
