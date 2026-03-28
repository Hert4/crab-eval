/**
 * Simple deterministic string hash (djb2 algorithm).
 * No crypto dependency — pure JS, synchronous, works in browser + Node.
 */
export function simpleHash(input: string): string {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash) ^ input.charCodeAt(i)
    hash |= 0  // Convert to 32-bit int
  }
  return Math.abs(hash).toString(36)
}
