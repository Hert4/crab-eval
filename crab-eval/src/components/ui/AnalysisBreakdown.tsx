'use client'
import { useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip, Cell,
} from 'recharts'
import { ChevronDown, ChevronRight, BarChart2 } from 'lucide-react'
import type { RunAnalysis, TaskAnalysis, MetricBreakdownBucket } from '@/types'

// ── Score color (same as leaderboard ScoreCell) ───────────────────────
function scoreColor(v: number): string {
  if (v >= 80) return '#8fba7a'
  if (v >= 60) return '#7dbfd4'
  if (v >= 40) return '#c96442'
  return '#f87171'
}

// ── Difficulty badge ──────────────────────────────────────────────────
const DIFF_CLS: Record<string, string> = {
  easy:   'bg-emerald-900/30 text-emerald-300 border-emerald-800/40',
  medium: 'bg-sky-900/30 text-sky-300 border-sky-800/40',
  hard:   'bg-orange-900/30 text-orange-300 border-orange-800/40',
  expert: 'bg-red-900/30 text-red-300 border-red-800/40',
}

// ── Intent badge ──────────────────────────────────────────────────────
const INTENT_CLS: Record<string, string> = {
  factoid:    'bg-sky-900/30 text-sky-300 border-sky-800/40',
  procedural: 'bg-purple-900/30 text-purple-300 border-purple-800/40',
  definition: 'bg-emerald-900/30 text-emerald-300 border-emerald-800/40',
  comparison: 'bg-orange-900/30 text-orange-300 border-orange-800/40',
}

const DEFAULT_BADGE = 'bg-[var(--crab-bg-tertiary)] text-[var(--crab-text-secondary)] border-[var(--crab-border-subtle)]'

