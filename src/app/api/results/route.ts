import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

// results/ lives next to datasets/, 2 levels up from eval-framework/
const RESULTS_DIR = path.resolve(process.cwd(), '..', 'results')

// Sanitise a string for use as a folder/file name
function safeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_\-\.]/g, '_').replace(/_+/g, '_').slice(0, 120)
}

// ── GET /api/results ─────────────────────────────────────────────────
// Returns all saved runs: { runs: RunResult[] }
export async function GET() {
  try {
    if (!fs.existsSync(RESULTS_DIR)) {
      return NextResponse.json({ runs: [], dir: RESULTS_DIR })
    }

    const runs: unknown[] = []
    const errors: string[] = []

    // results/<model_name>/<task_name>.json
    const modelDirs = fs.readdirSync(RESULTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())

    for (const modelDir of modelDirs) {
      const modelPath = path.join(RESULTS_DIR, modelDir.name)
      const files = fs.readdirSync(modelPath).filter(f => f.endsWith('.json'))

      for (const file of files) {
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(modelPath, file), 'utf-8'))
          runs.push(raw)
        } catch (e) {
          errors.push(`${modelDir.name}/${file}: ${e}`)
        }
      }
    }

    return NextResponse.json({ runs, errors, dir: RESULTS_DIR })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// ── POST /api/results ────────────────────────────────────────────────
// Body: RunResult (one complete run)
// Saves results/<model_name>/<task_name>.json for each task
// Also saves results/<model_name>/_run_<runId>.json as full run summary
export async function POST(req: Request) {
  try {
    const run = await req.json()

    if (!run?.runId || !run?.model || !run?.tasks) {
      return NextResponse.json({ error: 'Invalid RunResult payload' }, { status: 400 })
    }

    const modelDir = path.join(RESULTS_DIR, safeName(run.model))
    fs.mkdirSync(modelDir, { recursive: true })

    const saved: string[] = []

    // Save per-task detail files (with full logs if available)
    if (run.taskDetails) {
      for (const [taskName, detail] of Object.entries(run.taskDetails)) {
        const filename = `${safeName(taskName)}.json`
        const filepath = path.join(modelDir, filename)
        fs.writeFileSync(filepath, JSON.stringify({
          runId: run.runId,
          model: run.model,
          baseUrl: run.baseUrl,
          date: run.date,
          taskName,
          ...(detail as object),
        }, null, 2), 'utf-8')
        saved.push(`${run.model}/${filename}`)
      }
    }

    // Save run summary (scores only, no logs) — used for leaderboard reload
    const summaryName = `_run_${safeName(run.runId)}.json`
    const summaryPath = path.join(modelDir, summaryName)
    fs.writeFileSync(summaryPath, JSON.stringify({
      runId: run.runId,
      model: run.model,
      baseUrl: run.baseUrl,
      date: run.date,
      durationMs: run.durationMs,
      tasks: run.tasks,
    }, null, 2), 'utf-8')
    saved.push(`${run.model}/${summaryName}`)

    return NextResponse.json({ ok: true, saved, dir: modelDir })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
