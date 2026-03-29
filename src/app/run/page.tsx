'use client'
import { useState, useEffect, useRef } from 'react'
import { useDatasetsStore } from '@/store/datasetsStore'
import { useConfigStore } from '@/store/configStore'
import { useEvalSessionStore } from '@/store/evalSessionStore'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'
import { startEval, stopEval, EvalConfig } from '@/lib/evalRunner'
import { Play, Square, CheckCircle2, XCircle, Loader2, Trophy, AlertCircle, RefreshCw, Trash2 } from 'lucide-react'
import Link from 'next/link'

function fmt(v: number) { return v.toFixed(1) + '%' }

export default function RunPage() {
  const { datasets, removeDataset } = useDatasetsStore()
  const config = useConfigStore()
  const [hydrated, setHydrated] = useState(false)

  // Eval session state from global store (survives navigation)
  const {
    isRunning, isDone, progress, logs, overallProgress, errorMessage, reset,
  } = useEvalSessionStore()

  useEffect(() => { setHydrated(true) }, [])

  // selectedIds auto-sync: default = all datasets checked
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      datasets.forEach(d => next.add(d.id))
      next.forEach(id => { if (!datasets.find(d => d.id === id)) next.delete(id) })
      return next
    })
  }, [datasets])

  const selectedDatasets = datasets.filter(d => selectedIds.has(d.id))
  const totalRecords = selectedDatasets.reduce((s, d) => s + d.data.length, 0)
  const hasConfig = !!(config.targetBaseUrl && config.targetModel)

  // Auto-scroll to bottom of log when new entries arrive — scroll inside the panel only
  const logScrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!logScrollRef.current) return
    const el = logScrollRef.current
    // Only auto-scroll if already near the bottom (within 120px)
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom || isRunning) {
      el.scrollTop = el.scrollHeight
    }
  }, [logs.length, isRunning])

  const handleRun = async () => {
    if (!selectedDatasets.length) { toast.error('Select at least one dataset'); return }
    if (!hasConfig) { toast.error('Configure target model first'); return }

    const evalConfig: EvalConfig = {
      targetConfig: {
        baseUrl: config.targetBaseUrl,
        model: config.targetModel,
        maxTokens: config.targetMaxTokens,
        temperature: config.targetTemperature,
        systemPrompt: config.targetSystemPrompt,
      },
      judgeConfig: {
        baseUrl: config.judgeBaseUrl,
        model: config.judgeModel,
        enabled: config.judgeEnabled,
      },
    }

    await startEval(selectedDatasets, evalConfig)
    toast.success('Evaluation started — you can navigate away and come back.')
  }

  const handleStop = () => {
    stopEval()
    toast('Eval stopped')
  }

  const toggleDataset = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // Show error via toast when it changes
  useEffect(() => {
    if (errorMessage) toast.error(`Eval failed: ${errorMessage}`)
  }, [errorMessage])

  if (!hydrated) return null

  return (
    // Full viewport height layout: sidebar is fixed, main is flex-1
    // We use h-screen (or dvh) since main is overflow-auto
    <div className="flex flex-col" style={{ height: 'calc(100vh)' }}>
      {/* ── Header (fixed height) ─────────────────────────── */}
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-[#E5E5E4] bg-[#F9F9F8]">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-[#1A1A1A] tracking-tight">Run Eval</h1>
            <p className="text-[#9B9B9B] text-xs mt-0.5">
              Run inference on datasets · metrics computed client-side · eval continues if you navigate away
            </p>
          </div>

          <div className="flex items-center gap-2">
            {isDone && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => reset()}
                  className="text-xs text-[#9B9B9B] hover:text-[#1A1A1A] flex items-center gap-1.5"
                >
                  <RefreshCw size={12} /> New run
                </Button>
                <Link href="/leaderboard">
                  <Button size="sm" variant="outline" className="flex items-center gap-1.5 border-amber-200 text-amber-700 hover:bg-amber-50 text-xs">
                    <Trophy size={13} /> View Leaderboard
                  </Button>
                </Link>
              </>
            )}
            {isRunning ? (
              <Button
                size="sm"
                variant="outline"
                onClick={handleStop}
                className="border-red-200 text-red-600 hover:bg-red-50 flex items-center gap-1.5 text-xs"
              >
                <Square size={11} /> Stop
              </Button>
            ) : !isDone ? (
              <Button
                size="sm"
                onClick={handleRun}
                disabled={selectedDatasets.length === 0 || !hasConfig}
                className="bg-[#1A1A1A] text-white hover:bg-[#333] flex items-center gap-1.5 text-xs"
              >
                <Play size={13} /> Run Evaluation
              </Button>
            ) : null}
          </div>
        </div>

        {/* Overall progress bar — always visible when running or done */}
        {(isRunning || isDone) && (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-[#9B9B9B]">
                {isRunning ? (
                  progress
                    ? <>
                        <span className="font-medium text-[#1A1A1A]">{progress.datasetName}</span>
                        {' '}({progress.datasetIndex + 1}/{progress.datasetTotal}) · record {progress.recordIndex}/{progress.recordTotal}
                        <span className="font-mono ml-2 text-[#9B9B9B]">{progress.currentId}</span>
                      </>
                    : 'Starting…'
                ) : (
                  <span className="text-emerald-600 font-medium">Evaluation complete</span>
                )}
              </span>
              <span className="text-xs font-mono text-[#9B9B9B]">{overallProgress}%</span>
            </div>
            <Progress value={overallProgress} className="h-1.5" />
          </div>
        )}
      </div>

      {/* ── Body (fills remaining height, no outer scroll) ─── */}
      <div className="flex-1 min-h-0 flex gap-0">

        {/* ── LEFT PANEL: Config + Dataset selection ─────────── */}
        <div className="w-72 shrink-0 flex flex-col border-r border-[#E5E5E4] bg-white">

          {/* Target model summary */}
          <div className="shrink-0 px-4 pt-4 pb-3 border-b border-[#F3F3F2]">
            <h2 className="text-[11px] font-semibold text-[#9B9B9B] uppercase tracking-wider mb-2">Target Model</h2>
            {hasConfig ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#9B9B9B]">Model</span>
                  <span className="font-medium text-[#1A1A1A] truncate max-w-[130px]">{config.targetModel}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#9B9B9B]">Temp</span>
                  <span className="text-[#1A1A1A]">{config.targetTemperature}</span>
                </div>
                {config.judgeEnabled && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#9B9B9B]">Judge</span>
                    <span className="text-amber-600 font-medium truncate max-w-[130px]">{config.judgeModel}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-amber-600">
                <AlertCircle size={12} />
                <span>No config. <Link href="/config" className="underline">Go to Config</Link></span>
              </div>
            )}
          </div>

          {/* Dataset selection — scrollable */}
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="shrink-0 flex items-center justify-between px-4 pt-3 pb-1">
              <h2 className="text-[11px] font-semibold text-[#9B9B9B] uppercase tracking-wider">Datasets</h2>
              <div className="flex gap-2">
                <button
                  className="text-[11px] text-[#9B9B9B] hover:text-[#1A1A1A]"
                  onClick={() => setSelectedIds(new Set(datasets.map(d => d.id)))}
                >All</button>
                <button
                  className="text-[11px] text-[#9B9B9B] hover:text-[#1A1A1A]"
                  onClick={() => setSelectedIds(new Set())}
                >None</button>
              </div>
            </div>

            <ScrollArea className="flex-1 px-2">
              {datasets.length === 0 ? (
                <p className="text-xs text-[#9B9B9B] px-2 py-3">
                  No datasets. <Link href="/datasets" className="underline">Upload datasets</Link>
                </p>
              ) : (
                <div className="space-y-0.5 py-1">
                  {datasets.map(ds => {
                    const withRef = ds.data.filter(r => r.reference && r.reference !== '').length
                    const checked = selectedIds.has(ds.id)
                    return (
                      <div
                        key={ds.id}
                        className={`group flex items-start gap-2.5 px-2 py-2 rounded-lg transition-colors ${
                          checked ? 'bg-amber-50' : 'hover:bg-[#F9F9F8]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleDataset(ds.id)}
                          className="accent-[#D97706] mt-0.5 shrink-0 cursor-pointer"
                        />
                        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => toggleDataset(ds.id)}>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium text-[#1A1A1A] truncate">{ds.metadata.task_name}</span>
                            {withRef < ds.data.length && (
                              <span title="Some records missing reference">
                                <AlertCircle size={10} className="text-amber-500 shrink-0" />
                              </span>
                            )}
                          </div>
                          <div className="flex gap-2 text-[10px] text-[#9B9B9B] mt-0.5">
                            <span>{ds.data.length} records</span>
                            <span className="truncate">{(ds.metadata.gt_metrics || []).slice(0, 2).join(', ') || 'no metrics'}</span>
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            removeDataset(ds.id)
                            setSelectedIds(prev => { const n = new Set(prev); n.delete(ds.id); return n })
                            toast(`Removed "${ds.metadata.task_name}"`)
                          }}
                          disabled={isRunning}
                          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5 p-0.5 rounded text-[#9B9B9B] hover:text-red-500 disabled:pointer-events-none"
                          title="Remove dataset"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </ScrollArea>

            {selectedDatasets.length > 0 && (
              <div className="shrink-0 px-4 py-2.5 border-t border-[#F3F3F2] text-[11px] text-[#9B9B9B] bg-[#FAFAF9]">
                <span className="font-medium text-[#1A1A1A]">{selectedDatasets.length}</span> datasets ·{' '}
                <span className="font-medium text-[#1A1A1A]">{totalRecords}</span> records
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT PANEL: Live log ───────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col bg-[#F9F9F8]">
          {logs.length === 0 && !isRunning ? (
            <div className="flex-1 flex flex-col items-center justify-center text-[#9B9B9B]">
              <Play size={36} strokeWidth={1.2} className="mb-3" />
              <p className="text-sm">Select datasets and click <strong>Run Evaluation</strong> to start.</p>
              {!hasConfig && (
                <p className="text-xs mt-2 text-amber-600">
                  <AlertCircle size={11} className="inline mr-1" />
                  Target model not configured. <Link href="/config" className="underline">Go to Config</Link>
                </p>
              )}
            </div>
          ) : (
            <>
              {/* Log header */}
              <div className="shrink-0 px-4 py-2.5 border-b border-[#E5E5E4] bg-white flex items-center gap-2">
                <h3 className="text-xs font-semibold text-[#1A1A1A]">Results log</h3>
                <span className="text-[10px] text-[#9B9B9B] bg-[#F3F3F2] px-1.5 py-0.5 rounded-full">{logs.length}</span>
                {isRunning && (
                  <Loader2 size={11} className="animate-spin text-amber-500 ml-auto" />
                )}
              </div>

              {/* Scrollable log — one row per record */}
              <div ref={logScrollRef} className="flex-1 overflow-y-auto">
                <div className="divide-y divide-[#F3F3F2]">
                  {logs.map((l, i) => (
                    <div key={i} className="flex items-center gap-2 px-4 py-1.5 hover:bg-white transition-colors min-w-0">
                      {/* Status icon */}
                      <div className="shrink-0">
                        {l.status === 'running' && <Loader2 size={11} className="animate-spin text-amber-500" />}
                        {l.status === 'done'    && <CheckCircle2 size={11} className="text-emerald-500" />}
                        {l.status === 'error'   && <XCircle size={11} className="text-red-500" />}
                      </div>

                      {/* ID */}
                      <span className="font-mono text-[10px] text-[#9B9B9B] shrink-0 w-36 truncate">{l.id}</span>

                      {/* Output / tool call / error — takes remaining space */}
                      <span className="flex-1 min-w-0 text-[11px] truncate text-[#6B6B6B]">
                        {l.error
                          ? <span className="text-red-500">{l.error}</span>
                          : l.tool_calls && l.tool_calls.length > 0
                            ? <span className="font-mono">{l.tool_calls[0].function.name}()</span>
                            : l.output || ''}
                      </span>

                      {/* Score badges — shrink-0 so they don't wrap */}
                      {Object.keys(l.scores).length > 0 && (
                        <div className="flex gap-1 shrink-0">
                          {Object.entries(l.scores).map(([k, v]) => (
                            <span key={k} className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                              v >= 80 ? 'bg-emerald-50 text-emerald-700' :
                              v >= 50 ? 'bg-amber-50 text-amber-700' :
                              'bg-red-50 text-red-600'
                            }`}>
                              {fmt(v)}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Duration */}
                      {l.durationMs !== undefined && (
                        <span className="text-[10px] text-[#C4C4C3] shrink-0 w-12 text-right">{l.durationMs}ms</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
