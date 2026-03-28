'use client'
import { useState, useMemo, useEffect, useRef } from 'react'
import { useResultsStore } from '@/store/resultsStore'
import { RunResult, TaskGroup } from '@/types'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip, Cell, LabelList,
} from 'recharts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { Trophy, Trash2, Search, BarChart2, LayoutGrid, List, TrendingUp, FolderOpen, Loader2, GitMerge } from 'lucide-react'
import Link from 'next/link'

// ── Constants ──────────────────────────────────────────────────────
const TASK_GROUPS: TaskGroup[] = [
  { id: 'translation',   label: 'Dịch thuật',      tasks: ['mtrans_translation'] },
  { id: 'summarization', label: 'Tóm tắt',          tasks: ['crmmisa_dashboard'] },
  { id: 'rag_qa',        label: 'RAG QA',            tasks: ['htkh_rag_qa'] },
  { id: 'intent',        label: 'Intent & Routing',  tasks: ['htkh_intent_classification', 'htkh_intent_routing', 'crm_intent_analysis'] },
  { id: 'ranking',       label: 'Gợi ý & Dự báo',   tasks: ['crm_recommendation', 'makt_forecast'] },
  { id: 'tool_calling',  label: 'Tool Calling',       tasks: ['ava_tool_calling', 'recruitment_tool_calling'] },
]

const METRIC_SHORT: Record<string, string> = {
  exact_match: 'EM', token_f1: 'F1', accuracy: 'Acc',
  bleu: 'BLEU', rouge: 'ROUGE', faithfulness: 'Faith.',
  answer_relevancy: 'Relev.', ast_accuracy: 'AST', task_success_rate: 'Task%',
  list_match: 'Recall', comet: 'COMET',
  // Visual eval holistic metrics
  overall: 'Overall', relevancy: 'Relev.', helpfulness: 'Help.',
  task_completion: 'Complet.', proactiveness: 'Proact.', error_correction: 'Err.Corr', conv_quality: 'Conv.Q',
}

const PALETTE = [
  '#D97706', '#059669', '#3B82F6', '#8B5CF6', '#EF4444',
  '#0EA5E9', '#10B981', '#F59E0B', '#6366F1', '#EC4899',
]

function modelColor(i: number) { return PALETTE[i % PALETTE.length] }
function fmt(v: number | null | undefined) { return v == null ? '—' : v.toFixed(1) + '%' }
function metricShort(m: string) { return METRIC_SHORT[m] || m }
function taskShort(t: string) {
  const MAP: Record<string, string> = {
    mtrans_translation: 'Translation', crmmisa_dashboard: 'Dashboard',
    htkh_rag_qa: 'RAG QA', htkh_intent_classification: 'Intent Class.',
    htkh_intent_routing: 'Intent Route', crm_intent_analysis: 'CRM Intent',
    crm_recommendation: 'CRM Rec.', makt_forecast: 'Forecast',
    ava_tool_calling: 'AVA Tools', recruitment_tool_calling: 'Recruit Tools',
  }
  return MAP[t] || t.replace(/_/g, ' ')
}

