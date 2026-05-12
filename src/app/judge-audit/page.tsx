'use client'
import { useState, useEffect, useRef, useMemo } from 'react'
import { useDatasetsStore } from '@/store/datasetsStore'
import { useConfigStore } from '@/store/configStore'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { toast } from 'sonner'
import { runJudgeAudit, AuditProgress } from '@/lib/judgeAudit'
import { getApiKey } from '@/lib/openai'
import { JudgeAuditResult } from '@/types'
import {
  Play, Square, AlertCircle, Settings, Gavel, ChevronDown, ChevronRight,
  Download, RefreshCw, Database, Info,
} from 'lucide-react'
import { CrawdAnim } from '@/components/ui/CrawdAnim'
import Link from 'next/link'

type AuditPhaseLabel = 'verbosity' | 'stability' | 'separability'

const PHASE_LABEL: Record<AuditPhaseLabel, string> = {
  verbosity: 'Verbosity bias',
  stability: 'Stochastic stability',
  separability: 'Score separability',
}

const PHASE_DESC: Record<AuditPhaseLabel, string> = {
  verbosity:    'Higher score = judge less fooled by padded answers.',
  stability:    'Higher score = judge more consistent across repeated calls.',
  separability: 'Higher score = judge discriminates good vs scrambled answers well.',
}

function scoreColor(score: number, kind: AuditPhaseLabel): string {
  // separability scale is delta (0-100 theoretical, in practice 30-80)
  // verbosity & stability are 0-100 robustness (closer to 100 = good)
  if (kind === 'separability') {
    if (score >= 50) return 'text-emerald-400'
    if (score >= 25) return 'text-amber-400'
    return 'text-red-400'
  }
  if (score >= 85) return 'text-emerald-400'
  if (score >= 65) return 'text-amber-400'
  return 'text-red-400'
}

