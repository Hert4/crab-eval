'use client'
import { useState, useEffect, useRef, useMemo } from 'react'
import { useDatasetsStore } from '@/store/datasetsStore'
import { useConfigStore } from '@/store/configStore'
import { useAgentsStore } from '@/store/agentsStore'
import { useEvalSessionStore } from '@/store/evalSessionStore'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { toast } from 'sonner'
import { startEval, stopEval, EvalConfig, EvalTarget } from '@/lib/evalRunner'
import { getApiKey } from '@/lib/openai'
import {
  Play, Square, CheckCircle2, XCircle, Loader2, Trophy,
  AlertCircle, RefreshCw, Trash2, Settings, Database, ChevronRight, Users,
} from 'lucide-react'
import { CrawdAnim } from '@/components/ui/CrawdAnim'
import { FailurePatternsPanel } from '@/components/ui/FailurePatternsPanel'
import Link from 'next/link'

function fmt(v: number) { return v.toFixed(1) + '%' }

export default function RunPage() {
  const { datasets, removeDataset } = useDatasetsStore()
  const config = useConfigStore()
  const { agents } = useAgentsStore()
  const [hydrated, setHydrated] = useState(false)

  const {
    isRunning, isDone, overallProgress, errorMessage, reset,
    runs, runOrder,
  } = useEvalSessionStore()

  useEffect(() => { setHydrated(true) }, [])

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      datasets.forEach(d => next.add(d.id))
      next.forEach(id => { if (!datasets.find(d => d.id === id)) next.delete(id) })
      return next
    })
  }, [datasets])

  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    setSelectedAgentIds(prev => {
      const next = new Set(prev)
      next.forEach(id => { if (!agents.find(a => a.id === id)) next.delete(id) })
      return next
    })
  }, [agents])

  const selectedDatasets = datasets.filter(d => selectedIds.has(d.id))
  const selectedAgents = agents.filter(a => selectedAgentIds.has(a.id))
  const totalRecords = selectedDatasets.reduce((s, d) => s + d.data.length, 0)

  const hasDefaultTarget = !!(config.targetBaseUrl && config.targetModel)
  const effectiveModelCount = selectedAgents.length > 0 ? selectedAgents.length : (hasDefaultTarget ? 1 : 0)
  const canRun = selectedDatasets.length > 0 && effectiveModelCount > 0

  // ── Tab state — which model's log is visible ──────────────────────
  const [activeTab, setActiveTab] = useState<string | null>(null)
  useEffect(() => {
    if (runOrder.length > 0 && (!activeTab || !runOrder.includes(activeTab))) {
      setActiveTab(runOrder[0])
    }
    if (runOrder.length === 0) setActiveTab(null)
  }, [runOrder, activeTab])

  const activeSlot = activeTab ? runs[activeTab] : null
  const activeLogs = activeSlot?.logs ?? []
  const doneLogs = activeLogs.filter(l => l.status === 'done').length
  const errorLogs = activeLogs.filter(l => l.status === 'error').length

  const logScrollRef = useRef<HTMLDivElement>(null)
  const [highlightedPatternId, setHighlightedPatternId] = useState<string | null>(null)
  const [highlightedIds, setHighlightedIds] = useState<Set<string> | null>(null)

  useEffect(() => {
    if (!isDone && !isRunning) {
      setHighlightedPatternId(null)
      setHighlightedIds(null)
    }
  }, [isDone, isRunning])
  useEffect(() => {
    if (!logScrollRef.current) return
    const el = logScrollRef.current
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom || isRunning) el.scrollTop = el.scrollHeight
  }, [activeLogs.length, isRunning])

  const handleRun = async () => {
    if (!selectedDatasets.length) { toast.error('Select at least one dataset'); return }

    // Build targets
    const targets: EvalTarget[] = []
    const missingKeys: string[] = []

    if (selectedAgents.length > 0) {
      for (const a of selectedAgents) {
        const apiKey = getApiKey(a.apiKeyName)
        if (!apiKey) missingKeys.push(a.name)
        targets.push({
          modelId: a.id,
          modelName: a.name,
          baseUrl: a.baseUrl,
          model: a.model,
          maxTokens: a.maxTokens,
          temperature: a.temperature,
          apiKey,
          systemPrompt: config.targetSystemPrompt,
        })
      }
    } else {
      if (!hasDefaultTarget) { toast.error('Configure target model first'); return }
      const apiKey = getApiKey('target_api_key')
      if (!apiKey) missingKeys.push('Default target (Config)')
      targets.push({
        modelId: 'default',
        modelName: 'Target (from Config)',
        baseUrl: config.targetBaseUrl,
        model: config.targetModel,
        maxTokens: config.targetMaxTokens,
        temperature: config.targetTemperature,
        apiKey,
        systemPrompt: config.targetSystemPrompt,
      })
    }

    if (missingKeys.length > 0) {
      toast.error(`Missing API key for: ${missingKeys.join(', ')}`)
      return
    }

    const evalConfig: EvalConfig = {
      targets,
      judgeConfig: {
        baseUrl: config.judgeBaseUrl,
        model: config.judgeModel,
        enabled: config.judgeEnabled,
        apiKey: getApiKey('judge_api_key'),
      },
      concurrency: config.concurrency,
    }
    await startEval(selectedDatasets, evalConfig)
    toast.success(
      targets.length === 1
        ? 'Evaluation started — you can navigate away and come back.'
        : `Evaluation started on ${targets.length} models in parallel.`
    )
  }

  const handleStop = () => { stopEval(); toast('Eval stopped') }

  const toggleDataset = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  const toggleAgent = (id: string) => {
    setSelectedAgentIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  useEffect(() => {
    if (errorMessage) toast.error(`Eval failed: ${errorMessage}`)
  }, [errorMessage])

  const progressLabel = useMemo(() => {
    if (!isRunning) return null
    if (runOrder.length === 0) return 'Starting…'
    const running = runOrder.map(id => runs[id]).filter(s => s?.isRunning)
    if (running.length === 0) return 'Finishing…'
    if (running.length === 1 && running[0].progress) {
      const p = running[0].progress
      return (
        <>
          <span className="font-medium text-[var(--crab-text)]">{running[0].modelName}</span>
          <span className="text-[var(--crab-text-muted)]">
            {' · '}{p.datasetName} · dataset {p.datasetIndex + 1}/{p.datasetTotal} · record {p.recordIndex}/{p.recordTotal}
          </span>
        </>
      )
    }
    return (
      <span className="text-[var(--crab-text-muted)]">
        Running <span className="font-medium text-[var(--crab-text)]">{running.length}</span> model{running.length !== 1 ? 's' : ''} in parallel
      </span>
    )
  }, [isRunning, runOrder, runs])

  if (!hydrated) return null

  return (
    <div className="flex flex-col h-screen">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-[var(--crab-border)] bg-[var(--crab-bg)]">
        <div className="flex items-center justify-between px-6 pt-5 pb-4">
          <div>
            <h1 className="text-xl font-semibold text-[var(--crab-text)] tracking-tight">Run Evaluation</h1>
            <p className="text-[var(--crab-text-muted)] text-xs mt-0.5">
              Pick target models and datasets, then run. Multiple models run in parallel.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {isDone && (
              <>
                <Button variant="ghost" size="sm" onClick={reset}
                  className="text-xs text-[var(--crab-text-muted)] hover:text-[var(--crab-text)] flex items-center gap-1.5">
                  <RefreshCw size={12} /> New run
                </Button>
                <Link href="/leaderboard">
                  <Button size="sm" variant="outline"
                    className="flex items-center gap-1.5 border-[var(--crab-accent-medium)] text-[var(--crab-accent)] hover:bg-[var(--crab-accent-light)] text-xs">
                    <Trophy size={13} /> View Leaderboard
                  </Button>
                </Link>
              </>
            )}
            {isRunning ? (
              <Button size="sm" variant="outline" onClick={handleStop}
                className="border-red-500/40 text-red-400 hover:bg-red-500/10 flex items-center gap-1.5">
                <Square size={11} /> Stop
              </Button>
            ) : !isDone ? (
              <Button size="sm" onClick={handleRun} disabled={!canRun}
                className="bg-[var(--crab-accent)] text-[var(--crab-text)] hover:bg-[var(--crab-accent-hover)] flex items-center gap-1.5 px-4 disabled:opacity-40">
                <Play size={13} /> Run Evaluation
              </Button>
            ) : null}
          </div>
        </div>

        {(isRunning || isDone) && (
          <div className="px-6 pb-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-[var(--crab-text-muted)]">
                {isRunning ? progressLabel : (
                  <span className="text-emerald-400 font-medium flex items-center gap-1.5">
                    <CheckCircle2 size={12} />
                    Complete — {runOrder.length} model{runOrder.length !== 1 ? 's' : ''} finished
                  </span>
                )}
              </span>
              <span className="text-xs font-mono text-[var(--crab-text-muted)] tabular-nums">{overallProgress}%</span>
            </div>
            <Progress value={overallProgress} className="h-1.5" />
          </div>
        )}
      </div>

      {/* ── Body ────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 flex">

        {/* ── LEFT: Target + Dataset picker ─────────────────── */}
        <div className="w-72 shrink-0 flex flex-col border-r border-[var(--crab-border)] bg-[var(--crab-bg-secondary)]">

          {/* Target Models section */}
          <div className="shrink-0 mx-3 mt-3 mb-2 rounded-xl border border-[var(--crab-border)] bg-[var(--crab-bg)] overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <span className="text-[11px] font-semibold text-[var(--crab-text-muted)] uppercase tracking-wider flex items-center gap-1.5">
                <Users size={11} /> Target Models
              </span>
              {agents.length > 0 && (
                <div className="flex gap-2">
                  <button onClick={() => setSelectedAgentIds(new Set(agents.map(a => a.id)))}
                    className="text-[10px] text-[var(--crab-text-muted)] hover:text-[var(--crab-accent)] transition-colors">All</button>
                  <button onClick={() => setSelectedAgentIds(new Set())}
                    className="text-[10px] text-[var(--crab-text-muted)] hover:text-[var(--crab-text)] transition-colors">None</button>
                </div>
              )}
            </div>

            {agents.length === 0 ? (
              // No agents → show default-target fallback
              <div className="px-4 pb-3 space-y-1.5">
                {hasDefaultTarget ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-[var(--crab-text-muted)]">Using Config</span>
                      <span className="text-[11px] font-semibold text-[var(--crab-text)] truncate max-w-[140px]">{config.targetModel}</span>
                    </div>
                    <Link href="/agents" className="block text-[10px] text-[var(--crab-accent)] hover:underline">
                      + Add agents for multi-model runs
                    </Link>
                  </>
                ) : (
                  <Link href="/config" className="flex items-center gap-1.5 text-xs text-[var(--crab-accent)] hover:underline">
                    <AlertCircle size={12} />
                    Configure model first
                    <ChevronRight size={11} />
                  </Link>
                )}
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto px-2 pb-2">
                {agents.map(a => {
                  const checked = selectedAgentIds.has(a.id)
                  const slot = runs[a.id]
                  return (
                    <div key={a.id}
                      onClick={() => !isRunning && toggleAgent(a.id)}
                      className={`group relative flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-all ${
                        checked
                          ? 'bg-[var(--crab-accent-light)] border border-[var(--crab-accent-medium)]'
                          : 'hover:bg-[var(--crab-bg-hover)] border border-transparent'
                      } ${isRunning ? 'pointer-events-none opacity-60' : ''}`}
                    >
                      <div className={`w-3.5 h-3.5 rounded-md shrink-0 border-2 flex items-center justify-center transition-all ${
                        checked
                          ? 'bg-[var(--crab-accent)] border-[var(--crab-accent)]'
                          : 'border-[var(--crab-border-strong)]'
                      }`}>
                        {checked && <CheckCircle2 size={9} className="text-[var(--crab-text)]" strokeWidth={3} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-medium text-[var(--crab-text)] truncate leading-tight">{a.name}</div>
                        <div className="text-[9.5px] text-[var(--crab-text-muted)] truncate">{a.model}</div>
                      </div>
                      {slot && (isRunning || isDone) && (
                        <span className="text-[9px] font-mono tabular-nums shrink-0" style={{
                          color: slot.errorMessage ? '#f87171'
                            : slot.isDone ? '#8fba7a'
                            : 'var(--crab-accent)',
                        }}>
                          {slot.overallProgress}%
                        </span>
                      )}
                    </div>
                  )
                })}
                {selectedAgentIds.size === 0 && hasDefaultTarget && (
                  <div className="mt-1 px-2.5 py-1.5 text-[10px] text-[var(--crab-text-muted)] italic">
                    None selected → fallback to Config target (<span className="text-[var(--crab-text-secondary)] font-mono">{config.targetModel}</span>)
                  </div>
                )}
              </div>
            )}

            {/* Judge + concurrency summary */}
            <div className="border-t border-[var(--crab-border-subtle)] px-4 py-2 bg-[var(--crab-bg-secondary)]/50 text-[10px] text-[var(--crab-text-muted)] flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Settings size={9} />
                <Link href="/config" className="hover:text-[var(--crab-accent)] transition-colors">
                  {config.judgeEnabled ? <>Judge: <span className="text-[var(--crab-text-secondary)] font-mono">{config.judgeModel}</span></> : 'Judge: off'}
                </Link>
              </span>
              <span>concurrency <span className="font-mono text-[var(--crab-text-secondary)]">{config.concurrency}</span></span>
            </div>
          </div>

          {/* Dataset list header */}
          <div className="shrink-0 flex items-center justify-between px-4 pt-1 pb-1.5">
            <span className="text-[11px] font-semibold text-[var(--crab-text-muted)] uppercase tracking-wider flex items-center gap-1.5">
              <Database size={11} /> Datasets
            </span>
            <div className="flex gap-2">
              <button onClick={() => setSelectedIds(new Set(datasets.map(d => d.id)))}
                className="text-[11px] text-[var(--crab-text-muted)] hover:text-[var(--crab-accent)] transition-colors">All</button>
              <button onClick={() => setSelectedIds(new Set())}
                className="text-[11px] text-[var(--crab-text-muted)] hover:text-[var(--crab-text)] transition-colors">None</button>
            </div>
          </div>

          {/* Dataset list */}
          <div className="flex-1 min-h-0 overflow-y-auto px-3">
            {datasets.length === 0 ? (
              <div className="py-8 text-center space-y-3">
                <CrawdAnim type="sleeping" size={52} className="mx-auto opacity-60" />
                <p className="text-xs text-[var(--crab-text-muted)]">No datasets loaded</p>
                <div className="space-y-1">
                  <Link href="/task-generator" className="block text-xs text-[var(--crab-accent)] hover:underline">Generate from a document</Link>
                  <Link href="/datasets" className="block text-xs text-[var(--crab-text-secondary)] hover:underline">Upload existing dataset</Link>
                </div>
              </div>
            ) : (
              <div className="space-y-1 py-1">
                {datasets.map(ds => {
                  const withRef = ds.data.filter(r => r.reference && r.reference !== '').length
                  const checked = selectedIds.has(ds.id)
                  return (
                    <div key={ds.id}
                      onClick={() => !isRunning && toggleDataset(ds.id)}
                      className={`group relative flex items-start gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer transition-all ${
                        checked
                          ? 'bg-[var(--crab-accent-light)] border border-[var(--crab-accent-medium)]'
                          : 'hover:bg-[var(--crab-bg-hover)] border border-transparent'
                      } ${isRunning ? 'pointer-events-none opacity-60' : ''}`}
                    >
                      <div className={`mt-0.5 w-4 h-4 rounded-md shrink-0 border-2 flex items-center justify-center transition-all ${
                        checked
                          ? 'bg-[var(--crab-accent)] border-[var(--crab-accent)]'
                          : 'border-[var(--crab-border-strong)]'
                      }`}>
                        {checked && <CheckCircle2 size={10} className="text-[var(--crab-text)]" strokeWidth={3} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="text-xs font-medium text-[var(--crab-text)] truncate leading-tight">{ds.metadata.task_name}</span>
                          {withRef < ds.data.length && (
                            <span title="Some records missing reference"><AlertCircle size={10} className="text-amber-400 shrink-0" /></span>
                          )}
                        </div>
                        <div className="flex gap-2 text-[10px] text-[var(--crab-text-muted)] mt-0.5">
                          <span>{ds.data.length} records</span>
                          {ds.metadata.gt_metrics?.length ? (
                            <span className="truncate">{ds.metadata.gt_metrics.slice(0, 2).join(', ')}</span>
                          ) : (
                            <span className="text-amber-500/70">no metrics</span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          removeDataset(ds.id)
                          setSelectedIds(prev => { const n = new Set(prev); n.delete(ds.id); return n })
                          toast(`Removed "${ds.metadata.task_name}"`)
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-0.5 rounded text-[var(--crab-text-muted)] hover:text-red-400"
                        title="Remove"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="shrink-0 border-t border-[var(--crab-border)] p-3 space-y-2">
            {datasets.length > 0 && (
              <div className="flex items-center justify-between text-[11px] text-[var(--crab-text-muted)] px-1">
                <span>
                  <span className="font-semibold text-[var(--crab-text)]">{effectiveModelCount}</span> model{effectiveModelCount !== 1 ? 's' : ''}
                  {' × '}
                  <span className="font-semibold text-[var(--crab-text)]">{selectedDatasets.length}</span> dataset{selectedDatasets.length !== 1 ? 's' : ''}
                </span>
                <span>
                  ≈ <span className="font-semibold text-[var(--crab-text)]">{effectiveModelCount * totalRecords}</span> calls
                </span>
              </div>
            )}
            {!isRunning && !isDone && (
              <Button
                onClick={handleRun}
                disabled={!canRun}
                className="w-full bg-[var(--crab-accent)] text-[var(--crab-text)] hover:bg-[var(--crab-accent-hover)] flex items-center justify-center gap-2 h-9 disabled:opacity-40"
              >
                <Play size={13} /> Run Evaluation
              </Button>
            )}
            {isRunning && (
              <Button variant="outline" onClick={handleStop}
                className="w-full border-red-500/40 text-red-400 hover:bg-red-500/10 flex items-center justify-center gap-2 h-9">
                <Square size={11} /> Stop
              </Button>
            )}
            {isDone && (
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={reset}
                  className="flex-1 text-xs text-[var(--crab-text-muted)] hover:text-[var(--crab-text)] flex items-center justify-center gap-1.5 h-9">
                  <RefreshCw size={12} /> New run
                </Button>
                <Link href="/leaderboard" className="flex-1">
                  <Button size="sm" className="w-full bg-[var(--crab-accent)] text-[var(--crab-text)] hover:bg-[var(--crab-accent-hover)] flex items-center justify-center gap-1.5 h-9 text-xs">
                    <Trophy size={12} /> Leaderboard
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: Live log ──────────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col bg-[var(--crab-bg)]">
          {runOrder.length === 0 && !isRunning ? (

            /* Empty state */
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-[var(--crab-text-muted)]">
              <CrawdAnim type="sleeping" size={96} />
              {effectiveModelCount === 0 ? (
                <div className="text-center space-y-2">
                  <p className="text-sm font-medium text-[var(--crab-text)]">No target model</p>
                  <p className="text-xs">Pick an Agent or configure the default target.</p>
                  <div className="flex items-center justify-center gap-2 mt-2">
                    <Link href="/agents">
                      <Button size="sm" variant="outline" className="border-[var(--crab-border-strong)] text-[var(--crab-text-secondary)] flex items-center gap-1.5">
                        <Users size={13} /> Agents
                      </Button>
                    </Link>
                    <Link href="/config">
                      <Button size="sm" className="bg-[var(--crab-accent)] text-[var(--crab-text)] hover:bg-[var(--crab-accent-hover)] flex items-center gap-1.5">
                        <Settings size={13} /> Config
                      </Button>
                    </Link>
                  </div>
                </div>
              ) : datasets.length === 0 ? (
                <div className="text-center space-y-2">
                  <p className="text-sm font-medium text-[var(--crab-text)]">No datasets loaded</p>
                  <p className="text-xs">Load a dataset, then hit Run Evaluation.</p>
                  <Link href="/datasets">
                    <Button size="sm" variant="outline" className="mt-2 border-[var(--crab-border-strong)] text-[var(--crab-text-secondary)] flex items-center gap-1.5">
                      <Database size={13} /> Go to Datasets
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="text-center space-y-1">
                  <p className="text-sm font-medium text-[var(--crab-text)]">Ready to run</p>
                  <p className="text-xs">
                    {effectiveModelCount} model{effectiveModelCount !== 1 ? 's' : ''} · {selectedDatasets.length} dataset{selectedDatasets.length !== 1 ? 's' : ''} · {totalRecords} records
                  </p>
                </div>
              )}
            </div>

          ) : (
            <>
              {/* Tab bar — one tab per model */}
              {runOrder.length > 1 && (
                <div className="shrink-0 flex items-center gap-0 border-b border-[var(--crab-border)] bg-[var(--crab-bg-secondary)] px-3 overflow-x-auto">
                  {runOrder.map(id => {
                    const slot = runs[id]
                    if (!slot) return null
                    const active = activeTab === id
                    const statusColor = slot.errorMessage ? '#f87171'
                      : slot.isDone ? '#8fba7a'
                      : slot.isRunning ? 'var(--crab-accent)'
                      : 'var(--crab-text-muted)'
                    return (
                      <button
                        key={id}
                        onClick={() => setActiveTab(id)}
                        className={`shrink-0 flex items-center gap-2 px-3 py-2 text-[11px] border-b-2 transition-all ${
                          active
                            ? 'border-[var(--crab-accent)] text-[var(--crab-text)]'
                            : 'border-transparent text-[var(--crab-text-muted)] hover:text-[var(--crab-text)]'
                        }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: statusColor }} />
                        <span className="font-medium truncate max-w-[160px]">{slot.modelName}</span>
                        <span className="font-mono tabular-nums text-[10px] text-[var(--crab-text-muted)]">{slot.overallProgress}%</span>
                        {slot.isRunning && <Loader2 size={10} className="animate-spin text-[var(--crab-accent)]" />}
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Log header */}
              <div className="shrink-0 px-5 py-3 border-b border-[var(--crab-border)] bg-[var(--crab-bg-secondary)] flex items-center gap-3">
                <h3 className="text-xs font-semibold text-[var(--crab-text)]">
                  {activeSlot ? activeSlot.modelName : 'Results log'}
                </h3>
                <span className="text-[10px] text-[var(--crab-text-muted)] bg-[var(--crab-bg-tertiary)] px-2 py-0.5 rounded-full tabular-nums">{activeLogs.length}</span>
                {doneLogs > 0 && (
                  <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 size={10} /> {doneLogs} done
                  </span>
                )}
                {errorLogs > 0 && (
                  <span className="text-[10px] text-red-400 flex items-center gap-1">
                    <XCircle size={10} /> {errorLogs} errors
                  </span>
                )}
                {activeSlot?.errorMessage && (
                  <span className="text-[10px] text-red-400 flex items-center gap-1 truncate">
                    <AlertCircle size={10} /> {activeSlot.errorMessage}
                  </span>
                )}
                {activeSlot?.isRunning && <Loader2 size={11} className="animate-spin text-[var(--crab-accent)] ml-auto" />}
              </div>

              {/* Column headers */}
              <div className="shrink-0 grid grid-cols-[20px_160px_1fr_auto_80px] gap-3 px-5 py-2 border-b border-[var(--crab-border-subtle)] bg-[var(--crab-bg-secondary)]">
                <div />
                <span className="text-[10px] font-semibold text-[var(--crab-text-muted)] uppercase tracking-wider">ID</span>
                <span className="text-[10px] font-semibold text-[var(--crab-text-muted)] uppercase tracking-wider">Output</span>
                <span className="text-[10px] font-semibold text-[var(--crab-text-muted)] uppercase tracking-wider">Score</span>
                <span className="text-[10px] font-semibold text-[var(--crab-text-muted)] uppercase tracking-wider text-right">Time</span>
              </div>

              {/* Log rows */}
              <div ref={logScrollRef} className="flex-1 overflow-y-auto">
                <div className="divide-y divide-[var(--crab-border-subtle)]">
                  {activeLogs.map((l, i) => {
                    const isHighlighted = highlightedIds !== null && highlightedIds.has(l.id)
                    const isDimmed = highlightedIds !== null && !highlightedIds.has(l.id)
                    return (
                    <div key={i}
                      className="grid grid-cols-[20px_160px_1fr_auto_80px] gap-3 items-center px-5 py-2 hover:bg-[var(--crab-bg-hover)] transition-colors min-w-0"
                      style={{
                        background: isHighlighted ? 'rgba(251,191,36,0.07)' : undefined,
                        borderLeft: isHighlighted ? '2px solid #fbbf24' : '2px solid transparent',
                        opacity: isDimmed ? 0.3 : 1,
                      }}
                    >
                      <div className="shrink-0 flex items-center justify-center">
                        {l.status === 'running' && <Loader2 size={12} className="animate-spin text-[var(--crab-accent)]" />}
                        {l.status === 'done'    && <CheckCircle2 size={12} className="text-emerald-400" />}
                        {l.status === 'error'   && <XCircle size={12} className="text-red-400" />}
                      </div>
                      <span className="font-mono text-[11px] text-[var(--crab-text-muted)] truncate">{l.id}</span>
                      <span className="text-[11px] truncate text-[var(--crab-text-secondary)]">
                        {l.error
                          ? <span className="text-red-400 flex items-center gap-1"><AlertCircle size={10} />{l.error}</span>
                          : l.tool_calls?.length
                            ? <span className="font-mono text-[var(--crab-accent)]">{l.tool_calls[0].function.name}()</span>
                            : l.output || <span className="text-[var(--crab-text-muted)] italic">—</span>
                        }
                      </span>
                      <div className="flex gap-1 shrink-0 justify-end">
                        {l.status === 'done' && Object.entries(l.scores).map(([k, v]) => (
                          <span key={k} title={k} className={`text-[10px] px-2 py-0.5 rounded-md font-mono font-semibold ${
                            v >= 80 ? 'bg-emerald-500/15 text-emerald-400' :
                            v >= 50 ? 'bg-amber-500/15 text-amber-400' :
                                      'bg-red-500/15 text-red-400'
                          }`}>
                            {fmt(v)}
                          </span>
                        ))}
                        {l.status === 'running' && (
                          <span className="text-[10px] text-[var(--crab-text-muted)] italic">scoring…</span>
                        )}
                      </div>
                      <span className="text-[10px] text-[var(--crab-text-muted)] tabular-nums text-right shrink-0">
                        {l.durationMs !== undefined ? `${l.durationMs}ms` : ''}
                      </span>
                    </div>
                    )
                  })}
                </div>
              </div>

              {isDone && activeLogs.length > 0 && (
                <FailurePatternsPanel
                  logs={activeLogs}
                  highlightedPatternId={highlightedPatternId}
                  onHighlight={(ids, patternId) => {
                    setHighlightedIds(ids)
                    setHighlightedPatternId(patternId)
                  }}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
