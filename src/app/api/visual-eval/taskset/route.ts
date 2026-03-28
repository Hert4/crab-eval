import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { FrozenTaskSet } from '@/types'

const TASKSET_DIR = path.resolve(process.cwd(), 'results', 'task-sets')

function ensureDir() {
  fs.mkdirSync(TASKSET_DIR, { recursive: true })
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const id = req.nextUrl.searchParams.get('id')
    ensureDir()

    if (id) {
      const filepath = path.join(TASKSET_DIR, `${id}.json`)
      if (!fs.existsSync(filepath)) {
        return NextResponse.json({ error: 'Task set not found' }, { status: 404 })
      }
      const data = fs.readFileSync(filepath, 'utf-8')
      return NextResponse.json(JSON.parse(data))
    }

    // List all task set IDs
    const files = fs.readdirSync(TASKSET_DIR).filter(f => f.endsWith('.json'))
    const taskSets = files.map(f => f.replace('.json', ''))
    return NextResponse.json({ taskSets })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const taskSet = (await req.json()) as FrozenTaskSet
    if (!taskSet?.taskSetId) {
      return NextResponse.json({ error: 'Invalid payload: missing taskSetId' }, { status: 400 })
    }
    ensureDir()
    const filename = `${taskSet.taskSetId}.json`
    fs.writeFileSync(
      path.join(TASKSET_DIR, filename),
      JSON.stringify(taskSet, null, 2),
      'utf-8'
    )
    return NextResponse.json({ saved: filename, taskSetId: taskSet.taskSetId })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