// ── Compute helpers ─────────────────────────────────────────────────
// For visual eval tasks that have an 'overall' key, use it directly as the
// task score (it already blends turn-by-turn + holistic). For classic eval
// tasks (no 'overall'), average all metric values as before.
function getTaskAvg(entry: RunResult, task: string): number | null {
  const metrics = entry.tasks?.[task]
  if (!metrics) return null
  // If task has an explicit 'overall' score, use it — don't re-average sub-metrics
  if (typeof metrics.overall === 'number') return metrics.overall
  const vals = Object.values(metrics).filter((v): v is number => typeof v === 'number')
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

function getGroupAvg(entry: RunResult, group: TaskGroup): number | null {
  let total = 0, count = 0
  for (const t of group.tasks) {
    const a = getTaskAvg(entry, t)
    if (a !== null) { total += a; count++ }
  }
  return count ? total / count : null
}

function getGlobalAvg(entry: RunResult, activeGroups: Set<string>, allGroups: TaskGroup[]): number {
  let total = 0, count = 0
  for (const g of allGroups) {
    if (!activeGroups.has(g.id)) continue
    const a = getGroupAvg(entry, g)
    if (a !== null) { total += a; count++ }
  }
  return count ? total / count : 0
}

function getActiveGroups(runs: RunResult[]): TaskGroup[] {
  const allTasks = new Set(runs.flatMap(r => Object.keys(r.tasks || {})))
  const knownTasks = new Set(TASK_GROUPS.flatMap(g => g.tasks))
  // Tasks not in any predefined group → put in "Visual Eval / Other"
  const unclassified = [...allTasks].filter(t => !knownTasks.has(t))
  const base = TASK_GROUPS.filter(g => g.tasks.some(t => allTasks.has(t)))
  if (unclassified.length === 0) return base
  return [...base, { id: 'visual_eval', label: 'Visual Eval', tasks: unclassified }]
}

// ── Merge runs with same model name → keep best single run (highest global avg) ──
function runGlobalAvg(r: RunResult): number {
  const tasks = r.tasks || {}
  const scores: number[] = []
  for (const metrics of Object.values(tasks)) {
    if (typeof metrics.overall === 'number') {
      scores.push(metrics.overall)
    } else {
      const vals = Object.values(metrics).filter((v): v is number => typeof v === 'number')
      if (vals.length) scores.push(vals.reduce((a, b) => a + b, 0) / vals.length)
    }
  }
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
}

function mergeRunsByModel(runs: RunResult[]): RunResult[] {
  const byModel = new Map<string, RunResult>()
  for (const r of runs) {
    const existing = byModel.get(r.model)
    if (!existing || runGlobalAvg(r) > runGlobalAvg(existing)) {
      byModel.set(r.model, r)
    }
  }
  return [...byModel.values()]
}

// ── Compute variance stats across multiple runs for same model ────────
interface ModelStats {
  count: number
  min: number
  max: number
  std: number
}

function computeModelStats(runs: RunResult[], model: string, activeGroups: Set<string>, allGroups: TaskGroup[]): ModelStats | null {
  const modelRuns = runs.filter(r => r.model === model)
  if (modelRuns.length < 2) return null
  const scores = modelRuns.map(r => getGlobalAvg(r, activeGroups, allGroups))
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length
  const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length
  return {
    count: scores.length,
    min: Math.min(...scores),
    max: Math.max(...scores),
    std: Math.sqrt(variance),
  }
}

// ── Rank badge ───────────────────────────────────────────────────────
function RankCell({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-lg">🥇</span>
  if (rank === 2) return <span className="text-lg">🥈</span>
  if (rank === 3) return <span className="text-lg">🥉</span>
  return <span className="text-sm text-[#9B9B9B]">{rank}</span>
}

// ── Score cell ───────────────────────────────────────────────────────
function ScoreCell({ v, isBest, showBar, maxVal }: { v: number | null; isBest: boolean; showBar: boolean; maxVal: number }) {
  if (v == null) return <td className="text-right text-[#9B9B9B] text-xs py-2.5 px-3">—</td>
  const pct = maxVal > 0 ? Math.min(100, (v / maxVal) * 100) : 0
  const color = v >= 80 ? '#059669' : v >= 60 ? '#3B82F6' : v >= 40 ? '#D97706' : '#EF4444'
  return (
    <td className={`text-right py-2.5 px-3 text-xs font-mono ${isBest ? 'font-bold' : ''}`}
      style={isBest ? { color } : { color: '#1A1A1A' }}>
      {showBar ? (
        <div className="flex items-center justify-end gap-2">
          <span>{fmt(v)}</span>
          <div className="w-12 h-1 bg-[#E5E5E4] rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
          </div>
        </div>
      ) : fmt(v)}
    </td>
  )
}

// ── Main page ─────────────────────────────────────────────────────────
type ViewMode = 'group' | 'task'
type SortCol = 'global' | string

export default function LeaderboardPage() {
  const { runs, removeRun, replaceAll } = useResultsStore()
  const [hydrated, setHydrated] = useState(false)
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('group')
  const [showBars, setShowBars] = useState(false)
  const [sortCol, setSortCol] = useState<SortCol>('global')
  const [sortAsc, setSortAsc] = useState(false)
  const [activeGroupIds, setActiveGroupIds] = useState<Set<string>>(new Set())
  const [loadingDisk, setLoadingDisk] = useState(false)
  const [mergeMode, setMergeMode] = useState(true)

  useEffect(() => { setHydrated(true) }, [])

  // Effective runs: merged per-model or raw per-run
  const effectiveRuns = useMemo(() =>
    mergeMode ? mergeRunsByModel(runs) : runs,
    [runs, mergeMode]
  )

  const activeGroups = useMemo(() => getActiveGroups(effectiveRuns), [effectiveRuns])

  // Init active groups
  useEffect(() => {
    if (activeGroupIds.size === 0 && activeGroups.length > 0) {
      setActiveGroupIds(new Set(activeGroups.map(g => g.id)))
    }
  }, [activeGroups])

  // Load saved runs from results/ folder on disk
  const loadFromDisk = async () => {
    setLoadingDisk(true)
    try {
      const res = await fetch('/api/results')
      const json = await res.json()
      if (!res.ok) { toast.error(json.error || 'Failed to load results'); return }

      const valid = (json.runs ?? []).filter((r: RunResult) => r?.runId && r?.tasks)
      if (valid.length === 0) {
        toast('No saved runs found in results/ folder')
        return
      }
      // Disk is source of truth — replace entire store so stale/old runs are cleared
      replaceAll(valid)
      toast.success(`Loaded ${valid.length} run${valid.length !== 1 ? 's' : ''} from disk`)
    } catch (e) {
      toast.error(`Error loading from disk: ${e}`)
    } finally {
      setLoadingDisk(false)
    }
  }

  const allTasks = useMemo(() => {
    const s = new Set<string>()
    runs.forEach(r => Object.keys(r.tasks || {}).forEach(t => s.add(t)))
    return [...s].sort()
  }, [runs])

  // Filter & sort
  const filtered = useMemo(() => {
    let data = effectiveRuns.filter(r =>
      r.model.toLowerCase().includes(search.toLowerCase())
    )
    data = [...data].sort((a, b) => {
      let va = 0, vb = 0
      if (sortCol === 'global') {
        va = getGlobalAvg(a, activeGroupIds, activeGroups)
        vb = getGlobalAvg(b, activeGroupIds, activeGroups)
      } else if (sortCol.startsWith('g|')) {
        const gid = sortCol.slice(2)
        const g = activeGroups.find(x => x.id === gid)
        va = g ? (getGroupAvg(a, g) ?? -1) : -1
        vb = g ? (getGroupAvg(b, g) ?? -1) : -1
      } else {
        va = getTaskAvg(a, sortCol) ?? -1
        vb = getTaskAvg(b, sortCol) ?? -1
      }
      return sortAsc ? va - vb : vb - va
    })
    return data
  }, [effectiveRuns, search, sortCol, sortAsc, activeGroupIds, activeGroups])

  // Best scores
  const best = useMemo(() => {
    const b: Record<string, Record<string, number>> = { _global: { v: -Infinity } }
    for (const r of effectiveRuns) {
      const ga = getGlobalAvg(r, activeGroupIds, activeGroups)
      if (ga > (b._global.v ?? -Infinity)) b._global.v = ga
      for (const t of allTasks) {
        if (!b[t]) b[t] = { _avg: -Infinity }
        const avg = getTaskAvg(r, t)
        if (avg !== null && avg > b[t]._avg) b[t]._avg = avg
        for (const [m, v] of Object.entries(r.tasks?.[t] || {})) {
          if (typeof v === 'number') {
            if (!b[t][m] || v > b[t][m]) b[t][m] = v
          }
        }
      }
    }
    return b
  }, [effectiveRuns, allTasks, activeGroupIds, activeGroups])

  const handleSort = (col: SortCol) => {
    if (sortCol === col) setSortAsc(v => !v)
    else { setSortCol(col); setSortAsc(false) }
  }

  const ThCell = ({ col, children }: { col: SortCol; children: React.ReactNode }) => (
    <th
      onClick={() => handleSort(col)}
      className={`text-right py-2.5 px-3 text-[10px] uppercase tracking-wider cursor-pointer select-none whitespace-nowrap ${
        sortCol === col ? 'text-amber-600' : 'text-[#9B9B9B] hover:text-[#6B6B6B]'
      }`}
    >
      {children}{sortCol === col ? (sortAsc ? ' ↑' : ' ↓') : ''}
    </th>
  )

  const topModel = filtered[0]

  if (!hydrated) return null

  if (runs.length === 0) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-[#1A1A1A] tracking-tight">Leaderboard</h1>
        </div>
        <div className="bg-white border border-[#E5E5E4] rounded-xl p-16 text-center text-[#9B9B9B]">
          <Trophy size={40} className="mx-auto mb-4" strokeWidth={1.2} />
          <p className="text-sm mb-4">No evaluation runs yet.</p>
          <div className="flex gap-3 justify-center">
            <Button
              variant="outline"
              onClick={loadFromDisk}
              disabled={loadingDisk}
              className="flex items-center gap-2 border-[#E5E5E4] text-[#6B6B6B] hover:bg-[#F9F9F8] text-sm"
            >
              {loadingDisk ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
              Load from results/ folder
            </Button>
            <Link href="/run">
              <Button className="bg-[#1A1A1A] text-white hover:bg-[#333] text-sm">Run Evaluation</Button>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-600 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">
            Benchmark Leaderboard · {activeGroups.length} groups
          </span>
        </div>
        <h1 className="text-3xl font-bold text-[#1A1A1A] tracking-tight mb-2">
          {filtered.length >= 2
            ? <>{filtered[0].model} <span className="text-[#9B9B9B] font-normal text-2xl">vs</span> {filtered[1].model}</>
            : topModel?.model || 'Leaderboard'}
        </h1>
        {/* Score pills */}
        <div className="flex gap-3 mt-4 flex-wrap">
          {filtered.slice(0, 2).map((r, i) => {
            const score = getGlobalAvg(r, activeGroupIds, activeGroups)
            return (
              <div key={r.runId} className="bg-white border border-[#E5E5E4] rounded-xl px-4 py-3 flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: modelColor(i) }} />
                <div>
                  <div className="text-xs font-semibold text-[#1A1A1A]">{r.model}</div>
                  <div className="text-2xl font-bold" style={{ color: modelColor(i) }}>{fmt(score)}</div>
                  <div className="text-[10px] text-[#9B9B9B]">global avg</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap border-b border-[#E5E5E4] pb-4">
        <div className="relative flex-1 min-w-44">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9B9B9B]" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search models…"
            className="pl-8 h-8 text-sm border-[#E5E5E4]"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={loadFromDisk}
          disabled={loadingDisk}
          className="h-8 text-xs gap-1.5 border-[#E5E5E4] text-[#6B6B6B] hover:bg-[#F9F9F8]"
        >
          {loadingDisk ? <Loader2 size={12} className="animate-spin" /> : <FolderOpen size={12} />}
          Load from disk
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            if (!confirm('Delete ALL result files from disk and clear leaderboard?')) return
            try {
              await fetch('/api/results', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ all: true }),
              })
              replaceAll([])
              toast.success('All results cleared')
            } catch (e) {
              toast.error(`Failed to clear: ${e}`)
            }
          }}
          className="h-8 text-xs gap-1.5 border-[#E5E5E4] text-red-400 hover:text-red-600 hover:bg-red-50"
        >
          <Trash2 size={12} /> Clear all
        </Button>
        <Button
          size="sm"
          variant={mergeMode ? 'default' : 'outline'}
          onClick={() => setMergeMode(v => !v)}
          title={mergeMode ? 'Showing best result per model — optimistic view (click to show all runs)' : 'Showing all runs individually (click to merge by model)'}
          className={`h-8 text-xs gap-1.5 ${mergeMode ? 'bg-[#1A1A1A] text-white' : 'border-[#E5E5E4] text-[#6B6B6B]'}`}
        >
          <GitMerge size={12} /> {mergeMode ? 'Best run / model' : 'Per run'}
        </Button>
        <Button
          size="sm"
          variant={showBars ? 'default' : 'outline'}
          onClick={() => setShowBars(v => !v)}
          className={`h-8 text-xs gap-1.5 ${showBars ? 'bg-[#1A1A1A] text-white' : 'border-[#E5E5E4] text-[#6B6B6B]'}`}
        >
          <BarChart2 size={12} /> Bars
        </Button>
        <div className="flex border border-[#E5E5E4] rounded-lg overflow-hidden">
          <button
            onClick={() => setViewMode('group')}
            className={`flex items-center gap-1.5 px-3 h-8 text-xs transition-colors ${viewMode === 'group' ? 'bg-[#1A1A1A] text-white' : 'text-[#6B6B6B] hover:bg-[#F9F9F8]'}`}
          >
            <LayoutGrid size={12} /> Nhóm tác vụ
          </button>
          <button
            onClick={() => setViewMode('task')}
            className={`flex items-center gap-1.5 px-3 h-8 text-xs border-l border-[#E5E5E4] transition-colors ${viewMode === 'task' ? 'bg-[#1A1A1A] text-white' : 'text-[#6B6B6B] hover:bg-[#F9F9F8]'}`}
          >
            <List size={12} /> Theo task
          </button>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {activeGroups.map(g => (
          <button
            key={g.id}
            onClick={() => setActiveGroupIds(prev => {
              const next = new Set(prev)
              next.has(g.id) ? next.delete(g.id) : next.add(g.id)
              return next
            })}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              activeGroupIds.has(g.id)
                ? 'bg-amber-50 border-amber-300 text-amber-700 font-medium'
                : 'bg-white border-[#E5E5E4] text-[#9B9B9B] hover:border-[#9B9B9B]'
            }`}
          >
            {g.label}
          </button>
        ))}
        <button onClick={() => setActiveGroupIds(new Set(activeGroups.map(g => g.id)))}
          className="text-xs px-3 py-1.5 rounded-full border border-[#E5E5E4] text-[#6B6B6B] hover:border-[#9B9B9B]">
          Tất cả
        </button>
        <button onClick={() => setActiveGroupIds(new Set())}
          className="text-xs px-3 py-1.5 rounded-full border border-[#E5E5E4] text-[#6B6B6B] hover:border-[#9B9B9B]">
          Bỏ chọn
        </button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          {
            label: mergeMode ? 'Models' : 'Runs',
            value: mergeMode
              ? `${effectiveRuns.length}${runs.length !== effectiveRuns.length ? ` (${runs.length} runs)` : ''}`
              : runs.length,
            note: mergeMode && runs.length !== effectiveRuns.length ? 'best run/model' : undefined,
          },
          { label: 'Groups active', value: `${activeGroupIds.size} / ${activeGroups.length}` },
          { label: 'Tasks', value: allTasks.length },
          { label: 'Top Model', value: topModel?.model || '—', color: '#D97706' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-[#E5E5E4] rounded-xl px-4 py-3">
            <div className="text-[10px] text-[#9B9B9B] uppercase tracking-wider">{s.label}</div>
            <div className="text-lg font-bold mt-0.5" style={'color' in s && s.color ? { color: s.color as string, fontSize: '14px' } : {}}>
              {s.value}
            </div>
            {'note' in s && s.note && (
              <div className="text-[9px] text-amber-500 mt-0.5">{s.note as string}</div>
            )}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        {filtered.slice(0, 8).map((r, i) => (
          <div key={r.runId} className="flex items-center gap-1.5 text-xs text-[#6B6B6B]">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: modelColor(i) }} />
            {r.model}
          </div>
        ))}
        <div className="ml-auto flex items-center gap-1.5 text-xs text-[#9B9B9B]">
          <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          Live data
        </div>
      </div>

      {/* Bar charts (group mode) */}
      {viewMode === 'group' && filtered.length > 0 && (
        <div className="mb-8">
          <h2 className="text-base font-semibold text-[#1A1A1A] mb-4 flex items-center gap-2">
            <TrendingUp size={16} className="text-[#9B9B9B]" />
            Hiệu suất theo nhóm tác vụ
          </h2>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            {activeGroups.filter(g => activeGroupIds.has(g.id)).map(group => {
              const barData = filtered.slice(0, 8).map((r, i) => {
                const v = getGroupAvg(r, group)
                return v !== null ? { model: r.model, value: parseFloat(v.toFixed(2)), color: modelColor(i) } : null
              }).filter(Boolean) as { model: string; value: number; color: string }[]

              if (!barData.length) return null

              const vals = barData.map(d => d.value)
              const minY = Math.max(0, Math.floor(Math.min(...vals) * 0.94))
              const maxY = Math.min(100, Math.ceil(Math.max(...vals) * 1.04))
              const barSize = barData.length <= 2 ? 40 : barData.length <= 4 ? 28 : 18

              return (
                <div key={group.id} className="bg-white border border-[#E5E5E4] rounded-xl p-4">
                  <div className="text-xs font-semibold text-[#1A1A1A] mb-0.5 truncate">{group.label}</div>
                  <div className="text-[10px] text-[#9B9B9B] mb-2 truncate">{group.tasks.map(taskShort).join(' · ')}</div>
                  <div className="h-36">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={barData} margin={{ top: 16, right: 4, left: 4, bottom: 0 }} barSize={barSize}>
                        <CartesianGrid vertical={false} stroke="#F3F3F2" />
                        <XAxis
                          dataKey="model"
                          tick={{ fontSize: 9, fill: '#9B9B9B' }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={s => s.length > 10 ? s.slice(0, 9) + '…' : s}
                        />
                        <YAxis hide domain={[minY, maxY]} />
                        <Tooltip
                          cursor={{ fill: 'rgba(0,0,0,0.03)' }}
                          contentStyle={{ fontSize: 11, border: '1px solid #E5E5E4', borderRadius: 8, boxShadow: 'none' }}
                          formatter={(v) => [typeof v === 'number' ? v.toFixed(2) + '%' : String(v), 'avg']}
                        />
                        <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                          {barData.map((d, i) => <Cell key={i} fill={d.color} />)}
                          <LabelList
                            dataKey="value"
                            position="top"
                            formatter={(v: unknown) => typeof v === 'number' ? v.toFixed(1) + '%' : ''}
                            content={(props) => {
                              const { x, y, width, value, index } = props as {
                                x: number; y: number; width: number; value: number; index: number
                              }
                              return (
                                <text x={x + width / 2} y={y - 4} textAnchor="middle"
                                  fontSize={9} fontWeight={600} fill={barData[index]?.color ?? '#6B6B6B'}>
                                  {value?.toFixed(1)}%
                                </text>
                              )
                            }}
                          />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Table */}
      <div>
        <h2 className="text-base font-semibold text-[#1A1A1A] mb-4">Toàn bộ metrics</h2>
        <div className="bg-white border border-[#E5E5E4] rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              {viewMode === 'group' ? (
                <>
                  <tr className="bg-[#F9F9F8]">
                    <th className="text-left py-2.5 px-3 text-[10px] uppercase tracking-wider text-[#9B9B9B] w-10">#</th>
                    <th className="text-left py-2.5 px-3 text-[10px] uppercase tracking-wider text-[#9B9B9B]">Model</th>
                    <ThCell col="global">Global Avg</ThCell>
                    {activeGroups.filter(g => activeGroupIds.has(g.id)).map(g => (
                      <ThCell key={g.id} col={`g|${g.id}`}>{g.label}</ThCell>
                    ))}
                    <th className="py-2.5 px-3 w-8" />
                  </tr>
                </>
              ) : (
                <>
                  <tr className="bg-[#F9F9F8]">
                    <th className="text-left py-2.5 px-3 text-[10px] uppercase tracking-wider text-[#9B9B9B] w-10">#</th>
                    <th className="text-left py-2.5 px-3 text-[10px] uppercase tracking-wider text-[#9B9B9B]">Model</th>
                    <ThCell col="global">Global Avg</ThCell>
                    {allTasks.map(t => (
                      <ThCell key={t} col={t}>{taskShort(t)}</ThCell>
                    ))}
                    <th className="py-2.5 px-3 w-8" />
                  </tr>
                </>
              )}
            </thead>
            <tbody>
              {filtered.map((r, idx) => {
                const globalAvg = getGlobalAvg(r, activeGroupIds, activeGroups)
                const isTopGlobal = idx === 0
                return (
                  <tr key={r.runId} className="border-t border-[#F3F3F2] hover:bg-[#FAFAFA] transition-colors">
                    <td className="py-2.5 px-3 text-center"><RankCell rank={idx + 1} /></td>
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-[#1A1A1A] text-sm">{r.model}</div>
                      <div className="text-[10px] text-[#9B9B9B]">
                        {r.date}
                        {!mergeMode && (() => {
                          const sameModel = runs.filter(x => x.model === r.model)
                          if (sameModel.length > 1) {
                            const idx2 = sameModel.findIndex(x => x.runId === r.runId) + 1
                            return <span className="ml-1.5 text-amber-600 font-medium">run #{idx2}</span>
                          }
                        })()}
                        {mergeMode && (() => {
                          const stats = computeModelStats(runs, r.model, activeGroupIds, activeGroups)
                          if (!stats) return null
                          return (
                            <span className="ml-1.5 text-[#9B9B9B]" title={`${stats.count} runs — min ${stats.min.toFixed(1)}% / max ${stats.max.toFixed(1)}% / std ±${stats.std.toFixed(1)}%`}>
                              {stats.count} runs · ±{stats.std.toFixed(1)}%
                            </span>
                          )
                        })()}
                      </div>
                    </td>
                    <td className={`text-right py-2.5 px-3 font-mono font-bold text-sm ${isTopGlobal ? 'text-amber-600' : 'text-[#1A1A1A]'}`}>
                      {fmt(globalAvg)}
                    </td>

                    {viewMode === 'group'
                      ? activeGroups.filter(g => activeGroupIds.has(g.id)).map(g => {
                          const v = getGroupAvg(r, g)
                          const maxV = Math.max(...effectiveRuns.map(x => getGroupAvg(x, g) ?? 0))
                          const isBest = v !== null && Math.abs(v - maxV) < 0.005
                          return <ScoreCell key={g.id} v={v} isBest={isBest} showBar={showBars} maxVal={maxV} />
                        })
                      : allTasks.map(t => {
                          const v = getTaskAvg(r, t)
                          const maxV = Math.max(...effectiveRuns.map(x => getTaskAvg(x, t) ?? 0))
                          const isBest = v !== null && Math.abs(v - maxV) < 0.005
                          return <ScoreCell key={t} v={v} isBest={isBest} showBar={showBars} maxVal={maxV} />
                        })
                    }

                    <td className="py-2.5 px-3">
                      <button
                        onClick={async () => {
                          removeRun(r.runId)
                          // Also delete from disk
                          try {
                            await fetch('/api/results', {
                              method: 'DELETE',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ runId: r.runId }),
                            })
                          } catch { /* disk delete best-effort */ }
                          toast.success('Run removed')
                        }}
                        className="text-[#E5E5E4] hover:text-red-400 transition-colors"
                        title="Remove run (from memory + disk)"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={20} className="text-center py-12 text-[#9B9B9B] text-sm">
                    No models match your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
