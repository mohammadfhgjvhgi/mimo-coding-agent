// MiMo AI — Text Chunking
// Splits long text into overlapping chunks, preferring paragraph / sentence
// boundaries so we don't break semantic units. Default: 512 chars, 50 overlap.


export interface ChunkOptions {
  chunkSize?: number
  overlap?: number
  // Hard minimum for the final chunk — if the trailing fragment is shorter
  // than this we merge it back into the previous chunk instead of emitting a
  // tiny orphan.
  minChunkSize?: number
}

const DEFAULT_CHUNK_SIZE = 512
const DEFAULT_OVERLAP = 50
const DEFAULT_MIN = 120

// Sentence-ish splitter. We try (in order): blank-line paragraph breaks,
// single newlines, sentence terminators (. ! ?), and finally a hard word cut.
const SPLIT_PRIORITY = [/\n\s*\n/, /\n/, /(?<=[.!?])\s+/, /\s+/]

/**
 * Greedy boundary-aware chunker.
 *
 * Walks the text accumulating segments until we cross `chunkSize`, then backs
 * off to the last boundary inside the window. Overlap is achieved by starting
 * the next window `overlap` characters before the end of the current one.
 */
export function chunkText(text: string, options?: ChunkOptions): string[] {
  const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE
  const overlap = options?.overlap ?? DEFAULT_OVERLAP
  const minChunkSize = options?.minChunkSize ?? DEFAULT_MIN

  const clean = text.replace(/\r\n/g, '\n').trim()
  if (!clean) return []
  if (clean.length <= chunkSize) return [clean]

  const chunks: string[] = []
  let cursor = 0

  while (cursor < clean.length) {
    const end = Math.min(cursor + chunkSize, clean.length)
    // If we're at the tail and what's left is smaller than minChunkSize,
    // just merge it into the previous chunk.
    if (end - cursor < minChunkSize && chunks.length > 0) {
      const prev = chunks[chunks.length - 1]
      const tail = clean.slice(cursor, end).trim()
      if (tail) chunks[chunks.length - 1] = `${prev}\n${tail}`.trim()
      break
    }

    // Find a boundary inside [cursor, end]. If end is already the document
    // end, just take it.
    let cut = end
    if (end < clean.length) {
      const window = clean.slice(cursor, end)
      let found = -1
      for (const re of SPLIT_PRIORITY) {
        // Search from the right of the window
        const matches = [...window.matchAll(new RegExp(re.source, 'g'))]
        if (matches.length === 0) continue
        const last = matches[matches.length - 1]
        // Position of the boundary start inside the window.
        const pos = last.index ?? 0
        if (pos + cursor - cursor >= minChunkSize) {
          found = pos
          break
        }
      }
      if (found >= 0) {
        cut = cursor + found
      }
      // else: no boundary found — fall back to hard cut at `end`.
    }

    const chunk = clean.slice(cursor, cut).trim()
    if (chunk) chunks.push(chunk)

    // Advance with overlap. Guard against zero progress.
    const next = cut - overlap
    if (next <= cursor) {
      cursor = cut
    } else {
      cursor = next
    }
  }

  return chunks
}

export default chunkText
