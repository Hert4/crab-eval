'use client'
import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, X } from 'lucide-react'
import type { RecordLog } from '@/types'

interface FailurePattern {
  id: string
  label: string
  description: string
  color: string
  count: number
  avgScore: number
  recordIds: Set<string>
}

interface Props {
  logs: RecordLog[]
  highlightedPatternId: string | null
  onHighlight: (ids: Set<string> | null, patternId: string | null) => void
}

function avgOfScores(scores: Record<string, number>): number {
  const vals = Object.values(scores).filter(v => typeof v === 'number')
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
}

function computePatterns(logs: RecordLog[]): FailurePattern[] {
  const doneLogs = logs.filter(l => l.status === 'done' || l.status === 'error')
  if (doneLogs.length === 0) return []

  const defs: Array<{
    id: string
    label: string
    description: string
    color: string
    match: (l: RecordLog) => boolean
  }> = [
    {
      id: 'errors',
      label: 'API / Runtime Errors',
      description: 'Records that failed with an error during inference',
      color: '#f87171',
      match: l => l.error != null,
    },
    {
      id: 'low_overall',
      label: 'Low Overall Score',
      description: 'Records where average metric score < 50%',
      color: '#fbbf24',
      match: l => l.status === 'done' && avgOfScores(l.scores) < 50,
    },
    {
      id: 'tool_fail',
      label: 'Tool Call Failures',
      description: 'Records where tool-calling metrics scored < 50%',
      color: '#fb923c',
      match: l => {
        if (l.status !== 'done') return false
        const toolMetrics = ['tool_call_exact', 'ast_accuracy', 'task_success_rate']
        const relevant = toolMetrics.filter(m => m in l.scores)
        if (relevant.length === 0) return false
        return relevant.some(m => l.scores[m] < 50)
      },
    },
    {
      id: 'low_faith',
      label: 'Low Faithfulness',
      description: 'Records where faithfulness or relevancy scored < 50%',
      color: '#c084fc',
      match: l => {
        if (l.status !== 'done') return false
        const faithMetrics = ['faithfulness', 'answer_relevancy']
        const relevant = faithMetrics.filter(m => m in l.scores)
        if (relevant.length === 0) return false
        return relevant.some(m => l.scores[m] < 50)
      },
    },
    {
      id: 'low_criteria',
      label: 'Failed Criteria',
      description: 'Records where criteria / instruction adherence scored < 50%',
      color: '#f472b6',
      match: l => {
        if (l.status !== 'done') return false
        const criteriaMetrics = ['criteria_score', 'instruction_adherence', 'refusal_accuracy']
        const relevant = criteriaMetrics.filter(m => m in l.scores)
        if (relevant.length === 0) return false
        return relevant.some(m => l.scores[m] < 50)
      },
    },
  ]

  return defs
    .map(def => {
      const matched = doneLogs.filter(def.match)
      const recordIds = new Set(matched.map(l => l.id))
      const avgScore = matched.length
        ? matched.reduce((s, l) => s + avgOfScores(l.scores), 0) / matched.length
        : 0
      return { ...def, count: matched.length, avgScore, recordIds }
    })
    .filter(p => p.count > 0)
}

// ── Main component ────────────────────────────────────────────────────
export function FailurePatternsPanel({ logs, highlightedPatternId, onHighlight }: Props) {
  const [open, setOpen] = useState(true)
  const patterns = useMemo(() => computePatterns(logs), [logs])

  if (patterns.length === 0) return null

  const totalAffected = new Set(patterns.flatMap(p => [...p.recordIds])).size

  const handleCardClick = (pattern: FailurePattern) => {
    if (highlightedPatternId === pattern.id) {
      // Toggle off
      onHighlight(null, null)
    } else {
      onHighlight(pattern.recordIds, pattern.id)
    }
  }

  return (
    <div className="shrink-0 border-t border-[var(--crab-border)] bg-[var(--crab-bg-secondary)]">
      {/* Header — dùng div thay button để tránh nested button */}
      <div
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-5 py-3 hover:bg-[var(--crab-bg-hover)] transition-colors cursor-pointer"
      >
        <AlertTriangle size={13} className="text-amber-400 shrink-0" />
        <span className="text-xs font-semibold text-[var(--crab-text)]">Failure Patterns</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono tabular-nums">
          {patterns.length} pattern{patterns.length !== 1 ? 's' : ''} · {totalAffected} records
        </span>
        {highlightedPatternId && (
          <span
            role="button"
            onClick={e => { e.stopPropagation(); onHighlight(null, null) }}
            className="ml-auto flex items-center gap-1 text-[10px] text-[var(--crab-text-muted)] hover:text-[var(--crab-text)] transition-colors cursor-pointer"
          >
            <X size={11} /> Clear highlight
          </span>
        )}
        {!highlightedPatternId && (
          <span className="ml-auto">
            {open
              ? <ChevronDown size={13} className="text-[var(--crab-text-muted)]" />
              : <ChevronUp size={13} className="text-[var(--crab-text-muted)]" />}
          </span>
        )}
      </div>

      {/* Body */}
      {open && (
        <div className="px-4 pb-4 grid grid-cols-2 xl:grid-cols-3 gap-2">
          {patterns.map(pattern => {
            const isActive = highlightedPatternId === pattern.id
            return (
              <button
                key={pattern.id}
                onClick={() => handleCardClick(pattern)}
                className={`text-left rounded-xl border px-3.5 py-3 transition-all ${
                  isActive
                    ? 'border-[var(--crab-accent-medium)] bg-[var(--crab-accent-light)]'
                    : 'border-[var(--crab-border)] bg-[var(--crab-bg)] hover:bg-[var(--crab-bg-hover)] hover:border-[var(--crab-border-strong)]'
                }`}
              >
                {/* Color indicator + label */}
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: pattern.color }} />
                  <span className="text-[11px] font-semibold text-[var(--crab-text)]">{pattern.label}</span>
                </div>

                {/* Count */}
                <div className="flex items-baseline gap-1.5 mb-1">
                  <span className="text-2xl font-bold tabular-nums" style={{ color: pattern.color }}>
                    {pattern.count}
                  </span>
                  <span className="text-[10px] text-[var(--crab-text-muted)]">records</span>
                </div>

                {/* Description */}
                <p className="text-[10px] text-[var(--crab-text-muted)] leading-relaxed mb-2">
                  {pattern.description}
                </p>

                {/* Avg score */}
                {pattern.id !== 'errors' && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-[var(--crab-text-muted)]">Avg score:</span>
                    <span className="text-[11px] font-mono font-semibold" style={{
                      color: pattern.avgScore >= 80 ? '#8fba7a' : pattern.avgScore >= 60 ? '#7dbfd4' : pattern.avgScore >= 40 ? '#c96442' : '#f87171'
                    }}>
                      {pattern.avgScore.toFixed(1)}%
                    </span>
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
