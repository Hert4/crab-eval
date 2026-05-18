import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { assertLocalRequest } from '@/lib/serverGuard'

// results/ lives inside the repo at crab-eval/results/
const RESULTS_DIR = path.resolve(process.cwd(), 'results')

// Sanitise a string for use as a folder/file name
function safeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_\-\.]/g, '_').replace(/_+/g, '_').slice(0, 120)
}

// Parse a file into a RunResult-shaped object, or null if unrecognised
function parseFile(filepath: string): Record<string, unknown> | null {
  try {
    const raw = JSON.parse(fs.readFileSync(filepath, 'utf-8')) as Record<string, unknown>
    if (raw.runId && raw.tasks) return raw
    return null
  } catch {
    return null
  }
}

// ── GET /api/results ─────────────────────────────────────────────────
// Returns all recognised runs from results/, newest first.
export async function GET() {
  try {
    if (!fs.existsSync(RESULTS_DIR)) {
      return NextResponse.json({ runs: [], dir: RESULTS_DIR })
    }

    const runs: Record<string, unknown>[] = []
    const seenRunIds = new Set<string>()
    const errors: string[] = []

    const modelDirs = fs.readdirSync(RESULTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())

    for (const modelDir of modelDirs) {
      const modelPath = path.join(RESULTS_DIR, modelDir.name)
      const files = fs.readdirSync(modelPath).filter(f => f.endsWith('.json'))

      for (const file of files) {
        const run = parseFile(path.join(modelPath, file))
        if (!run) continue

        const runId = typeof run.runId === 'string' ? run.runId : `${modelDir.name}:${file}`
        if (seenRunIds.has(runId)) continue
        seenRunIds.add(runId)
        runs.push(run)
      }
    }

    runs.sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))

    return NextResponse.json({
      runs,
      errors,
      dir: RESULTS_DIR,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// ── POST /api/results ────────────────────────────────────────────────
// Body: RunResult (one complete run)
// Saves per-task detail files at results/<model>/<task>.<runId>.json so
// reruns of the same task on the same model never overwrite each other.
// Also saves results/<model>/_run_<runId>.json as a summary (scores only).
export async function POST(req: Request) {
  const guard = assertLocalRequest(req)
  if (guard) return guard

  try {
    const run = await req.json()

    if (!run?.runId || !run?.model || !run?.tasks) {
      return NextResponse.json({ error: 'Invalid RunResult payload' }, { status: 400 })
    }

    const modelDir = path.join(RESULTS_DIR, safeName(run.model))
    fs.mkdirSync(modelDir, { recursive: true })

    const saved: string[] = []
    const runIdSafe = safeName(run.runId)

    // Save per-task detail files (with full logs if available).
    // Filename includes runId so rerunning the same task on the same model
    // accumulates history instead of overwriting.
    if (run.taskDetails) {
      for (const [taskName, detail] of Object.entries(run.taskDetails)) {
        const filename = `${safeName(taskName)}.${runIdSafe}.json`
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
    const summaryName = `_run_${runIdSafe}.json`
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

// ── DELETE /api/results ──────────────────────────────────────────────
// Body: { runId: string } — deletes a single result file by runId
//       { model: string } — deletes all files for a model folder
//       { all: true }     — wipes entire results/ directory
export async function DELETE(req: Request) {
  const guard = assertLocalRequest(req)
  if (guard) return guard

  try {
    const body = await req.json() as { runId?: string; model?: string; all?: boolean }

    if (body.all) {
      if (fs.existsSync(RESULTS_DIR)) fs.rmSync(RESULTS_DIR, { recursive: true, force: true })
      return NextResponse.json({ ok: true, deleted: 'all' })
    }

    if (body.model) {
      const modelDir = path.join(RESULTS_DIR, safeName(body.model))
      if (fs.existsSync(modelDir)) fs.rmSync(modelDir, { recursive: true, force: true })
      return NextResponse.json({ ok: true, deleted: body.model })
    }

    if (body.runId) {
      // Search all model dirs for files matching runId.
      if (!fs.existsSync(RESULTS_DIR)) return NextResponse.json({ ok: true, deleted: 0 })
      let deleted = 0
      for (const modelDir of fs.readdirSync(RESULTS_DIR, { withFileTypes: true }).filter(d => d.isDirectory())) {
        const dirPath = path.join(RESULTS_DIR, modelDir.name)
        for (const file of fs.readdirSync(dirPath).filter(f => f.endsWith('.json'))) {
          const filepath = path.join(dirPath, file)
          try {
            const raw = JSON.parse(fs.readFileSync(filepath, 'utf-8')) as Record<string, unknown>
            if (raw.runId === body.runId) {
              fs.unlinkSync(filepath)
              deleted++
            }
          } catch { /* skip unreadable files */ }
        }
      }
      return NextResponse.json({ ok: true, deleted })
    }

    return NextResponse.json({ error: 'Provide runId, model, or all:true' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
