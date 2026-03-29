import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const TASK_SPECS_DIR = path.resolve(process.cwd(), 'datasets', 'task-specs')

function ensureDir() {
  if (!fs.existsSync(TASK_SPECS_DIR)) {
    fs.mkdirSync(TASK_SPECS_DIR, { recursive: true })
  }
}

export async function GET() {
  try {
    ensureDir()

    const files = fs.readdirSync(TASK_SPECS_DIR).filter(f => f.endsWith('.json'))
    const taskSets = []
    const errors: string[] = []

    for (const filename of files) {
      try {
        const filepath = path.join(TASK_SPECS_DIR, filename)
        const raw = JSON.parse(fs.readFileSync(filepath, 'utf-8'))
        taskSets.push(raw)
      } catch (e) {
        errors.push(`${filename}: ${e}`)
      }
    }

    return NextResponse.json({ taskSets, errors, dir: TASK_SPECS_DIR })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    ensureDir()

    const body = await req.json()
    if (!body || !body.id) {
      return NextResponse.json({ error: 'Missing id in request body' }, { status: 400 })
    }

    const safeName = (body.name || 'task-set')
      .replace(/[^a-zA-Z0-9_\- ]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 40)

    const timestamp = Date.now()
    const filename = `${safeName}-${timestamp}.json`
    const filepath = path.join(TASK_SPECS_DIR, filename)

    fs.writeFileSync(filepath, JSON.stringify(body, null, 2), 'utf-8')

    return NextResponse.json({ success: true, filename, path: filepath })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