export default function JudgeAuditPage() {
  const { datasets } = useDatasetsStore()
  const config = useConfigStore()
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => { setHydrated(true) }, [])

  const [datasetId, setDatasetId] = useState<string>('')
  const [sampleSize, setSampleSize] = useState<number>(20)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<AuditProgress | null>(null)
  const [result, setResult] = useState<JudgeAuditResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<AuditPhaseLabel>>(new Set())
  const abortRef = useRef<AbortController | null>(null)

  // Auto-select first dataset when datasets load
  useEffect(() => {
    if (!datasetId && datasets.length > 0) setDatasetId(datasets[0].id)
  }, [datasets, datasetId])

  const dataset = datasets.find(d => d.id === datasetId)
  const eligibleCount = useMemo(() => {
    if (!dataset) return 0
    return dataset.data.filter(r => (r.input || '').trim() && (r.reference || '').trim()).length
  }, [dataset])

  const effectiveK = Math.min(sampleSize, eligibleCount)
  const hasJudge = !!(config.judgeBaseUrl && config.judgeModel)
  const judgeKey = hydrated ? getApiKey('judge_api_key') : ''
  const canRun = !!dataset && eligibleCount > 0 && hasJudge && !!judgeKey && !running

  const estimatedCalls = effectiveK * 7  // 2 (verbosity) + 3 (stability) + 2 (separability)

  const handleRun = async () => {
    if (!dataset) return
    if (!judgeKey) { toast.error('Set judge API key in /config'); return }
    setError(null)
    setResult(null)
    setProgress({ phase: 'verbosity', completed: 0, total: effectiveK * 2 })
    setRunning(true)
    const ac = new AbortController()
    abortRef.current = ac

    try {
      const audit = await runJudgeAudit({
        judge: {
          baseUrl: config.judgeBaseUrl,
          model: config.judgeModel,
          apiKey: judgeKey,
        },
        records: dataset.data,
        sampleSize: effectiveK,
        signal: ac.signal,
        onProgress: (p) => setProgress(p),
      })

      const ts = Date.now()
      setResult({
        runId: `audit-${ts}`,
        timestamp: ts,
        judgeBaseUrl: config.judgeBaseUrl,
        judgeModel: config.judgeModel,
        datasetId: dataset.id,
        datasetName: dataset.filename,
        sampleSize: audit.sampleSize,
        verbosityRobustness: audit.verbosity.score,
        stochasticStability: audit.stability.score,
        scoreSeparability: audit.separability.score,
        perRecord: {
          verbosity: audit.verbosity.perRecord,
          stability: audit.stability.perRecord,
          separability: audit.separability.perRecord,
        },
      })
      toast.success('Audit complete')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!ac.signal.aborted) setError(msg)
      if (ac.signal.aborted) toast('Audit stopped')
      else toast.error(`Audit failed: ${msg}`)
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }

  const handleStop = () => {
    abortRef.current?.abort()
  }

  const handleDownload = () => {
    if (!result) return
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `judge-audit-${result.judgeModel.replace(/[^a-z0-9]/gi, '_')}-${result.runId}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleReset = () => {
    setResult(null)
    setError(null)
    setProgress(null)
    setExpanded(new Set())
  }

  const toggleExpanded = (phase: AuditPhaseLabel) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(phase)) next.delete(phase)
      else next.add(phase)
      return next
    })
  }

  const progressPct = useMemo(() => {
    if (!progress) return 0
    // Each phase counts equally as 1/3 of overall.
    const phasePct = progress.total > 0 ? (progress.completed / progress.total) * 100 : 0
    const phaseOffset = progress.phase === 'verbosity' ? 0 : progress.phase === 'stability' ? 100 / 3 : (100 / 3) * 2
    return Math.min(100, Math.round(phaseOffset + phasePct / 3))
  }, [progress])

  if (!hydrated) return null

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="shrink-0 border-b border-[var(--crab-border)] bg-[var(--crab-bg)]">
        <div className="flex items-center justify-between px-6 pt-5 pb-4">
          <div>
            <h1 className="text-xl font-semibold text-[var(--crab-text)] tracking-tight flex items-center gap-2">
              <Gavel size={18} className="text-[var(--crab-accent)]" /> Judge Audit
            </h1>
            <p className="text-[var(--crab-text-muted)] text-xs mt-0.5">
              Stress-test your LLM-as-judge for verbosity bias, stochastic stability, and score separability.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {result && !running && (
              <>
                <Button variant="ghost" size="sm" onClick={handleReset}
                  className="text-xs text-[var(--crab-text-muted)] hover:text-[var(--crab-text)] flex items-center gap-1.5">
                  <RefreshCw size={12} /> New audit
                </Button>
                <Button variant="outline" size="sm" onClick={handleDownload}
                  className="border-[var(--crab-border)] text-[var(--crab-text)] hover:bg-[var(--crab-bg-hover)] text-xs flex items-center gap-1.5">
                  <Download size={13} /> Download JSON
                </Button>
              </>
            )}
            {running ? (
              <Button size="sm" variant="outline" onClick={handleStop}
                className="border-red-500/40 text-red-400 hover:bg-red-500/10 flex items-center gap-1.5">
                <Square size={11} /> Stop
              </Button>
            ) : !result ? (
              <Button size="sm" onClick={handleRun} disabled={!canRun}
                className="bg-[var(--crab-accent)] text-[var(--crab-text)] hover:bg-[var(--crab-accent-hover)] flex items-center gap-1.5 px-4 disabled:opacity-40">
                <Play size={13} /> Run Audit
              </Button>
            ) : null}
          </div>
        </div>

        {running && progress && (
          <div className="px-6 pb-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-[var(--crab-text-muted)]">
                <span className="font-medium text-[var(--crab-text)]">{PHASE_LABEL[progress.phase]}</span>
                <span> · {progress.completed}/{progress.total} judge calls</span>
              </span>
              <span className="text-xs font-mono text-[var(--crab-text-muted)] tabular-nums">{progressPct}%</span>
            </div>
            <Progress value={progressPct} className="h-1.5" />
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 flex">
        {/* Left: config */}
        <div className="w-72 shrink-0 flex flex-col border-r border-[var(--crab-border)] bg-[var(--crab-bg-secondary)] p-4 gap-4 overflow-y-auto">
          {/* Judge */}
          <div className="rounded-xl border border-[var(--crab-border)] bg-[var(--crab-bg)] p-3">
            <div className="text-[11px] font-semibold text-[var(--crab-text-muted)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Settings size={11} /> Judge
            </div>
            {hasJudge ? (
              <div className="space-y-1">
                <div className="text-[13px] text-[var(--crab-text)] font-medium truncate">{config.judgeModel}</div>
                <div className="text-[11px] text-[var(--crab-text-muted)] truncate">{config.judgeBaseUrl}</div>
                {!judgeKey && (
                  <div className="text-[11px] text-red-400 flex items-start gap-1 mt-2">
                    <AlertCircle size={11} className="mt-0.5 shrink-0" />
                    <span>No API key for judge. <Link href="/config" className="underline">Set in Config</Link></span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-[12px] text-[var(--crab-text-muted)]">
                Not configured. <Link href="/config" className="underline text-[var(--crab-accent)]">Open Config →</Link>
              </div>
            )}
          </div>

          {/* Dataset */}
          <div className="rounded-xl border border-[var(--crab-border)] bg-[var(--crab-bg)] p-3">
            <div className="text-[11px] font-semibold text-[var(--crab-text-muted)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Database size={11} /> Audit Corpus
            </div>
            {datasets.length === 0 ? (
              <div className="text-[12px] text-[var(--crab-text-muted)]">
                No datasets. <Link href="/datasets" className="underline text-[var(--crab-accent)]">Upload one →</Link>
              </div>
            ) : (
              <div className="space-y-2">
                <select
                  value={datasetId}
                  onChange={e => setDatasetId(e.target.value)}
                  disabled={running}
                  className="w-full bg-[var(--crab-bg-secondary)] border border-[var(--crab-border)] rounded px-2 py-1.5 text-[12.5px] text-[var(--crab-text)] disabled:opacity-40"
                >
                  {datasets.map(d => (
                    <option key={d.id} value={d.id}>{d.filename} ({d.data.length})</option>
                  ))}
                </select>
                <div className="text-[11px] text-[var(--crab-text-muted)]">
                  {eligibleCount} record{eligibleCount !== 1 ? 's' : ''} with input + reference
                </div>
              </div>
            )}
          </div>

          {/* Sample size */}
          <div className="rounded-xl border border-[var(--crab-border)] bg-[var(--crab-bg)] p-3">
            <div className="text-[11px] font-semibold text-[var(--crab-text-muted)] uppercase tracking-wider mb-2">
              Sample size (K)
            </div>
            <input
              type="number"
              min={5}
              max={100}
              step={1}
              value={sampleSize}
              onChange={e => setSampleSize(Math.max(5, Math.min(100, parseInt(e.target.value || '20', 10))))}
              disabled={running}
              className="w-full bg-[var(--crab-bg-secondary)] border border-[var(--crab-border)] rounded px-2 py-1.5 text-[12.5px] text-[var(--crab-text)] disabled:opacity-40"
            />
            <div className="text-[11px] text-[var(--crab-text-muted)] mt-2 flex items-start gap-1">
              <Info size={11} className="mt-0.5 shrink-0" />
              <span>~{estimatedCalls} judge calls per audit (using K={effectiveK}).</span>
            </div>
          </div>
        </div>

        {/* Right: results */}
        <div className="flex-1 min-w-0 overflow-y-auto px-6 py-6">
          {!result && !running && !error && (
            <div className="h-full flex flex-col items-center justify-center text-center gap-3">
              <CrawdAnim type="notification" size={80} />
              <div className="text-[var(--crab-text-muted)] text-sm max-w-md">
                Pick an audit corpus on the left and click <span className="text-[var(--crab-text)] font-medium">Run Audit</span> to stress-test your judge.
              </div>
            </div>
          )}

          {running && (
            <div className="h-full flex flex-col items-center justify-center gap-3">
              <CrawdAnim type="thinking" size={80} />
              <div className="text-[var(--crab-text-muted)] text-sm">
                Running {PHASE_LABEL[progress?.phase ?? 'verbosity']}…
              </div>
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-4 flex items-start gap-2 text-sm text-red-400">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <div>
                <div className="font-medium mb-1">Audit failed</div>
                <div className="text-red-300/80 text-xs">{error}</div>
              </div>
            </div>
          )}

          {result && (
            <div className="space-y-4 max-w-4xl">
              <div className="text-xs text-[var(--crab-text-muted)]">
                Judge <span className="text-[var(--crab-text)]">{result.judgeModel}</span> · Dataset <span className="text-[var(--crab-text)]">{result.datasetName}</span> · {result.sampleSize} records
              </div>

              {/* 3 result cards */}
              {([
                { key: 'verbosity' as const,    score: result.verbosityRobustness,    label: PHASE_LABEL.verbosity,    desc: PHASE_DESC.verbosity },
                { key: 'stability' as const,    score: result.stochasticStability,    label: PHASE_LABEL.stability,    desc: PHASE_DESC.stability },
                { key: 'separability' as const, score: result.scoreSeparability,      label: PHASE_LABEL.separability, desc: PHASE_DESC.separability },
              ]).map(card => (
                <div key={card.key} className="rounded-xl border border-[var(--crab-border)] bg-[var(--crab-bg)] overflow-hidden">
                  <button
                    onClick={() => toggleExpanded(card.key)}
                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-[var(--crab-bg-hover)] transition-colors"
                  >
                    <div className="flex items-center gap-3 text-left">
                      {expanded.has(card.key) ? <ChevronDown size={16} className="text-[var(--crab-text-muted)]" /> : <ChevronRight size={16} className="text-[var(--crab-text-muted)]" />}
                      <div>
                        <div className="text-[14px] font-semibold text-[var(--crab-text)]">{card.label}</div>
                        <div className="text-[12px] text-[var(--crab-text-muted)] mt-0.5">{card.desc}</div>
                      </div>
                    </div>
                    <div className={`text-3xl font-bold font-mono tabular-nums ${scoreColor(card.score, card.key)}`}>
                      {card.score.toFixed(1)}
                    </div>
                  </button>

                  {expanded.has(card.key) && (
                    <div className="border-t border-[var(--crab-border)] px-5 py-3 bg-[var(--crab-bg-secondary)]">
                      <PerRecordTable phase={card.key} result={result} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Per-record table component ────────────────────────────────────────

function PerRecordTable({ phase, result }: { phase: AuditPhaseLabel; result: JudgeAuditResult }) {
  if (phase === 'verbosity') {
    const rows = result.perRecord.verbosity
    if (rows.length === 0) return <Empty />
    return (
      <Table headers={['Record', 'Original', 'Padded', '|Δ|']}>
        {rows.map(r => (
          <tr key={r.recordId} className="border-t border-[var(--crab-border-subtle)]">
            <Td>{r.recordId}</Td>
            <Td>{r.original.toFixed(1)}</Td>
            <Td>{r.padded.toFixed(1)}</Td>
            <Td className={r.delta > 15 ? 'text-amber-400' : ''}>{r.delta.toFixed(1)}</Td>
          </tr>
        ))}
      </Table>
    )
  }
  if (phase === 'stability') {
    const rows = result.perRecord.stability
    if (rows.length === 0) return <Empty />
    return (
      <Table headers={['Record', 'Scores', 'Stddev']}>
        {rows.map(r => (
          <tr key={r.recordId} className="border-t border-[var(--crab-border-subtle)]">
            <Td>{r.recordId}</Td>
            <Td>{r.scores.map(s => s.toFixed(1)).join(', ')}</Td>
            <Td className={r.stddev > 5 ? 'text-amber-400' : ''}>{r.stddev.toFixed(2)}</Td>
          </tr>
        ))}
      </Table>
    )
  }
  // separability
  const rows = result.perRecord.separability
  if (rows.length === 0) return <Empty />
  return (
    <Table headers={['Record', 'Good', 'Scrambled', 'Δ']}>
      {rows.map(r => (
        <tr key={r.recordId} className="border-t border-[var(--crab-border-subtle)]">
          <Td>{r.recordId}</Td>
          <Td>{r.good.toFixed(1)}</Td>
          <Td>{r.bad.toFixed(1)}</Td>
          <Td className={r.delta < 20 ? 'text-amber-400' : ''}>{r.delta.toFixed(1)}</Td>
        </tr>
      ))}
    </Table>
  )
}

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px] font-mono">
        <thead>
          <tr>
            {headers.map(h => (
              <th key={h} className="text-left text-[11px] font-semibold text-[var(--crab-text-muted)] uppercase tracking-wider py-1.5 pr-4">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={`py-1.5 pr-4 text-[var(--crab-text)] tabular-nums ${className ?? ''}`}>{children}</td>
}

function Empty() {
  return <div className="text-[12px] text-[var(--crab-text-muted)] py-2">No records produced valid scores.</div>
}
