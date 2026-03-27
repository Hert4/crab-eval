import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const RESULTS_DIR = path.resolve(process.cwd(), 'results')

function safeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_\-\.]/g, '_').replace(/_+/g, '_').slice(0, 80)
}

export async function POST(req: Request) {
  try {
    const result = await req.json()
    if (!result?.simId || !result?.targetModel) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    const modelDir = path.join(RESULTS_DIR, safeName(result.targetModel))
    fs.mkdirSync(modelDir, { recursive: true })

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const shortId = (result.simId as string).slice(0, 8)
    const filename = `visual_${safeName(result.scenarioName)}_${dateStr}_${shortId}.json`
    const filepath = path.join(modelDir, filename)

    fs.writeFileSync(filepath, JSON.stringify(result, null, 2), 'utf-8')

    return NextResponse.json({ ok: true, path: filepath })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
