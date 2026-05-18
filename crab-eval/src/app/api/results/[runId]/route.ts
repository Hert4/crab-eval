import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import type { TaskAnalysis, MetricBreakdownBucket, RunAnalysis } from '@/types'

// results/ lives inside the repo at crab-eval/results/
const RESULTS_DIR = path.resolve(process.cwd(), 'results')

// Easy → hard ordering for difficulty buckets
const DIFF_ORDER = ['easy', 'medium', 'hard', 'expert']

type RawLog = {
  scores: Record<string, number>
  metadata?: Record<string, unknown>
  error?: string
}

function computeBuckets(logs: RawLog[], key: string): MetricBreakdownBucket[] {
  const buckets = new Map<string, { sums: Record<string, number>; count: number }>()

  for (const log of logs) {
    if (log.error) continue  // skip errored records — don't pollute scores
    const raw = log.metadata?.[key]
    // tags is string[] — explode into individual labels; others are single values
    const labels: string[] = Array.isArray(raw)
      ? (raw as string[]).map(String)
      : raw != null ? [String(raw)] : []
    if (labels.length === 0) continue

    for (const label of labels) {
      if (!buckets.has(label)) buckets.set(label, { sums: {}, count: 0 })
      const b = buckets.get(label)!
      b.count++
      for (const [m, s] of Object.entries(log.scores)) {
        b.sums[m] = (b.sums[m] ?? 0) + s
      }
    }
  }

  return [...buckets.entries()]
    .map(([label, { sums, count }]) => ({
      label,
      count,
      avgScores: Object.fromEntries(
        Object.entries(sums).map(([m, s]) => [m, parseFloat((s / count).toFixed(2))])
      ),
    }))
    .sort((a, b) => {
      // Sort difficulty in order; everything else by frequency
      const ai = DIFF_ORDER.indexOf(a.label)
      const bi = DIFF_ORDER.indexOf(b.label)
      if (ai !== -1 && bi !== -1) return ai - bi
      return b.count - a.count
    })
}

// ── GET /api/results/[runId] ─────────────────────────────────────────
// Reads per-task disk files for the given runId, computes breakdowns.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params

  if (!fs.existsSync(RESULTS_DIR)) {
    return NextResponse.json({ error: 'No results directory' }, { status: 404 })
  }

  let runModel = '', runDate = ''
  const taskAnalyses: TaskAnalysis[] = []

  for (const entry of fs.readdirSync(RESULTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const modelPath = path.join(RESULTS_DIR, entry.name)

    for (const file of fs.readdirSync(modelPath).filter(f => f.endsWith('.json'))) {
      // Skip run summary files (no logs inside)
      if (file.startsWith('_run_')) continue
      try {
        const raw = JSON.parse(
          fs.readFileSync(path.join(modelPath, file), 'utf-8')
        ) as Record<string, unknown>

        if (raw.runId !== runId) continue

        runModel = String(raw.model ?? '')
        runDate = String(raw.date ?? '')
        const logs = (raw.logs as RawLog[]) ?? []

        taskAnalyses.push({
          taskName: String(raw.taskName ?? file.replace('.json', '')),
          taskType: String(raw.taskType ?? ''),
          metrics: (raw.metrics as string[]) ?? [],
          totalLogs: logs.length,
          byDifficulty: computeBuckets(logs, 'difficulty'),
          byIntent: computeBuckets(logs, 'intent'),
          byTag: computeBuckets(logs, 'tags'),
        })
      } catch { /* skip unreadable / invalid files */ }
    }
  }

  if (taskAnalyses.length === 0) {
    return NextResponse.json(
      { error: `Run ${runId} not found on disk. The run may have been deleted or not yet persisted.` },
      { status: 404 }
    )
  }

  return NextResponse.json({
    runId,
    model: runModel,
    date: runDate,
    tasks: taskAnalyses,
  } satisfies RunAnalysis)
}
