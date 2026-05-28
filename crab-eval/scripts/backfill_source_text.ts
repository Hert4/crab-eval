// One-time migration: populate `metadata.source_text` for translation datasets.
// Reads each dataset, extracts the embedded JSON from `record.input` using the
// same logic as evalRunner.ts, and writes it back into `record.metadata.source_text`.
// After running this, the runtime fast-path in evalRunner.ts (read source_text
// from metadata) actually engages instead of always falling back to extraction.

import fs from 'fs'
import path from 'path'

function extractJsonFromText(text: string): string {
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '{' && text[start] !== '[') continue

    const stack: string[] = []
    let inString = false
    let escaped = false

    for (let i = start; i < text.length; i++) {
      const char = text[i]

      if (escaped) {
        escaped = false
        continue
      }

      if (char === '\\') {
        escaped = true
        continue
      }

      if (char === '"') {
        inString = !inString
        continue
      }

      if (inString) continue

      if (char === '{' || char === '[') {
        stack.push(char)
      } else if (char === '}' || char === ']') {
        const last = stack.pop()

        if (
          (char === '}' && last !== '{') ||
          (char === ']' && last !== '[')
        ) {
          break
        }

        if (stack.length === 0) {
          const candidate = text.slice(start, i + 1)

          try {
            JSON.parse(candidate)
            return candidate
          } catch {
            break
          }
        }
      }
    }
  }

  return text
}

const FILES = [
  'datasets/mtrans_translation_85.json',
  'datasets/mtrans_translation_150.json',
]

let totalUpdated = 0
let totalSkipped = 0
let totalFailed = 0

for (const file of FILES) {
  const abs = path.resolve(file)
  const ds = JSON.parse(fs.readFileSync(abs, 'utf8'))

  let updated = 0
  let skipped = 0
  let failed = 0

  for (const r of ds.data) {
    if (typeof r.metadata?.source_text === 'string' && r.metadata.source_text.trim() !== '') {
      skipped++
      continue
    }

    const extracted = extractJsonFromText(r.input)

    // extractJsonFromText returns the original text on failure — detect that.
    if (extracted === r.input) {
      console.warn(`  [warn] ${file} record ${r.id}: no JSON found in input`)
      failed++
      continue
    }

    try {
      JSON.parse(extracted)
    } catch {
      console.warn(`  [warn] ${file} record ${r.id}: extracted candidate not valid JSON`)
      failed++
      continue
    }

    r.metadata = r.metadata ?? {}
    r.metadata.source_text = extracted
    updated++
  }

  fs.writeFileSync(abs, JSON.stringify(ds, null, 2) + '\n')
  console.log(`${file}: ${updated} updated, ${skipped} skipped, ${failed} failed`)

  totalUpdated += updated
  totalSkipped += skipped
  totalFailed += failed
}

console.log(`\nTotal: ${totalUpdated} updated, ${totalSkipped} skipped, ${totalFailed} failed`)

if (totalFailed > 0) {
  process.exit(1)
}
