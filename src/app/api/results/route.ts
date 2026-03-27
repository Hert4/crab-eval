import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

// results/ lives inside the repo at crab-eval/results/
const RESULTS_DIR = path.resolve(process.cwd(), 'results')

// Sanitise a string for use as a folder/file name
function safeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_\-\.]/g, '_').replace(/_+/g, '_').slice(0, 120)
}

// Convert a SimulationResult (visual eval) → RunResult shape for the leaderboard
function simResultToRunResult(sim: Record<string, unknown>) {
  if (sim.finalScore === null || sim.evaluationStatus === 'unavailable') return null

  const tasks = sim.tasks as Record<string, Record<string, number>> | undefined
  return {
    runId:      sim.simId,
    model:      sim.targetModel,
    baseUrl:    '',
    date:       sim.date,
    durationMs: sim.durationMs ?? 0,
    tasks:      tasks ?? {
      [sim.scenarioName as string]: { overall: sim.finalScore ?? 0 },
    },
  }
}

// Parse a file into a RunResult-shaped object, or null if unrecognised
function parseFile(filepath: string): Record<string, unknown> | null {
  try {
    const raw = JSON.parse(fs.readFileSync(filepath, 'utf-8')) as Record<string, unknown>
    if (raw.runId && raw.tasks) return raw                       // RunResult (eval runner)
    if (raw.simId && raw.targetModel) return simResultToRunResult(raw)  // SimulationResult (visual eval)
    return null
  } catch {
    return null
  }
}

// ── GET /api/results ─────────────────────────────────────────────────
// Returns the LATEST run per model (by date field) from each model folder.
export async function GET() {
  try {
    if (!fs.existsSync(RESULTS_DIR)) {
      return NextResponse.json({ runs: [], dir: RESULTS_DIR })
    }

    // model name → latest parsed run
    const latestByModel = new Map<string, Record<string, unknown>>()
    const errors: string[] = []

    const modelDirs = fs.readdirSync(RESULTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())

    for (const modelDir of modelDirs) {
      const modelPath = path.join(RESULTS_DIR, modelDir.name)
      const files = fs.readdirSync(modelPath).filter(f => f.endsWith('.json'))

      for (const file of files) {
        const run = parseFile(path.join(modelPath, file))
        if (!run) continue

        const model = (run.model as string) || modelDir.name
        const existing = latestByModel.get(model)

        // Keep whichever run has the later date string (ISO-comparable)
        if (!existing || String(run.date) > String(existing.date)) {
          latestByModel.set(model, run)
        }
      }
    }

    return NextResponse.json({
      runs: [...latestByModel.values()],
      errors,
      dir: RESULTS_DIR,
    })
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
