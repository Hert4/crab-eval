'use client'
import { useState, useRef, useCallback } from 'react'
import { useDatasetsStore } from '@/store/datasetsStore'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'
import { generateGT, GTConfig, GTProgress, DEFAULT_GT_PROMPT } from '@/lib/gtGenerator'
import { getApiKey, setApiKey } from '@/lib/openai'
import { Wand2, ChevronDown, ChevronUp, Check, X, Loader2, Save } from 'lucide-react'

type RecordFilter = 'all' | 'empty_ref' | 'has_output'

interface LogEntry extends GTProgress {
  timestamp: string
}

export default function GTGeneratorPage() {
  const { datasets, updateRecord } = useDatasetsStore()

  // Config state
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>(datasets[0]?.id ?? '')
  const [filter, setFilter] = useState<RecordFilter>('empty_ref')
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1')
  const [apiKey, setApiKeyState] = useState(getApiKey('gt_api_key'))
  const [model, setModel] = useState('gpt-4o')
  const [promptTemplate, setPromptTemplate] = useState(DEFAULT_GT_PROMPT)
  const [delayMs, setDelayMs] = useState(200)
  const [showPrompt, setShowPrompt] = useState(false)

  // Run state
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [progress, setProgress] = useState<GTProgress | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Pending edits (generated but not yet saved)
  const [pendingRefs, setPendingRefs] = useState<Map<string, string>>(new Map())

  const dataset = datasets.find(d => d.id === selectedDatasetId)

  const getFilteredIds = useCallback(() => {
    if (!dataset) return []
    switch (filter) {
      case 'empty_ref': return dataset.data.filter(r => !r.reference || r.reference === '').map(r => r.id)
      case 'has_output': return dataset.data.filter(r => r.output && r.output !== '').map(r => r.id)
      default: return dataset.data.map(r => r.id)
    }
  }, [dataset, filter])

  const handleRun = async () => {
    if (!dataset) return
    const ids = getFilteredIds()
    if (!ids.length) { toast.error('No records match the filter'); return }

    setApiKey('gt_api_key', apiKey)
    setRunning(true)
    setLogs([])
    setPendingRefs(new Map())

    const controller = new AbortController()
    abortRef.current = controller

    const config: GTConfig = {
      baseUrl,
      model,
      systemPromptTemplate: promptTemplate,
      delayMs,
    }

    try {
      const results = await generateGT(
        dataset,
        ids,
        config,
        (p) => {
          setProgress(p)
          setLogs(prev => [...prev, { ...p, timestamp: new Date().toLocaleTimeString() }])
          if (p.status === 'done' && p.reference !== undefined) {
            setPendingRefs(prev => {
              const next = new Map(prev)
              next.set(p.recordId, p.reference!)
              return next
            })
          }
        },
        controller.signal
      )
      toast.success(`Generated ${results.size} references`)
    } catch (e) {
      toast.error(`Error: ${e}`)
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }

  const handleSaveAll = () => {
    if (!dataset) return
    let count = 0
    pendingRefs.forEach((ref, id) => {
      updateRecord(dataset.id, id, { reference: ref })
      count++
    })
    setPendingRefs(new Map())
    toast.success(`Saved ${count} references to dataset`)
  }

  const handleSaveOne = (recordId: string, ref: string) => {
    if (!dataset) return
    updateRecord(dataset.id, recordId, { reference: ref })
    setPendingRefs(prev => {
      const next = new Map(prev)
      next.delete(recordId)
      return next
    })
    toast.success('Saved reference')
  }

  const filteredCount = getFilteredIds().length

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[#1A1A1A] tracking-tight">GT Generator</h1>
        <p className="text-[#6B6B6B] text-sm mt-1">
          Use an LLM to generate ground-truth references for your datasets.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Config */}
        <div className="space-y-5">
          <div className="bg-white border border-[#E5E5E4] rounded-xl p-5">
            <h2 className="text-sm font-semibold text-[#1A1A1A] mb-4">Dataset & Filter</h2>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-[#6B6B6B] mb-1 block">Dataset</label>
                <select
                  value={selectedDatasetId}
                  onChange={e => setSelectedDatasetId(e.target.value)}
                  className="w-full border border-[#E5E5E4] rounded-lg px-3 py-2 text-sm bg-white text-[#1A1A1A] outline-none focus:ring-1 focus:ring-[#1A1A1A]"
                >
                  {datasets.length === 0 && <option value="">No datasets uploaded</option>}
                  {datasets.map(d => (
                    <option key={d.id} value={d.id}>{d.metadata.task_name} ({d.data.length})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-[#6B6B6B] mb-1 block">Records to process</label>
                <div className="flex gap-2">
                  {(['all', 'empty_ref', 'has_output'] as RecordFilter[]).map(f => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                        filter === f
                          ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
                          : 'bg-white text-[#6B6B6B] border-[#E5E5E4] hover:border-[#9B9B9B]'
                      }`}
                    >
                      {f === 'all' ? 'All' : f === 'empty_ref' ? 'Empty reference' : 'Has output'}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-[#9B9B9B] mt-1.5">
                  {filteredCount} records selected
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white border border-[#E5E5E4] rounded-xl p-5">
            <h2 className="text-sm font-semibold text-[#1A1A1A] mb-4">Model Config</h2>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-[#6B6B6B] mb-1 block">Base URL</label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={e => setBaseUrl(e.target.value)}
                  className="w-full border border-[#E5E5E4] rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[#1A1A1A]"
                  placeholder="https://api.openai.com/v1"
                />
              </div>
              <div>
                <label className="text-xs text-[#6B6B6B] mb-1 block">API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKeyState(e.target.value)}
                  className="w-full border border-[#E5E5E4] rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[#1A1A1A]"
                  placeholder="sk-..."
                />
                <p className="text-[10px] text-[#9B9B9B] mt-1">Stored in sessionStorage only</p>
              </div>
              <div>
                <label className="text-xs text-[#6B6B6B] mb-1 block">Model</label>
                <input
                  type="text"
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  className="w-full border border-[#E5E5E4] rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[#1A1A1A]"
                  placeholder="gpt-4o"
                />
              </div>
              <div>
                <label className="text-xs text-[#6B6B6B] mb-1 block">Delay between requests (ms)</label>
                <input
                  type="number"
                  value={delayMs}
                  onChange={e => setDelayMs(Number(e.target.value))}
                  className="w-full border border-[#E5E5E4] rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[#1A1A1A]"
                  min={0}
                />
              </div>
            </div>
          </div>

          {/* Prompt template */}
          <div className="bg-white border border-[#E5E5E4] rounded-xl p-5">
            <button
              className="flex items-center justify-between w-full text-sm font-semibold text-[#1A1A1A]"
              onClick={() => setShowPrompt(v => !v)}
            >
              Prompt Template
              {showPrompt ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {showPrompt && (
              <textarea
                value={promptTemplate}
                onChange={e => setPromptTemplate(e.target.value)}
                rows={10}
                className="mt-3 w-full border border-[#E5E5E4] rounded-lg px-3 py-2 text-xs font-mono outline-none focus:ring-1 focus:ring-[#1A1A1A] resize-none"
              />
            )}
            <p className="text-[10px] text-[#9B9B9B] mt-2">
              Use <code>{'{{input}}'}</code>, <code>{'{{context}}'}</code>, <code>{'{{#if context}}...{{/if}}'}</code>
            </p>
          </div>

          {/* Run buttons */}
          <div className="flex gap-2">
            {!running ? (
              <Button
                onClick={handleRun}
                disabled={!selectedDatasetId || filteredCount === 0}
                className="bg-[#1A1A1A] text-white hover:bg-[#333] flex items-center gap-2"
              >
                <Wand2 size={14} />
                Generate GT ({filteredCount} records)
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => abortRef.current?.abort()}
                className="border-red-200 text-red-600 hover:bg-red-50"
              >
                <X size={14} className="mr-1" /> Stop
              </Button>
            )}
          </div>
        </div>

        {/* Right: Logs + results */}
        <div className="space-y-4">
          {/* Progress */}
          {running && progress && (
            <div className="bg-white border border-[#E5E5E4] rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-[#6B6B6B]">Generating…</span>
                <span className="text-xs text-[#9B9B9B]">{progress.index} / {progress.total}</span>
              </div>
              <Progress value={progress.total ? (progress.index / progress.total) * 100 : 0} className="h-1.5" />
              <p className="text-xs text-[#9B9B9B] mt-1.5 truncate">{progress.recordId}</p>
            </div>
          )}

          {/* Pending results */}
          {pendingRefs.size > 0 && (
            <div className="bg-white border border-[#E5E5E4] rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-[#1A1A1A]">Generated References</span>
                <Button
                  size="sm"
                  onClick={handleSaveAll}
                  className="bg-emerald-600 text-white hover:bg-emerald-700 h-7 text-xs flex items-center gap-1"
                >
                  <Save size={12} /> Save All ({pendingRefs.size})
                </Button>
              </div>
              <ScrollArea className="h-64">
                <div className="space-y-2">
                  {Array.from(pendingRefs.entries()).map(([id, ref]) => (
                    <div key={id} className="bg-[#F9F9F8] rounded-lg p-3 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <span className="font-mono text-[#9B9B9B] text-[10px]">{id}</span>
                          <p className="text-[#1A1A1A] mt-1 line-clamp-3">{ref}</p>
                        </div>
                        <button
                          onClick={() => handleSaveOne(id, ref)}
                          className="shrink-0 text-emerald-600 hover:text-emerald-700 p-1"
                          title="Save this one"
                        >
                          <Check size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Log */}
          {logs.length > 0 && (
            <div className="bg-white border border-[#E5E5E4] rounded-xl p-4">
              <h3 className="text-sm font-semibold text-[#1A1A1A] mb-3">Log</h3>
              <ScrollArea className="h-64">
                <div className="space-y-1">
                  {logs.slice(-100).reverse().map((l, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs py-1">
                      <span className="text-[#9B9B9B] w-14 shrink-0">{l.timestamp}</span>
                      {l.status === 'running' && <Loader2 size={11} className="animate-spin text-amber-500 shrink-0" />}
                      {l.status === 'done' && <Check size={11} className="text-emerald-500 shrink-0" />}
                      {l.status === 'error' && <X size={11} className="text-red-500 shrink-0" />}
                      <span className="font-mono text-[#9B9B9B] truncate">{l.recordId}</span>
                      {l.error && <span className="text-red-500 truncate">{l.error}</span>}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {!running && logs.length === 0 && (
            <div className="bg-white border border-[#E5E5E4] rounded-xl p-10 text-center text-[#9B9B9B]">
              <Wand2 size={32} className="mx-auto mb-3" strokeWidth={1.2} />
              <p className="text-sm">Configure and click Generate GT to start.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
