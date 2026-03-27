import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

// Resolve the datasets folder — lives inside the repo at crab-eval/datasets/
const DATASETS_DIR = path.resolve(process.cwd(), 'datasets')

export async function GET() {
  try {
    if (!fs.existsSync(DATASETS_DIR)) {
      return NextResponse.json({ error: `datasets/ folder not found at ${DATASETS_DIR}` }, { status: 404 })
    }

    const files = fs.readdirSync(DATASETS_DIR).filter(f => f.endsWith('.json'))

    const datasets = []
    const errors: string[] = []

    for (const filename of files) {
      try {
        const filepath = path.join(DATASETS_DIR, filename)
        const raw = JSON.parse(fs.readFileSync(filepath, 'utf-8'))

        if (!raw.metadata || !Array.isArray(raw.data)) {
          errors.push(`${filename}: invalid schema (missing metadata or data)`)
          continue
        }

        datasets.push({
          filename,
          metadata: raw.metadata,
          data: raw.data,
        })
      } catch (e) {
        errors.push(`${filename}: ${e}`)
      }
    }

    return NextResponse.json({ datasets, errors, dir: DATASETS_DIR })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