function LabelBadge({ label, type }: { label: string; type: 'difficulty' | 'intent' | 'tag' }) {
  const cls =
    type === 'difficulty' ? (DIFF_CLS[label] ?? DEFAULT_BADGE) :
    type === 'intent'     ? (INTENT_CLS[label] ?? DEFAULT_BADGE) :
    DEFAULT_BADGE
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${cls}`}>
      {label}
    </span>
  )
}

// ── Mini bar chart for one metric ─────────────────────────────────────
function MetricBarChart({
  buckets,
  metric,
  labelType,
}: {
  buckets: MetricBreakdownBucket[]
  metric: string
  labelType: 'difficulty' | 'intent' | 'tag'
}) {
  const data = buckets.map(b => ({
    label: b.label,
    score: b.avgScores[metric] ?? 0,
    count: b.count,
  }))

  return (
    <div className="h-32">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(216,211,197,0.08)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 9, fill: 'var(--crab-text-muted)' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 9, fill: 'var(--crab-text-muted)' }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{ background: '#201f1e', border: '1px solid rgba(216,211,197,0.20)', borderRadius: 8, fontSize: 11 }}
            formatter={(value: unknown) => [
              typeof value === 'number' ? value.toFixed(1) + '%' : String(value),
              metric,
            ]}
          />
          <Bar dataKey="score" radius={[3, 3, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={scoreColor(d.score)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Breakdown section (one dimension) ────────────────────────────────
function BreakdownSection({
  title,
  buckets,
  primaryMetric,
  labelType,
  allMetrics,
}: {
  title: string
  buckets: MetricBreakdownBucket[]
  primaryMetric: string
  labelType: 'difficulty' | 'intent' | 'tag'
  allMetrics: string[]
}) {
  if (buckets.length === 0) {
    return (
      <div>
        <p className="text-[11px] font-semibold text-[var(--crab-text-muted)] mb-2">{title}</p>
        <p className="text-[10px] text-[var(--crab-text-muted)] italic py-2">
          No {labelType} metadata — re-run eval after updating to populate
        </p>
      </div>
    )
  }

  return (
    <div>
      <p className="text-[11px] font-semibold text-[var(--crab-text-secondary)] mb-3">{title}</p>
      <div className="grid grid-cols-[1fr_1fr] gap-4 mb-3">
        <MetricBarChart buckets={buckets} metric={primaryMetric} labelType={labelType} />
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="border-b border-[var(--crab-border-subtle)]">
                <th className="text-left py-1 pr-2 text-[var(--crab-text-muted)] font-medium">Label</th>
                <th className="text-right py-1 pr-2 text-[var(--crab-text-muted)] font-medium">N</th>
                {allMetrics.slice(0, 3).map(m => (
                  <th key={m} className="text-right py-1 pl-2 text-[var(--crab-text-muted)] font-medium">
                    {m.replace(/_/g, ' ').slice(0, 8)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {buckets.map(b => (
                <tr key={b.label} className="border-b border-[var(--crab-border-subtle)] last:border-0">
                  <td className="py-1.5 pr-2">
                    <LabelBadge label={b.label} type={labelType} />
                  </td>
                  <td className="text-right py-1.5 pr-2 text-[var(--crab-text-muted)] tabular-nums">
                    {b.count}
                  </td>
                  {allMetrics.slice(0, 3).map(m => {
                    const v = b.avgScores[m]
                    return (
                      <td key={m} className="text-right py-1.5 pl-2 font-mono tabular-nums font-semibold"
                        style={{ color: v != null ? scoreColor(v) : 'var(--crab-text-muted)' }}>
                        {v != null ? v.toFixed(1) + '%' : '—'}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Task analysis panel ───────────────────────────────────────────────
function TaskAnalysisPanel({ task }: { task: TaskAnalysis }) {
  const [open, setOpen] = useState(true)
  const primaryMetric = task.metrics[0] ?? 'token_f1'
  const hasAnyData = task.byDifficulty.length > 0 || task.byIntent.length > 0 || task.byTag.length > 0

  return (
    <div className="rounded-xl border border-[var(--crab-border)] bg-[var(--crab-bg-secondary)] overflow-hidden mb-4">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-[var(--crab-bg-hover)] transition-colors"
      >
        <div className="flex items-center gap-3">
          <BarChart2 size={14} className="text-[var(--crab-text-muted)]" />
          <span className="text-sm font-semibold text-[var(--crab-text)]">{task.taskName}</span>
          {task.taskType && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--crab-accent-light)] text-[var(--crab-accent)] border border-[var(--crab-accent-medium)]">
              {task.taskType}
            </span>
          )}
          <span className="text-xs text-[var(--crab-text-muted)]">{task.totalLogs} records</span>
        </div>
        {open ? <ChevronDown size={14} className="text-[var(--crab-text-muted)]" /> : <ChevronRight size={14} className="text-[var(--crab-text-muted)]" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-5 border-t border-[var(--crab-border-subtle)]">
          {!hasAnyData ? (
            <div className="py-6 text-center">
              <p className="text-sm text-[var(--crab-text-muted)]">No breakdown metadata available</p>
              <p className="text-xs text-[var(--crab-text-muted)] mt-1">
                This run was created before metadata propagation. Re-run the eval to populate breakdown data.
              </p>
            </div>
          ) : (
            <>
              <div className="pt-4">
                <BreakdownSection
                  title="By Difficulty"
                  buckets={task.byDifficulty}
                  primaryMetric={primaryMetric}
                  labelType="difficulty"
                  allMetrics={task.metrics}
                />
              </div>
              {task.byIntent.length > 0 && (
                <div className="pt-2 border-t border-[var(--crab-border-subtle)]">
                  <div className="pt-4">
                    <BreakdownSection
                      title="By Intent"
                      buckets={task.byIntent}
                      primaryMetric={primaryMetric}
                      labelType="intent"
                      allMetrics={task.metrics}
                    />
                  </div>
                </div>
              )}
              {task.byTag.length > 0 && (
                <div className="pt-2 border-t border-[var(--crab-border-subtle)]">
                  <div className="pt-4">
                    <BreakdownSection
                      title="By Tag"
                      buckets={task.byTag}
                      primaryMetric={primaryMetric}
                      labelType="tag"
                      allMetrics={task.metrics}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Root component ────────────────────────────────────────────────────
export function AnalysisBreakdown({ analysis }: { analysis: RunAnalysis }) {
  const dateStr = analysis.date
    ? new Date(analysis.date).toLocaleDateString('en-US', { dateStyle: 'medium' })
    : ''

  return (
    <div className="px-2 py-4">
      {/* Run info header */}
      <div className="rounded-xl border border-[var(--crab-border)] bg-[var(--crab-bg-secondary)] px-5 py-4 mb-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-[var(--crab-text-muted)] mb-1">Breakdown for run</p>
            <p className="text-sm font-semibold text-[var(--crab-text)]">{analysis.model}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-[var(--crab-text-muted)]">{dateStr}</p>
            <p className="text-xs text-[var(--crab-text-muted)] mt-0.5">
              {analysis.tasks.length} task{analysis.tasks.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Task panels */}
      {analysis.tasks.map(task => (
        <TaskAnalysisPanel key={task.taskName} task={task} />
      ))}
    </div>
  )
}
