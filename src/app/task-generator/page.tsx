'use client'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'
import {
  FlaskConical,
  Upload,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  X,
  Plus,
  Loader2,
  Download,
  Copy,
  Check,
  AlertTriangle,
  RefreshCw,
  Trash2,
  ArrowRight,
  Play,
} from 'lucide-react'
import { CrawdAnim } from '@/components/ui/CrawdAnim'
import { useTaskGeneratorStore } from '@/store/taskGeneratorStore'
import {
  extractAtomicSubtasks,
  generateSystemPrompt,
  generateToolDefinitions,
  composeCompositeTasks,
  generateNaturalLanguageQuestions,
  generateExpectedToolCalls,
  computeTaskSetStats,
  detectTaskType,
  generateQAPairs,
} from '@/lib/taskGenerator'
import { getApiKey, setApiKey } from '@/lib/openai'
import { useAgentsStore } from '@/store/agentsStore'
import { AgentSelector } from '@/components/ui/AgentSelector'
import { useDatasetsStore } from '@/store/datasetsStore'
import type {
  AtomicSubtask,
  CompositeTask,
  GeneratedTask,
  TaskIntent,
  ModelConfig,
  UserPersona,
  InfoCompleteness,
  QAPair,
} from '@/types'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'

// ── Color maps ────────────────────────────────────────────────────────

const INTENT_COLORS: Record<TaskIntent, string> = {
  information_retrieval: 'bg-blue-100 text-blue-700',
  analysis: 'bg-purple-100 text-purple-700',
  content_generation: 'bg-green-100 text-green-700',
  action: 'bg-amber-100 text-amber-700',
}

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: 'bg-emerald-100 text-emerald-700',
  medium: 'bg-amber-100 text-amber-700',
  hard: 'bg-orange-100 text-orange-700',
  expert: 'bg-red-100 text-red-700',
}

const PERSONA_COLORS: Record<string, string> = {
  expert: 'bg-indigo-100 text-indigo-700',
  novice: 'bg-teal-100 text-teal-700',
  out_of_scope: 'bg-gray-100 text-gray-600',
}

const BAR_COLORS = ['#c96442', '#8fba7a', '#b48ade', '#7dbfd4', '#f87171']

// ── Stepper ───────────────────────────────────────────────────────────

const STEPS = [
  { n: 1, label: 'Upload & Extract' },
  { n: 2, label: 'Review Subtasks' },
  { n: 3, label: 'Configure & Compose' },
  { n: 4, label: 'Generate & Export' },
]

function Stepper({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map((s, i) => (
        <div key={s.n} className="flex items-center">
          <div className="flex items-center gap-2">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                s.n === current
                  ? 'bg-[var(--crab-accent)] text-[var(--crab-text)]'
                  : s.n < current
                  ? 'bg-emerald-500 text-white'
                  : 'bg-[var(--crab-bg-tertiary)] text-[var(--crab-text-muted)]'
              }`}
            >
              {s.n < current ? <Check size={11} /> : s.n}
            </div>
            <span
              className={`text-[13px] font-medium ${
                s.n === current ? 'text-[var(--crab-text)]' : 'text-[var(--crab-text-muted)]'
              }`}
            >
              {s.label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <ChevronRight size={14} className="text-[var(--crab-text-muted)] mx-3" />
          )}
        </div>
      ))}
    </div>
  )
}

// ── Model config row ──────────────────────────────────────────────────
// Supports agent quick-pick (fills all fields) + manual override

function ModelConfigRow({
  apiKeyName,
  baseUrl,
  setBaseUrl,
  model,
  setModel,
}: {
  apiKeyName: string
  baseUrl: string
  setBaseUrl: (v: string) => void
  model: string
  setModel: (v: string) => void
}) {
  const { agents } = useAgentsStore()
  const [apiKey, setApiKeyState] = useState('')
  const [selectedAgentId, setSelectedAgentId] = useState('')

  useEffect(() => {
    setApiKeyState(getApiKey(apiKeyName))
  }, [apiKeyName])

  const handleAgentSelect = (id: string) => {
    setSelectedAgentId(id)
    if (!id) return
    const a = agents.find(x => x.id === id)
    if (!a) return
    setBaseUrl(a.baseUrl)
    setModel(a.model)
    const key = getApiKey(a.apiKeyName)
    setApiKeyState(key)
    setApiKey(apiKeyName, key)
  }

  const inputCls = 'w-full border border-[var(--crab-border-strong)] bg-[var(--crab-bg-tertiary)] rounded-lg px-3 py-2 text-sm text-[var(--crab-text)] placeholder-[var(--crab-text-muted)] outline-none focus:ring-1 focus:ring-[var(--crab-accent)]'

  return (
    <div className="space-y-2">
      {agents.length > 0 && (
        <div>
          <label className="text-xs text-[var(--crab-text-secondary)] mb-1 block">Quick-pick agent</label>
          <AgentSelector value={selectedAgentId} onChange={handleAgentSelect} placeholder="Select agent to auto-fill…" />
        </div>
      )}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-[var(--crab-text-secondary)] mb-1 block">Base URL</label>
          <input type="text" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} className={inputCls} placeholder="https://api.openai.com/v1" />
        </div>
        <div>
          <label className="text-xs text-[var(--crab-text-secondary)] mb-1 block">API Key</label>
          <input type="password" value={apiKey} onChange={e => { setApiKeyState(e.target.value); setApiKey(apiKeyName, e.target.value) }} className={inputCls} placeholder="sk-..." />
        </div>
        <div>
          <label className="text-xs text-[var(--crab-text-secondary)] mb-1 block">Model</label>
          <input type="text" value={model} onChange={e => setModel(e.target.value)} className={inputCls} placeholder="gpt-4o" />
        </div>
      </div>
    </div>
  )
}

// ── Step 1: Upload & Extract ──────────────────────────────────────────

const ACCEPTED_EXTS = '.txt,.md,.markdown,.csv,.json,.docx,.pdf,.png,.jpg,.jpeg,.webp'
const ACCEPTED_LABEL = 'TXT, MD, CSV, JSON, DOCX, PDF, PNG, JPG'

async function parseDocumentFile(file: File): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch('/api/parse-document', { method: 'POST', body: formData })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
  return json.text as string
}

function Step1Extract({ onNext, onNextQA }: { onNext: () => void; onNextQA: () => void }) {
  const {
    documentContent,
    setDocumentContent,
    isExtracting,
    setIsExtracting,
    setAtomicSubtasks,
    setDetectedLanguage,
    agentSystemPrompt,
    setAgentSystemPrompt,
    agentToolsJson,
    setAgentToolsJson,
    sourceFile,
    setSourceFile,
    detectedTaskType,
    setDetectedTaskType,
    isDetecting,
    setIsDetecting,
    setQAPairs,
    setQAProgress,
    setCompositeTasks,
    setGeneratedTasks,
    setStats,
  } = useTaskGeneratorStore()

  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1')
  const [model, setModel] = useState('gpt-4o')
  const [log, setLog] = useState<string[]>([])
  const [uploadedFilename, setUploadedFilename] = useState<string | null>(null)
  const [isParsing, setIsParsing] = useState(false)
  const [isGenSysPrompt, setIsGenSysPrompt] = useState(false)
  const [isGenTools, setIsGenTools] = useState(false)
  const [toolsError, setToolsError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Validate tools JSON on change
  const handleToolsChange = (val: string) => {
    setAgentToolsJson(val)
    if (!val.trim()) { setToolsError(null); return }
    try {
      const parsed = JSON.parse(val)
      if (!Array.isArray(parsed)) { setToolsError('Must be a JSON array [ ... ]'); return }
      setToolsError(null)
    } catch (e) {
      setToolsError(`Invalid JSON: ${e}`)
    }
  }

  // Detect document type (tool_calling vs rag_qa)
  const handleDetectType = async (content: string, file?: File | null) => {
    if (!content.trim()) return
    setIsDetecting(true)
    try {
      const config: ModelConfig = { baseUrl, model, apiKey: getApiKey('tg_api_key') }
      const type = await detectTaskType(content, config, undefined, file ?? undefined)
      setDetectedTaskType(type)
    } catch {
      setDetectedTaskType('tool_calling') // fallback
    } finally {
      setIsDetecting(false)
    }
  }

  // Generate QA pairs (rag_qa mode)
  const handleExtractQA = async () => {
    if (!documentContent.trim()) { toast.error('Please paste or upload a document first'); return }

    setIsExtracting(true)
    setLog(['Starting QA pair generation...'])
    abortRef.current = new AbortController()

    try {
      const config: ModelConfig = { baseUrl, model, apiKey: getApiKey('tg_api_key') }

      setLog(p => [...p, `Document: ${sourceFile ? sourceFile.name : documentContent.length.toLocaleString() + ' chars'} — chunking...`])

      const pairs = await generateQAPairs(
        documentContent,
        config,
        abortRef.current.signal,
        (done, total) => {
          setQAProgress({ done, total })
          setLog(p => {
            const last = p[p.length - 1]
            const msg = `Chunk ${done}/${total}...`
            return last?.startsWith('Chunk') ? [...p.slice(0, -1), msg] : [...p, msg]
          })
        },
        sourceFile ?? undefined,
        30
      )

      setQAPairs(pairs)
      setLog(p => [...p, `Generated ${pairs.length} QA pairs.`, 'Done.'])
      toast.success(`Generated ${pairs.length} QA pairs`)
      setTimeout(onNextQA, 600)
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setLog(p => [...p, 'Aborted.'])
      } else {
        setLog(p => [...p, `Error: ${e}`])
        toast.error(`QA generation failed: ${e}`)
      }
    } finally {
      setIsExtracting(false)
    }
  }

  const handleGenerateSysPrompt = async () => {
    if (!documentContent.trim()) { toast.error('Please paste or upload a document first'); return }
    setIsGenSysPrompt(true)
    setLog(p => [...p, 'Generating system prompt...'])
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const config: ModelConfig = { baseUrl, model, apiKey: getApiKey('tg_api_key') }
      const prompt = await generateSystemPrompt(documentContent, config, ctrl.signal, sourceFile ?? undefined)
      setAgentSystemPrompt(prompt)
      setLog(p => [...p, `System prompt generated (${prompt.length} chars)`])
      toast.success('System prompt generated')
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) toast.error(`Failed: ${e}`)
    } finally {
      setIsGenSysPrompt(false)
    }
  }

  const handleGenerateTools = async () => {
    if (!documentContent.trim()) { toast.error('Please paste or upload a document first'); return }
    setIsGenTools(true)
    setLog(p => [...p, 'Generating tool definitions...'])
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const config: ModelConfig = { baseUrl, model, apiKey: getApiKey('tg_api_key') }
      const tools = await generateToolDefinitions(
        documentContent, config, ctrl.signal, sourceFile ?? undefined,
        (msg) => setLog(p => [...p, msg])
      )
      if (tools.length > 0) setAgentToolsJson(JSON.stringify(tools, null, 2))
      setLog(p => [...p, `Tool definitions generated: ${tools.length} tool${tools.length !== 1 ? 's' : ''}`])
      toast.success(`${tools.length} tool${tools.length !== 1 ? 's' : ''} generated`)
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) toast.error(`Failed: ${e}`)
    } finally {
      setIsGenTools(false)
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const plainExts = ['.txt', '.md', '.markdown', '.csv']
    const imageExts = ['.png', '.jpg', '.jpeg', '.webp', '.gif']
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()

    setUploadedFilename(file.name)
    setSourceFile(file)

    if (plainExts.includes(ext)) {
      // Plain text — read directly in browser
      const reader = new FileReader()
      reader.onload = ev => {
        const text = ev.target?.result as string || ''
        setDocumentContent(text)
        handleDetectType(text, file)
      }
      reader.readAsText(file)
    } else if (imageExts.includes(ext)) {
      // Images — will be sent as base64 vision, no text to show
      setDocumentContent(`[Image: ${file.name} — will be sent as vision input]`)
    } else {
      // PDF, DOCX, JSON, etc — parse server-side to get real text
      // (model will also receive the original file via Files API if supported,
      //  but we always parse text as fallback)
      setIsParsing(true)
      try {
        const text = await parseDocumentFile(file)
        setDocumentContent(text)
        handleDetectType(text, file)
      } catch (err) {
        toast.error(`Could not parse file: ${err}`)
        setUploadedFilename(null)
        setSourceFile(null)
      } finally {
        setIsParsing(false)
      }
    }

    e.target.value = ''
  }

  const handleExtract = async () => {
    if (!documentContent.trim()) { toast.error('Please paste or upload a document first'); return }

    setIsExtracting(true)
    setLog(['Starting extraction...'])
    abortRef.current = new AbortController()

    try {
      const config: ModelConfig = {
        baseUrl,
        model,
        apiKey: getApiKey('tg_api_key'),
      }

      setLog(p => [...p, `Document: ${sourceFile ? sourceFile.name : documentContent.length.toLocaleString() + ' chars'} — preparing...`])

      // Run all 3 in parallel
      const [extractResult, systemPrompt, toolDefs] = await Promise.all([
        extractAtomicSubtasks(
          documentContent,
          config,
          abortRef.current.signal,
          (msg) => setLog(p => [...p, msg]),
          sourceFile ?? undefined
        ),
        generateSystemPrompt(
          documentContent,
          config,
          abortRef.current.signal,
          sourceFile ?? undefined
        ),
        generateToolDefinitions(
          documentContent,
          config,
          abortRef.current.signal,
          sourceFile ?? undefined,
          (msg) => setLog(p => [...p, msg])
        ),
      ])

      const { subtasks, detectedLanguage } = extractResult
      setAtomicSubtasks(subtasks)
      setDetectedLanguage(detectedLanguage)
      setAgentSystemPrompt(systemPrompt)
      if (toolDefs.length > 0) {
        setAgentToolsJson(JSON.stringify(toolDefs, null, 2))
      }
      setLog(p => [
        ...p,
        `Detected language: ${detectedLanguage}`,
        `Total: ${subtasks.length} atomic subtasks extracted`,
        `System prompt generated (${systemPrompt.length} chars)`,
        `Tool definitions generated: ${toolDefs.length} tool${toolDefs.length !== 1 ? 's' : ''}`,
        `Done.`,
      ])
      toast.success(`Extracted ${subtasks.length} subtasks, ${toolDefs.length} tools`)
      setTimeout(onNext, 800)
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setLog(p => [...p, 'Aborted.'])
      } else {
        setLog(p => [...p, `Error: ${e}`])
        toast.error(`Extraction failed: ${e}`)
      }
    } finally {
      setIsExtracting(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="bg-[var(--crab-bg-secondary)] border border-[var(--crab-border)] rounded-xl p-5">
        <h2 className="text-sm font-semibold text-[var(--crab-text)] mb-1">Document</h2>
        <p className="text-xs text-[var(--crab-text-muted)] mb-4">
          {detectedTaskType === 'rag_qa'
            ? <>Upload your knowledge document (FAQ, policy, guide…) to generate QA pairs. Supported: <span className="text-[var(--crab-text-secondary)]">{ACCEPTED_LABEL}</span></>
            : <>Paste the agent specification document, or upload a file. Supported: <span className="text-[var(--crab-text-secondary)]">{ACCEPTED_LABEL}</span></>
          }
        </p>
        <div className="flex items-center gap-2 mb-3">
          <label className={`cursor-pointer flex items-center gap-1.5 text-xs px-3 py-1.5 border border-[var(--crab-border-strong)] rounded-lg bg-[var(--crab-bg-secondary)] text-[var(--crab-text-secondary)] hover:border-[var(--crab-accent)] transition-colors ${isParsing ? 'opacity-50 pointer-events-none' : ''}`}>
            {isParsing
              ? <Loader2 size={12} className="animate-spin text-amber-500" />
              : <Upload size={12} />
            }
            {isParsing ? 'Parsing...' : 'Upload file'}
            <input
              type="file"
              accept={ACCEPTED_EXTS}
              className="hidden"
              onChange={handleFileUpload}
              disabled={isParsing}
            />
          </label>
          {uploadedFilename && !isParsing && (
            <span className="text-xs text-[var(--crab-text-secondary)] flex items-center gap-1">
              <Check size={11} className="text-emerald-500" />
              {uploadedFilename}
              <button
                onClick={() => {
                  setSourceFile(null)
                  setUploadedFilename(null)
                  setDocumentContent('')
                  setDetectedTaskType(null)
                }}
                className="ml-1 text-[var(--crab-text-muted)] hover:text-red-400 transition-colors"
              >
                <X size={11} />
              </button>
            </span>
          )}
          {documentContent && !isParsing && (
            <span className="text-xs text-[var(--crab-text-muted)]">
              {documentContent.length.toLocaleString()} chars
            </span>
          )}
          {/* Re-detect button — appears when document exists */}
          {documentContent.trim() && !isDetecting && !isExtracting && (
            <button
              onClick={() => handleDetectType(documentContent, sourceFile)}
              className="text-[10px] px-2 py-1 rounded border border-[var(--crab-border-strong)] text-[var(--crab-text-muted)] hover:border-[var(--crab-accent)] hover:text-[var(--crab-text-secondary)] flex items-center gap-1 transition-colors ml-auto"
            >
              <RefreshCw size={10} />
              Re-detect type
            </button>
          )}
        </div>
        <textarea
          value={documentContent}
          onChange={e => setDocumentContent(e.target.value)}
          rows={14}
          placeholder="Paste your agent specification document here..."
          className="w-full border border-[var(--crab-border-strong)] rounded-lg px-3 py-2.5 text-sm font-mono outline-none focus:ring-1 focus:ring-[var(--crab-accent)] resize-none text-[var(--crab-text)] placeholder:text-[var(--crab-text-muted)]"
        />
      </div>

      <div className="bg-[var(--crab-bg-secondary)] border border-[var(--crab-border)] rounded-xl p-5">
        <h2 className="text-sm font-semibold text-[var(--crab-text)] mb-4">
          {detectedTaskType === 'rag_qa' ? 'QA Generation Model' : 'Extraction Model'}
        </h2>
        <ModelConfigRow
          apiKeyName="tg_api_key"
          baseUrl={baseUrl}
          setBaseUrl={setBaseUrl}
          model={model}
          setModel={setModel}
        />
        <p className="text-[10px] text-[var(--crab-text-muted)] mt-2">API key stored in localStorage — persisted across sessions</p>
      </div>

      {/* Agent System Prompt — tool_calling only */}
      {detectedTaskType !== 'rag_qa' && (
      <div className="bg-[var(--crab-bg-secondary)] border border-[var(--crab-border)] rounded-xl p-5">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-[var(--crab-text)]">Agent System Prompt</h2>
          <div className="flex items-center gap-2">
            {agentSystemPrompt && (
              <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                <Check size={11} /> Auto-generated
              </span>
            )}
            <button
              onClick={handleGenerateSysPrompt}
              disabled={!documentContent.trim() || isGenSysPrompt || isExtracting}
              className="text-[10px] px-2 py-1 rounded border border-[var(--crab-border-strong)] text-[var(--crab-text-secondary)] hover:border-[var(--crab-accent)] hover:text-[var(--crab-text)] flex items-center gap-1 transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              {isGenSysPrompt ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
              {isGenSysPrompt ? 'Generating...' : 'Generate'}
            </button>
            {agentSystemPrompt && (
              <button
                onClick={() => setAgentSystemPrompt('')}
                className="text-[10px] text-[var(--crab-text-muted)] hover:text-red-500 flex items-center gap-1 transition-colors"
              >
                <X size={10} /> Clear
              </button>
            )}
          </div>
        </div>
        <p className="text-xs text-[var(--crab-text-muted)] mb-3">
          Paste your agent system prompt here, or click Generate to auto-generate one from the document.
          This will be used as the system prompt when running eval.
        </p>
        <textarea
          value={agentSystemPrompt}
          onChange={e => setAgentSystemPrompt(e.target.value)}
          rows={agentSystemPrompt ? 10 : 4}
          placeholder="Paste your agent system prompt here..."
          className="w-full border border-[var(--crab-border-strong)] rounded-lg px-3 py-2.5 text-xs font-mono outline-none focus:ring-1 focus:ring-[var(--crab-accent)] resize-y text-[var(--crab-text)] placeholder:text-[var(--crab-text-muted)]"
        />
      </div>
      )}

      {/* Tool Definitions — tool_calling only */}
      {detectedTaskType !== 'rag_qa' && (
      <div className="bg-[var(--crab-bg-secondary)] border border-[var(--crab-border)] rounded-xl p-5">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-[var(--crab-text)]">Tool Definitions <span className="font-normal text-[var(--crab-text-muted)]">(optional)</span></h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleGenerateTools}
              disabled={!documentContent.trim() || isGenTools || isExtracting}
              className="text-[10px] px-2 py-1 rounded border border-[var(--crab-border-strong)] text-[var(--crab-text-secondary)] hover:border-[var(--crab-accent)] hover:text-[var(--crab-text)] flex items-center gap-1 transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              {isGenTools ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
              {isGenTools ? 'Generating...' : 'Generate'}
            </button>
            {agentToolsJson && (
              <button
                onClick={() => { setAgentToolsJson(''); setToolsError(null) }}
                className="text-[10px] text-[var(--crab-text-muted)] hover:text-red-500 flex items-center gap-1 transition-colors"
              >
                <X size={10} /> Clear
              </button>
            )}
          </div>
        </div>
        <p className="text-xs text-[var(--crab-text-muted)] mb-3">
          Paste the OpenAI-format tool definitions JSON array, or click Generate to auto-generate from the document. These will be passed to the target model on every eval call so it can make function calls.
        </p>
        <textarea
          value={agentToolsJson}
          onChange={e => handleToolsChange(e.target.value)}
          rows={agentToolsJson ? 8 : 3}
          placeholder={'[\n  { "type": "function", "function": { "name": "...", "parameters": { ... } } }\n]'}
          className={`w-full border bg-[var(--crab-bg-tertiary)] rounded-lg px-3 py-2.5 text-xs font-mono outline-none focus:ring-1 resize-y text-[var(--crab-text)] placeholder:text-[var(--crab-text-muted)] ${
            toolsError
              ? 'border-red-300 focus:ring-red-400'
              : 'border-[var(--crab-border-strong)] focus:ring-[var(--crab-accent)]'
          }`}
        />
        {toolsError && (
          <p className="text-[10px] text-red-500 mt-1 flex items-center gap-1">
            <AlertTriangle size={10} /> {toolsError}
          </p>
        )}
        {agentToolsJson && !toolsError && (
          <p className="text-[10px] text-emerald-400 mt-1 flex items-center gap-1">
            <Check size={10} />
            {(() => { try { return (JSON.parse(agentToolsJson) as unknown[]).length } catch { return 0 } })()} tool{(() => { try { return (JSON.parse(agentToolsJson) as unknown[]).length !== 1 ? 's' : '' } catch { return 's' } })()} defined
          </p>
        )}
      </div>
      )}

      <div className="flex gap-2 flex-wrap items-center">
        {/* Detected type badge */}
        {isDetecting && (
          <span className="flex items-center gap-1.5 text-xs text-[var(--crab-text-muted)]">
            <Loader2 size={11} className="animate-spin text-amber-500" />
            Detecting document type...
          </span>
        )}
        {!isDetecting && detectedTaskType && (
          <div className="flex items-center gap-1.5">
            <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${
              detectedTaskType === 'rag_qa'
                ? 'bg-[var(--crab-accent-light)] text-[var(--crab-accent-hover)] border border-[var(--crab-accent-medium)]'
                : 'bg-[var(--crab-bg-tertiary)] text-[var(--crab-text-secondary)] border border-[var(--crab-border-strong)]'
            }`}>
              {detectedTaskType === 'rag_qa' ? 'QA / RAG doc' : 'Tool-Calling spec'}
            </span>
            <button
              disabled={isExtracting}
              onClick={() => {
                const next = detectedTaskType === 'rag_qa' ? 'tool_calling' : 'rag_qa'
                setDetectedTaskType(next)
                // Clear state belonging to the mode we're leaving
                if (detectedTaskType === 'rag_qa') {
                  setQAPairs([])
                  setQAProgress({ done: 0, total: 0 })
                } else {
                  setAtomicSubtasks([])
                  setCompositeTasks([])
                  setGeneratedTasks([])
                  setStats(null as never)
                  setAgentSystemPrompt('')
                  setAgentToolsJson('')
                }
              }}
              className="text-[10px] text-[var(--crab-text-muted)] hover:text-[var(--crab-text)] underline disabled:opacity-40 disabled:pointer-events-none"
            >
              switch
            </button>
          </div>
        )}

        {!isExtracting ? (
          detectedTaskType === 'rag_qa' ? (
            <Button
              onClick={handleExtractQA}
              disabled={!documentContent.trim()}
              className="bg-[var(--crab-accent)] text-[var(--crab-text)] hover:bg-[var(--crab-accent-hover)] flex items-center gap-2"
            >
              <FlaskConical size={14} />
              Generate QA Pairs
            </Button>
          ) : (
            <Button
              onClick={handleExtract}
              disabled={!documentContent.trim()}
              className="bg-[var(--crab-accent)] text-[var(--crab-text)] hover:bg-[var(--crab-accent-hover)] flex items-center gap-2"
            >
              <FlaskConical size={14} />
              Extract Subtasks
            </Button>
          )
        ) : (
          <Button
            variant="outline"
            onClick={() => abortRef.current?.abort()}
            className="border-red-500/30 text-red-400 hover:bg-red-500/10"
          >
            <X size={14} className="mr-1" /> Stop
          </Button>
        )}
      </div>

      {log.length > 0 && (
        <div className="bg-[var(--crab-bg-tertiary)] border border-[var(--crab-border-strong)] rounded-xl p-4">
          <h3 className="text-xs font-semibold text-[var(--crab-text-secondary)] mb-2">Log</h3>
          <div className="space-y-1">
            {log.map((line, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                {isExtracting && i === log.length - 1 ? (
                  <Loader2 size={11} className="animate-spin text-amber-500 mt-0.5 shrink-0" />
                ) : (
                  <span className="text-[var(--crab-text-muted)] shrink-0">→</span>
                )}
                <span className="text-[var(--crab-text-secondary)] font-mono">{line}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Step 2 (QA mode): Review QA Pairs ────────────────────────────────

const QA_INTENT_COLORS: Record<string, string> = {
  factoid:    'bg-sky-900/40 text-sky-300',
  procedural: 'bg-purple-900/40 text-purple-300',
  definition: 'bg-emerald-900/40 text-emerald-300',
  comparison: 'bg-orange-900/40 text-orange-300',
}

const QA_DIFFICULTY_COLORS: Record<string, string> = {
  easy:   'bg-emerald-900/40 text-emerald-300',
  medium: 'bg-amber-900/40 text-amber-300',
  hard:   'bg-red-900/40 text-red-300',
}

function QAPairRow({
  pair,
  onUpdate,
  onDelete,
}: {
  pair: QAPair
  onUpdate: (patch: Partial<QAPair>) => void
  onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [editingQ, setEditingQ] = useState(false)
  const [editingR, setEditingR] = useState(false)
  const [localQ, setLocalQ] = useState(pair.question)
  const [localR, setLocalR] = useState(pair.reference)

  return (
    <div className="border border-[var(--crab-border-strong)] rounded-xl overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-3 bg-[var(--crab-bg-secondary)] cursor-pointer hover:bg-[var(--crab-bg-hover)] transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <button onClick={e => { e.stopPropagation(); setExpanded(v => !v) }} className="text-[var(--crab-text-muted)] shrink-0">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${QA_DIFFICULTY_COLORS[pair.difficulty] || 'bg-[var(--crab-bg-tertiary)] text-[var(--crab-text-muted)]'}`}>
          {pair.difficulty}
        </span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${QA_INTENT_COLORS[pair.intent] || 'bg-[var(--crab-bg-tertiary)] text-[var(--crab-text-muted)]'}`}>
          {pair.intent}
        </span>

        <span className="flex-1 text-xs text-[var(--crab-text)] truncate font-medium">{pair.question}</span>

        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          className="text-[var(--crab-text-muted)] hover:text-red-500 transition-colors shrink-0 ml-1"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {expanded && (
        <div className="px-4 py-3 bg-[var(--crab-bg-tertiary)] space-y-3 border-t border-[var(--crab-border)]">
          {/* Question */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-semibold text-[var(--crab-text-muted)] uppercase tracking-wide">Question</span>
              <button
                onClick={() => {
                  if (editingQ) { onUpdate({ question: localQ }); setEditingQ(false) }
                  else setEditingQ(true)
                }}
                className="text-[10px] text-[var(--crab-accent)] hover:underline"
              >
                {editingQ ? 'Save' : 'Edit'}
              </button>
            </div>
            {editingQ ? (
              <textarea
                value={localQ}
                onChange={e => setLocalQ(e.target.value)}
                rows={3}
                className="w-full text-xs border border-[var(--crab-border-strong)] rounded-lg px-2 py-1.5 text-[var(--crab-text)] bg-[var(--crab-bg-secondary)] outline-none focus:ring-1 focus:ring-[var(--crab-accent)] resize-none font-mono"
              />
            ) : (
              <p className="text-xs text-[var(--crab-text-secondary)]">{pair.question}</p>
            )}
          </div>

          {/* Reference */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-semibold text-[var(--crab-text-muted)] uppercase tracking-wide">Reference Answer</span>
              <button
                onClick={() => {
                  if (editingR) { onUpdate({ reference: localR }); setEditingR(false) }
                  else setEditingR(true)
                }}
                className="text-[10px] text-[var(--crab-accent)] hover:underline"
              >
                {editingR ? 'Save' : 'Edit'}
              </button>
            </div>
            {editingR ? (
              <textarea
                value={localR}
                onChange={e => setLocalR(e.target.value)}
                rows={4}
                className="w-full text-xs border border-[var(--crab-border-strong)] rounded-lg px-2 py-1.5 text-[var(--crab-text)] bg-[var(--crab-bg-secondary)] outline-none focus:ring-1 focus:ring-[var(--crab-accent)] resize-none font-mono"
              />
            ) : (
              <p className="text-xs text-[var(--crab-text-secondary)]">{pair.reference}</p>
            )}
          </div>

          {/* Context snippet */}
          <div>
            <span className="text-[10px] font-semibold text-[var(--crab-text-muted)] uppercase tracking-wide block mb-1">Context (chunk)</span>
            <p className="text-[10px] text-[var(--crab-text-muted)] font-mono bg-[var(--crab-bg-secondary)] rounded p-2 line-clamp-3">
              {pair.context.slice(0, 300)}{pair.context.length > 300 ? '…' : ''}
            </p>
          </div>

          {/* Tags */}
          {pair.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {pair.tags.map((tag, i) => (
                <span key={i} className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{tag}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Step2QAReview({ onNext }: { onNext: () => void }) {
  const {
    qaPairs,
    updateQAPair,
    removeQAPair,
    sourceFile,
    documentContent,
  } = useTaskGeneratorStore()

  const byDifficulty = qaPairs.reduce<Record<string, number>>((acc, p) => {
    acc[p.difficulty] = (acc[p.difficulty] || 0) + 1
    return acc
  }, {})
  const byIntent = qaPairs.reduce<Record<string, number>>((acc, p) => {
    acc[p.intent] = (acc[p.intent] || 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-5">
      {/* Stats header */}
      <div className="bg-[var(--crab-bg-secondary)] border border-[var(--crab-border)] rounded-xl p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <span className="text-xl font-semibold text-[var(--crab-text)]">{qaPairs.length}</span>
            <span className="text-xs text-[var(--crab-text-secondary)] ml-1.5">QA pairs</span>
          </div>
          <div className="w-px h-4 bg-[var(--crab-bg-tertiary)] self-center" />
          {/* Difficulty breakdown */}
          <div className="flex items-center gap-1.5">
            {Object.entries(byDifficulty).map(([d, n]) => (
              <span key={d} className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${QA_DIFFICULTY_COLORS[d] || 'bg-[var(--crab-bg-tertiary)] text-[var(--crab-text-muted)]'}`}>
                {d}: {n}
              </span>
            ))}
          </div>
          <div className="w-px h-4 bg-[var(--crab-bg-tertiary)] self-center" />
          {/* Intent breakdown */}
          <div className="flex items-center gap-1.5">
            {Object.entries(byIntent).map(([i, n]) => (
              <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${QA_INTENT_COLORS[i] || 'bg-[var(--crab-bg-tertiary)] text-[var(--crab-text-muted)]'}`}>
                {i}: {n}
              </span>
            ))}
          </div>
          <div className="ml-auto">
            <span className="text-[10px] text-[var(--crab-text-muted)]">
              {sourceFile?.name || `${documentContent.length.toLocaleString()} chars`}
            </span>
          </div>
        </div>
      </div>

      {/* QA pairs list */}
      {qaPairs.length > 0 ? (
        <ScrollArea className="h-[540px] pr-1">
          <div className="space-y-2">
            {qaPairs.map(pair => (
              <QAPairRow
                key={pair.id}
                pair={pair}
                onUpdate={(patch) => updateQAPair(pair.id, patch)}
                onDelete={() => removeQAPair(pair.id)}
              />
            ))}
          </div>
        </ScrollArea>
      ) : (
        <div className="bg-[var(--crab-bg-secondary)] border border-[var(--crab-border)] rounded-xl p-10 text-center text-[var(--crab-text-muted)]">
          <CrawdAnim type="thinking" size={80} className="mb-3" />
          <p className="text-sm">No QA pairs yet. Go back to Step 1 and generate them.</p>
        </div>
      )}

      {qaPairs.length > 0 && (
        <div className="flex gap-2">
          <Button
            onClick={onNext}
            className="bg-[var(--crab-accent)] text-[var(--crab-text)] hover:bg-[var(--crab-accent-hover)] flex items-center gap-2"
          >
            Continue to Export
            <ChevronRight size={14} />
          </Button>
        </div>
      )}
    </div>
  )
}

// ── Step 2: Review Subtasks ────────────────────────────────────────────

function SubtaskRow({
  subtask,
  onUpdate,
  onDelete,
}: {
  subtask: AtomicSubtask
  onUpdate: (patch: Partial<AtomicSubtask>) => void
  onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [localName, setLocalName] = useState(subtask.name)
  const [localDesc, setLocalDesc] = useState(subtask.description)
  const [localCriteria, setLocalCriteria] = useState(subtask.assertionCriteria.join('\n'))

  const hasWarning = subtask.assertionCriteria.length === 0 || subtask.expectedTools.length === 0

  return (
    <div className={`border rounded-xl overflow-hidden ${hasWarning ? 'border-amber-200' : 'border-[var(--crab-border-strong)]'}`}>
      <div
        className="flex items-center gap-3 px-4 py-3 bg-[var(--crab-bg-secondary)] cursor-pointer hover:bg-[var(--crab-bg-hover)] transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <button
          onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
          className="text-[var(--crab-text-muted)] shrink-0"
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        <span className="font-mono text-[10px] text-[var(--crab-text-muted)] w-36 shrink-0 truncate">{subtask.id}</span>

        {editing ? (
          <input
            value={localName}
            onChange={e => setLocalName(e.target.value)}
            onClick={e => e.stopPropagation()}
            className="flex-1 border border-[var(--crab-border-strong)] rounded px-2 py-0.5 text-sm outline-none focus:ring-1 focus:ring-[var(--crab-accent)]"
          />
        ) : (
          <span className="flex-1 text-sm font-medium text-[var(--crab-text)] truncate">{subtask.name}</span>
        )}

        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${INTENT_COLORS[subtask.intent] || 'bg-gray-100 text-gray-600'}`}>
          {subtask.intent.replace(/_/g, ' ')}
        </span>

        <span className="text-xs text-[var(--crab-text-muted)] shrink-0 hidden sm:block truncate max-w-24">{subtask.skillRef}</span>

        <div className="flex items-center gap-1 shrink-0">
          {subtask.expectedTools.slice(0, 3).map((t, i) => (
            <span key={i} className="text-[10px] bg-[var(--crab-bg-tertiary)] text-[var(--crab-text-secondary)] px-1.5 py-0.5 rounded font-mono">
              {t.toolName}
            </span>
          ))}
          {subtask.expectedTools.length > 3 && (
            <span className="text-[10px] text-[var(--crab-text-muted)]">+{subtask.expectedTools.length - 3}</span>
          )}
        </div>

        {hasWarning && (
          <AlertTriangle size={13} className="text-amber-500 shrink-0" />
        )}

        <div className="flex gap-1 shrink-0" onClick={e => e.stopPropagation()}>
          {editing ? (
            <button
              onClick={() => {
                onUpdate({
                  name: localName,
                  description: localDesc,
                  assertionCriteria: localCriteria.split('\n').filter(Boolean),
                })
                setEditing(false)
              }}
              className="text-emerald-400 hover:text-emerald-700 p-1"
              title="Save"
            >
              <Check size={13} />
            </button>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="text-[var(--crab-text-muted)] hover:text-[var(--crab-text)] p-1"
              title="Edit"
            >
              <RefreshCw size={13} />
            </button>
          )}
          <button
            onClick={onDelete}
            className="text-[var(--crab-text-muted)] hover:text-red-500 p-1"
            title="Delete"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-2 bg-[var(--crab-bg-tertiary)] border-t border-[var(--crab-border-strong)] space-y-3">
          {editing ? (
            <>
              <div>
                <label className="text-[10px] text-[var(--crab-text-muted)] mb-1 block">Description</label>
                <input
                  value={localDesc}
                  onChange={e => setLocalDesc(e.target.value)}
                  className="w-full border border-[var(--crab-border-strong)] rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-[var(--crab-accent)]"
                />
              </div>
              <div>
                <label className="text-[10px] text-[var(--crab-text-muted)] mb-1 block">Assertion Criteria (one per line)</label>
                <textarea
                  value={localCriteria}
                  onChange={e => setLocalCriteria(e.target.value)}
                  rows={4}
                  className="w-full border border-[var(--crab-border-strong)] rounded px-2 py-1 text-xs font-mono outline-none focus:ring-1 focus:ring-[var(--crab-accent)] resize-none"
                />
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-[var(--crab-text-secondary)]">{subtask.description}</p>

              {subtask.assertionCriteria.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-[var(--crab-text-muted)] uppercase tracking-wide mb-1">Success Criteria</p>
                  <ul className="space-y-1">
                    {subtask.assertionCriteria.map((c, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-[var(--crab-text-secondary)]">
                        <Check size={11} className="text-emerald-500 mt-0.5 shrink-0" />
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {subtask.requiredInputs.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-[var(--crab-text-muted)] uppercase tracking-wide mb-1">Required Inputs</p>
                  <div className="flex flex-wrap gap-1.5">
                    {subtask.requiredInputs.map((p, i) => (
                      <div key={i} className="text-[10px] bg-[var(--crab-bg-secondary)] border border-[var(--crab-border)] rounded px-2 py-1">
                        <span className="font-mono font-medium text-[var(--crab-text)]">{p.name}</span>
                        <span className="text-[var(--crab-text-muted)]"> ({p.type})</span>
                        {p.sampleValues.length > 0 && (
                          <span className="text-[var(--crab-text-muted)]"> — e.g. {p.sampleValues[0]}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {subtask.dependsOn.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-[var(--crab-text-muted)] uppercase tracking-wide mb-1">Depends On</p>
                  <div className="flex gap-1.5">
                    {subtask.dependsOn.map((d, i) => (
                      <span key={i} className="text-[10px] font-mono bg-[var(--crab-bg-tertiary)] text-[var(--crab-text-secondary)] rounded px-1.5 py-0.5">{d}</span>
                    ))}
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

function Step2Review({ onNext }: { onNext: () => void }) {
  const { atomicSubtasks, updateSubtask, removeSubtask, addSubtask, detectedLanguage } = useTaskGeneratorStore()

  const skillCount = new Set(atomicSubtasks.map(s => s.skillRef)).size
  const toolCount = new Set(atomicSubtasks.flatMap(s => s.expectedTools.map(t => t.toolName))).size
  const warnings = atomicSubtasks.filter(s => s.assertionCriteria.length === 0 || s.expectedTools.length === 0).length

  const handleAddSubtask = () => {
    const newId = `custom_${Date.now()}`
    const s: AtomicSubtask = {
      id: newId,
      name: 'New Subtask',
      description: '',
      intent: 'action',
      skillRef: '',
      expectedTools: [],
      requiredInputs: [],
      optionalInputs: [],
      assertionCriteria: [],
      group: newId,
      dependsOn: [],
    }
    addSubtask(s)
  }

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      <div className="flex items-center gap-4 bg-[var(--crab-bg-secondary)] border border-[var(--crab-border)] rounded-xl px-5 py-3">
        <div className="text-sm">
          <span className="font-semibold text-[var(--crab-text)]">{atomicSubtasks.length}</span>
          <span className="text-[var(--crab-text-secondary)] ml-1">subtasks</span>
        </div>
        <div className="w-px h-4 bg-[var(--crab-bg-tertiary)]" />
        <div className="text-sm">
          <span className="font-semibold text-[var(--crab-text)]">{skillCount}</span>
          <span className="text-[var(--crab-text-secondary)] ml-1">skills covered</span>
        </div>
        <div className="w-px h-4 bg-[var(--crab-bg-tertiary)]" />
        <div className="text-sm">
          <span className="font-semibold text-[var(--crab-text)]">{toolCount}</span>
          <span className="text-[var(--crab-text-secondary)] ml-1">unique tools</span>
        </div>
        <div className="w-px h-4 bg-[var(--crab-bg-tertiary)]" />
        <div className="text-sm">
          <span className="font-semibold text-[var(--crab-text)]">{detectedLanguage}</span>
          <span className="text-[var(--crab-text-secondary)] ml-1">language</span>
        </div>
        <div className="flex-1" />
        {warnings > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-amber-600">
            <AlertTriangle size={13} />
            {warnings} subtask{warnings > 1 ? 's' : ''} with warnings
          </div>
        )}
      </div>

      {atomicSubtasks.length === 0 && (
        <div className="bg-[var(--crab-bg-secondary)] border border-[var(--crab-border)] rounded-xl p-10 text-center text-[var(--crab-text-muted)]">
          <CrawdAnim type="sleeping" size={80} className="mb-3" />
          <p className="text-sm">No subtasks yet. Go back to Step 1 to extract them.</p>
        </div>
      )}

      <ScrollArea className="h-[520px] pr-1">
        <div className="space-y-2">
          {atomicSubtasks.map(s => (
            <SubtaskRow
              key={s.id}
              subtask={s}
              onUpdate={patch => updateSubtask(s.id, patch)}
              onDelete={() => removeSubtask(s.id)}
            />
          ))}
        </div>
      </ScrollArea>

      <div className="flex gap-2">
        <button
          onClick={handleAddSubtask}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-dashed border-[var(--crab-border-strong)] rounded-lg text-[var(--crab-text-secondary)] hover:border-[var(--crab-accent)] hover:text-[var(--crab-text)] transition-colors"
        >
          <Plus size={12} /> Add Subtask
        </button>
        <div className="flex-1" />
        <Button
          onClick={onNext}
          disabled={atomicSubtasks.length === 0}
          className="bg-[var(--crab-accent)] text-[var(--crab-text)] hover:bg-[var(--crab-accent-hover)] flex items-center gap-2"
        >
          Continue to Compose
          <ArrowRight size={14} />
        </Button>
      </div>
    </div>
  )
}

// ── Step 3: Configure & Compose ────────────────────────────────────────

function DistributionChart({ data, title }: { data: Record<string, number>; title: string }) {
  const chartData = Object.entries(data).map(([key, value]) => ({
    name: key.replace(/_/g, ' '),
    value,
  }))

  if (chartData.length === 0) return null

  return (
    <div>
      <p className="text-xs font-semibold text-[var(--crab-text-secondary)] mb-2">{title}</p>
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
          <XAxis dataKey="name" tick={{ fontSize: 9, fill: 'var(--crab-text-muted)' }} />
          <YAxis tick={{ fontSize: 9, fill: 'var(--crab-text-muted)' }} />
          <Tooltip
            contentStyle={{ fontSize: '11px', background: '#201f1e', border: '1px solid rgba(216,211,197,0.20)', borderRadius: '8px', color: '#f7f5f0' }}
            itemStyle={{ color: '#b8b4a8' }}
            labelStyle={{ color: '#f7f5f0' }}
          />
          <Bar dataKey="value" radius={[3, 3, 0, 0]}>
            {chartData.map((_, i) => (
              <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function PersonaCheckbox({
  value,
  checked,
  onChange,
}: {
  value: UserPersona
  checked: boolean
  onChange: (v: boolean) => void
}) {
  const labels: Record<UserPersona, string> = {
    expert: 'Expert',
    novice: 'Novice',
    out_of_scope: 'Out of scope',
  }
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="w-3.5 h-3.5 accent-[var(--crab-accent)]"
      />
      <span className="text-xs text-[var(--crab-text)]">{labels[value]}</span>
    </label>
  )
}

function InfoLevelCheckbox({
  value,
  checked,
  onChange,
}: {
  value: InfoCompleteness
  checked: boolean
  onChange: (v: boolean) => void
}) {
  const labels: Record<InfoCompleteness, string> = {
    complete: 'Complete',
    partial: 'Partial',
    ambiguous: 'Ambiguous',
  }
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="w-3.5 h-3.5 accent-[var(--crab-accent)]"
      />
      <span className="text-xs text-[var(--crab-text)]">{labels[value]}</span>
    </label>
  )
}

function Step3Compose({ onNext }: { onNext: () => void }) {
  const {
    atomicSubtasks,
    composeOptions,
    setComposeOptions,
    compositeTasks,
    setCompositeTasks,
    setStats,
  } = useTaskGeneratorStore()

  const [composing, setComposing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCompose = () => {
    if (atomicSubtasks.length === 0) { toast.error('No subtasks to compose'); return }
    setComposing(true)
    setError(null)
    try {
      const tasks = composeCompositeTasks(atomicSubtasks, composeOptions)
      setCompositeTasks(tasks)

      // Compute preview stats
      const byDifficulty: Record<string, number> = {}
      const byPersona: Record<string, number> = {}
      for (const t of tasks) {
        byDifficulty[t.difficulty] = (byDifficulty[t.difficulty] || 0) + 1
        byPersona[t.persona] = (byPersona[t.persona] || 0) + 1
      }

      const stats = computeTaskSetStats(atomicSubtasks, tasks, [])
      setStats(stats)

      toast.success(`Composed ${tasks.length} tasks`)
    } catch (e) {
      setError(String(e))
      toast.error(`Compose failed: ${e}`)
    } finally {
      setComposing(false)
    }
  }

  const byDifficulty = compositeTasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.difficulty] = (acc[t.difficulty] || 0) + 1
    return acc
  }, {})

  const byPersona = compositeTasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.persona] = (acc[t.persona] || 0) + 1
    return acc
  }, {})

  const byIntent: Record<string, number> = {}
  const subtaskMap = new Map(atomicSubtasks.map(s => [s.id, s]))
  for (const t of compositeTasks) {
    for (const sid of t.subtaskIds) {
      const s = subtaskMap.get(sid)
      if (s) byIntent[s.intent] = (byIntent[s.intent] || 0) + 1
    }
  }

  const skillsInTasks = new Set(
    compositeTasks.flatMap(t => t.subtaskIds.map(sid => subtaskMap.get(sid)?.skillRef).filter(Boolean))
  )
  const allSkills = new Set(atomicSubtasks.map(s => s.skillRef))
  const skillCoverageOk = skillsInTasks.size >= allSkills.size

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* Left: Config */}
      <div className="space-y-5">
        <div className="bg-[var(--crab-bg-secondary)] border border-[var(--crab-border)] rounded-xl p-5">
          <h2 className="text-sm font-semibold text-[var(--crab-text)] mb-4">Composition Settings</h2>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-[var(--crab-text-secondary)] mb-1 block">
                Max steps per task: <span className="text-[var(--crab-text)] font-medium">{composeOptions.maxSteps}</span>
              </label>
              <input
                type="range"
                min={1}
                max={6}
                value={composeOptions.maxSteps}
                onChange={e => setComposeOptions({ maxSteps: Number(e.target.value) })}
                className="w-full accent-[var(--crab-accent)]"
              />
              <div className="flex justify-between text-[9px] text-[var(--crab-text-muted)]">
                <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span>
              </div>
            </div>

            <div>
              <label className="text-xs text-[var(--crab-text-secondary)] mb-2 block">Personas</label>
              <div className="space-y-1.5">
                {(['expert', 'novice', 'out_of_scope'] as UserPersona[]).map(p => (
                  <PersonaCheckbox
                    key={p}
                    value={p}
                    checked={composeOptions.personas.includes(p)}
                    onChange={checked => {
                      const next = checked
                        ? [...composeOptions.personas, p]
                        : composeOptions.personas.filter(x => x !== p)
                      setComposeOptions({ personas: next })
                    }}
                  />
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-[var(--crab-text-secondary)] mb-2 block">Info Levels</label>
              <div className="space-y-1.5">
                {(['complete', 'partial', 'ambiguous'] as InfoCompleteness[]).map(l => (
                  <InfoLevelCheckbox
                    key={l}
                    value={l}
                    checked={composeOptions.infoLevels.includes(l)}
                    onChange={checked => {
                      const next = checked
                        ? [...composeOptions.infoLevels, l]
                        : composeOptions.infoLevels.filter(x => x !== l)
                      setComposeOptions({ infoLevels: next })
                    }}
                  />
                ))}
              </div>
            </div>

            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={composeOptions.includeEdgeCases}
                  onChange={e => setComposeOptions({ includeEdgeCases: e.target.checked })}
                  className="w-3.5 h-3.5 accent-[var(--crab-accent)]"
                />
                <span className="text-xs text-[var(--crab-text)]">Include edge case tasks</span>
              </label>
            </div>

            <div>
              <label className="text-xs text-[var(--crab-text-secondary)] mb-1 block">Target task count</label>
              <input
                type="number"
                min={10}
                max={500}
                value={composeOptions.targetCount}
                onChange={e => setComposeOptions({ targetCount: Number(e.target.value) })}
                className="w-28 border border-[var(--crab-border-strong)] bg-[var(--crab-bg-tertiary)] rounded-lg px-3 py-2 text-sm text-[var(--crab-text)] placeholder-[var(--crab-text-muted)] outline-none focus:ring-1 focus:ring-[var(--crab-accent)]"
              />
            </div>

            <div>
              <label className="text-xs text-[var(--crab-text-secondary)] mb-1.5 block">Balance by</label>
              <div className="flex gap-3">
                {(['difficulty', 'intent', 'both'] as const).map(opt => (
                  <label key={opt} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="balanceBy"
                      value={opt}
                      checked={composeOptions.balanceBy === opt}
                      onChange={() => setComposeOptions({ balanceBy: opt })}
                      className="accent-[var(--crab-accent)]"
                    />
                    <span className="text-xs text-[var(--crab-text)] capitalize">{opt}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-700 flex items-start gap-2">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <Button
            onClick={handleCompose}
            disabled={composing || atomicSubtasks.length === 0}
            className="bg-[var(--crab-accent)] text-[var(--crab-text)] hover:bg-[var(--crab-accent-hover)] flex items-center gap-2"
          >
            {composing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Compose Tasks
          </Button>
          {compositeTasks.length > 0 && (
            <Button
              onClick={onNext}
              className="bg-[var(--crab-accent)] text-[var(--crab-text)] hover:bg-[var(--crab-accent-hover)] flex items-center gap-2"
            >
              Continue to Generate
              <ArrowRight size={14} />
            </Button>
          )}
        </div>
      </div>

      {/* Right: Preview */}
      <div className="space-y-4">
        {compositeTasks.length > 0 ? (
          <>
            <div className="bg-[var(--crab-bg-secondary)] border border-[var(--crab-border)] rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-[var(--crab-text)]">Preview</h2>
                <span className="text-xs text-[var(--crab-text-muted)]">{compositeTasks.length} tasks</span>
              </div>

              {!skillCoverageOk && (
                <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
                  <AlertTriangle size={12} />
                  Some skills from the document are not covered in the task set.
                </div>
              )}

              <div className="grid grid-cols-3 gap-4">
                <DistributionChart data={byDifficulty} title="By Difficulty" />
                <DistributionChart data={byPersona} title="By Persona" />
                <DistributionChart data={byIntent} title="By Intent" />
              </div>
            </div>

            <div className="bg-[var(--crab-bg-secondary)] border border-[var(--crab-border)] rounded-xl p-4">
              <h3 className="text-xs font-semibold text-[var(--crab-text-secondary)] mb-3">Sample Tasks</h3>
              <ScrollArea className="h-64">
                <div className="space-y-2">
                  {compositeTasks.slice(0, 20).map(t => (
                    <div key={t.id} className="flex items-center gap-2 text-xs py-1.5 border-b border-[var(--crab-border-subtle)] last:border-0">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${DIFFICULTY_COLORS[t.difficulty]}`}>
                        {t.difficulty}
                      </span>
                      <span className="text-[var(--crab-text-muted)] shrink-0 w-4 text-center">{t.numSteps}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${PERSONA_COLORS[t.persona]}`}>
                        {t.persona}
                      </span>
                      <span className="text-[var(--crab-text-secondary)] truncate">{t.name}</span>
                      {t.edgeCaseType && (
                        <span className="text-[9px] bg-gray-100 text-gray-600 px-1 py-0.5 rounded shrink-0">
                          {t.edgeCaseType.replace(/_/g, ' ')}
                        </span>
                      )}
                    </div>
                  ))}
                  {compositeTasks.length > 20 && (
                    <p className="text-xs text-[var(--crab-text-muted)] text-center py-2">
                      + {compositeTasks.length - 20} more tasks
                    </p>
                  )}
                </div>
              </ScrollArea>
            </div>
          </>
        ) : (
          <div className="bg-[var(--crab-bg-secondary)] border border-[var(--crab-border)] rounded-xl p-10 text-center text-[var(--crab-text-muted)]">
            <RefreshCw size={32} className="mx-auto mb-3" strokeWidth={1.2} />
            <p className="text-sm">Configure settings and click Compose Tasks.</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Step 4: Generate & Export ─────────────────────────────────────────

function GeneratedTaskRow({ task }: { task: GeneratedTask }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border border-[var(--crab-border-strong)] rounded-xl overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-3 bg-[var(--crab-bg-secondary)] cursor-pointer hover:bg-[var(--crab-bg-hover)] transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <button className="text-[var(--crab-text-muted)] shrink-0">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${DIFFICULTY_COLORS[task.difficulty]}`}>
          {task.difficulty}
        </span>
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${PERSONA_COLORS[task.persona]}`}>
          {task.persona}
        </span>
        <span className="flex-1 text-xs text-[var(--crab-text)] truncate">{task.userMessage}</span>
        <div className="flex gap-1 shrink-0">
          {task.tags.slice(0, 2).map((tag, i) => (
            <span key={i} className="text-[9px] bg-[var(--crab-bg-tertiary)] text-[var(--crab-text-secondary)] px-1.5 py-0.5 rounded">{tag}</span>
          ))}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-3 bg-[var(--crab-bg-tertiary)] border-t border-[var(--crab-border-strong)] space-y-3">
          <div>
            <p className="text-[10px] font-semibold text-[var(--crab-text-muted)] uppercase tracking-wide mb-1">User Message</p>
            <p className="text-xs text-[var(--crab-text)] leading-relaxed">{task.userMessage}</p>
          </div>
          {task.userMessageAlt && (
            <div>
              <p className="text-[10px] font-semibold text-[var(--crab-text-muted)] uppercase tracking-wide mb-1">Alternative Phrasing</p>
              <p className="text-xs text-[var(--crab-text-secondary)] leading-relaxed italic">{task.userMessageAlt}</p>
            </div>
          )}
          {task.expectedToolChain.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-[var(--crab-text-muted)] uppercase tracking-wide mb-1">Expected Tool Chain</p>
              <div className="flex gap-1 flex-wrap">
                {task.expectedToolChain.map((t, i) => (
                  <span key={i} className="text-[10px] font-mono bg-[var(--crab-bg-secondary)] border border-[var(--crab-border)] rounded px-1.5 py-0.5">{t}</span>
                ))}
              </div>
            </div>
          )}
          {task.assertionCriteria.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-[var(--crab-text-muted)] uppercase tracking-wide mb-1">Assertion Criteria</p>
              <ul className="space-y-0.5">
                {task.assertionCriteria.map((c, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-[var(--crab-text-secondary)]">
                    <Check size={10} className="text-emerald-500 mt-0.5 shrink-0" />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {task.edgeCaseType && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold text-[var(--crab-text-muted)] uppercase tracking-wide">Edge Case:</span>
              <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{task.edgeCaseType.replace(/_/g, ' ')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Step4Generate() {
  const router = useRouter()
  const { addDataset } = useDatasetsStore()
  const {
    compositeTasks,
    atomicSubtasks,
    detectedLanguage,
    agentSystemPrompt,
    agentToolsJson,
    generatedTasks,
    setGeneratedTasks,
    isGenerating,
    setIsGenerating,
    generateProgress,
    setGenerateProgress,
    stats,
    setStats,
    // QA mode
    qaPairs,
    detectedTaskType,
    sourceFile,
  } = useTaskGeneratorStore()

  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1')
  const [model, setModel] = useState('gpt-4o')
  const [copied, setCopied] = useState(false)
  const [isGeneratingArgs, setIsGeneratingArgs] = useState(false)
  const [argsProgress, setArgsProgress] = useState({ done: 0, total: 0 })
  const abortRef = useRef<AbortController | null>(null)

  const handleGenerate = async () => {
    if (compositeTasks.length === 0) { toast.error('No composite tasks to generate from'); return }

    setIsGenerating(true)
    setGenerateProgress({ done: 0, total: compositeTasks.length })
    abortRef.current = new AbortController()

    try {
      const config: ModelConfig = {
        baseUrl,
        model,
        apiKey: getApiKey('tg_api_key'),
      }

      const tasks = await generateNaturalLanguageQuestions(
        compositeTasks,
        atomicSubtasks,
        detectedLanguage,
        config,
        abortRef.current.signal,
        (done, total) => setGenerateProgress({ done, total })
      )

      setGeneratedTasks(tasks)
      const updatedStats = computeTaskSetStats(atomicSubtasks, compositeTasks, tasks)
      setStats(updatedStats)
      toast.success(`Generated ${tasks.length} tasks`)
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        toast.error(`Generation failed: ${e}`)
      }
    } finally {
      setIsGenerating(false)
    }
  }

  const handleGenerateArgs = async () => {
    if (generatedTasks.length === 0) { toast.error('No generated tasks'); return }

    setIsGeneratingArgs(true)
    setArgsProgress({ done: 0, total: generatedTasks.length })
    abortRef.current = new AbortController()

    try {
      const config: ModelConfig = {
        baseUrl,
        model,
        apiKey: getApiKey('tg_api_key'),
      }

      let parsedToolDefs: Array<{ type?: string; function?: { name: string; parameters?: { required?: string[] } } }> | undefined
      if (agentToolsJson.trim()) {
        try { parsedToolDefs = JSON.parse(agentToolsJson) } catch { /* ignore */ }
      }

      const updated = await generateExpectedToolCalls(
        generatedTasks,
        compositeTasks,
        atomicSubtasks,
        config,
        abortRef.current.signal,
        (done, total) => setArgsProgress({ done, total }),
        parsedToolDefs
      )

      setGeneratedTasks(updated)
      toast.success(`Generated tool call arguments for ${updated.length} tasks`)
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        toast.error(`Argument generation failed: ${e}`)
      }
    } finally {
      setIsGeneratingArgs(false)
    }
  }

  const handleExportJson = () => {
    const taskSet = {
      id: crypto.randomUUID(),
      name: 'Generated Task Set',
      createdAt: new Date().toISOString(),
      detectedLanguage,
      atomicSubtasks,
      compositeTasks,
      generatedTasks,
      stats,
    }
    const blob = new Blob([JSON.stringify(taskSet, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `task-set-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleSaveToServer = async () => {
    const taskSet = {
      id: crypto.randomUUID(),
      name: 'Generated Task Set',
      createdAt: new Date().toISOString(),
      detectedLanguage,
      atomicSubtasks,
      compositeTasks,
      generatedTasks,
      stats,
    }
    try {
      const res = await fetch('/api/task-generator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(taskSet),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast.success('Saved task set to server')
    } catch (e) {
      toast.error(`Save failed: ${e}`)
    }
  }

  const handleCopyScript = async () => {
    const messages = generatedTasks.map(t => t.userMessage)
    await navigator.clipboard.writeText(JSON.stringify(messages, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    toast.success('Copied replay script to clipboard')
  }

  const handleSendToRunEval = () => {
    // ── QA/RAG mode ──────────────────────────────────────────────────────
    if (detectedTaskType === 'rag_qa') {
      if (qaPairs.length === 0) { toast.error('No QA pairs to send'); return }

      const filename = sourceFile?.name ?? 'document'
      const records = qaPairs.map(qa => ({
        id: qa.id,
        input: qa.question,
        output: '',
        reference: qa.reference,
        context: qa.context,
        metadata: { difficulty: qa.difficulty, intent: qa.intent, tags: qa.tags },
      }))

      const dataset = {
        id: crypto.randomUUID(),
        filename: `qa-${Date.now()}.json`,
        uploadedAt: new Date().toISOString(),
        metadata: {
          task_name: `QA — ${filename}`,
          task_type: 'rag_qa',
          description: `QA dataset (${qaPairs.length} pairs)`,
          gt_metrics: ['faithfulness', 'answer_relevancy'],
          created_date: new Date().toISOString(),
          sampled_records: qaPairs.length,
        },
        data: records,
      }

      addDataset(dataset)
      toast.success(`Sent ${qaPairs.length} QA pairs to Run Eval`)
      router.push('/run')
      return
    }

    // ── Tool-calling / agent mode (original path) ─────────────────────
    if (generatedTasks.length === 0) { toast.error('No generated tasks to send'); return }

    // Parse tools JSON — silently ignore if invalid (validated in Step 1)
    let parsedTools: unknown[] | undefined
    if (agentToolsJson.trim()) {
      try { parsedTools = JSON.parse(agentToolsJson) } catch { /* ignore */ }
    }

    // Convert GeneratedTask[] → Dataset (DataRecord[]) format.
    // - input     = userMessage sent to the target agent
    // - reference = assertionCriteria joined by newline — used by criteria_score judge
    // - context   = agentSystemPrompt — evalRunner uses this as system prompt
    // - tools     = OpenAI tool definitions — passed to model on every call
    // - output    = '' filled by evalRunner after agent responds
    const records = generatedTasks.map(t => ({
      id: t.id,
      input: t.userMessage,
      output: '',
      reference: t.assertionCriteria.join('\n'),
      context: agentSystemPrompt || undefined,
      ...(parsedTools ? { tools: parsedTools } : {}),
      ...(t.expectedToolCalls !== undefined
        ? { expected_tool_calls: t.expectedToolCalls }
        : {}),
    }))

    const hasExpectedToolCalls = generatedTasks.some(t => t.expectedToolCalls !== undefined)

    const dataset = {
      id: crypto.randomUUID(),
      filename: `task-set-${Date.now()}.json`,
      uploadedAt: new Date().toISOString(),
      metadata: {
        task_name: `Task Generator — ${new Date().toLocaleDateString()}`,
        task_type: 'agent_eval',
        description: `Generated task set (${generatedTasks.length} tasks, ${detectedLanguage})`,
        gt_metrics: hasExpectedToolCalls
          ? ['criteria_score', 'tool_call_exact']
          : ['criteria_score'],
        created_date: new Date().toISOString(),
        sampled_records: generatedTasks.length,
      },
      data: records,
    }

    addDataset(dataset)
    toast.success(`Sent ${generatedTasks.length} tasks to Run Eval`)
    router.push('/run')
  }

  const progressPct = generateProgress.total > 0
    ? Math.round((generateProgress.done / generateProgress.total) * 100)
    : 0

  return (
    <div className="space-y-5">

      {/* ── QA/RAG mode: export panel ─────────────────────── */}
      {detectedTaskType === 'rag_qa' && (
        <div className="bg-[var(--crab-bg-secondary)] border border-[var(--crab-accent-medium)] rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--crab-text)]">QA / RAG Dataset</span>
            <span className="text-[10px] bg-[var(--crab-accent-light)] text-[var(--crab-accent-hover)] border border-[var(--crab-accent-medium)] px-2 py-0.5 rounded font-medium">
              {qaPairs.length} pairs ready
            </span>
          </div>
          <p className="text-xs text-[var(--crab-text-muted)]">
            Metrics: <span className="font-medium text-[var(--crab-text-secondary)]">faithfulness · answer_relevancy</span>
            <span className="ml-2 text-[var(--crab-text-muted)]">(LLM-as-judge — requires judge model)</span>
          </p>
          <div className="flex gap-2 flex-wrap">
            <Button
              onClick={handleSendToRunEval}
              disabled={qaPairs.length === 0}
              className="bg-[var(--crab-accent)] text-[var(--crab-text)] hover:bg-[var(--crab-accent-hover)] flex items-center gap-1.5"
            >
              <Play size={13} />
              Send to Run Eval ({qaPairs.length} pairs)
            </Button>
            <Button
              variant="outline"
              disabled={qaPairs.length === 0}
              onClick={() => {
                const filename = sourceFile?.name ?? 'document'
                const records = qaPairs.map(qa => ({
                  id: qa.id, input: qa.question, output: '', reference: qa.reference,
                  context: qa.context, metadata: { difficulty: qa.difficulty, intent: qa.intent, tags: qa.tags },
                }))
                const dataset = {
                  metadata: {
                    task_name: `QA — ${filename}`, task_type: 'rag_qa',
                    gt_metrics: ['faithfulness', 'answer_relevancy'],
                    created_date: new Date().toISOString(), sampled_records: qaPairs.length,
                  },
                  data: records,
                }
                const blob = new Blob([JSON.stringify(dataset, null, 2)], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a'); a.href = url
                a.download = `qa-${filename.replace(/\.[^.]+$/, '')}-${Date.now()}.json`
                a.click(); URL.revokeObjectURL(url)
                toast.success('QA dataset exported')
              }}
              className="flex items-center gap-1.5 text-xs border-[var(--crab-border-strong)] text-[var(--crab-text-secondary)] hover:text-[var(--crab-text)]"
            >
              <Download size={13} />
              Export JSON
            </Button>
            <Button
              variant="outline"
              disabled={qaPairs.length === 0}
              onClick={async () => {
                const questions = qaPairs.map(qa => qa.question)
                await navigator.clipboard.writeText(JSON.stringify(questions, null, 2))
                toast.success('Questions copied to clipboard')
              }}
              className="flex items-center gap-1.5 text-xs border-[var(--crab-border-strong)] text-[var(--crab-text-secondary)] hover:text-[var(--crab-text)]"
            >
              <Copy size={13} />
              Copy Questions
            </Button>
          </div>
        </div>
      )}

      {/* Model config */}
      <div className="bg-[var(--crab-bg-secondary)] border border-[var(--crab-border)] rounded-xl p-5">
        <h2 className="text-sm font-semibold text-[var(--crab-text)] mb-4">Generation Model</h2>
        <ModelConfigRow
          apiKeyName="tg_api_key"
          baseUrl={baseUrl}
          setBaseUrl={setBaseUrl}
          model={model}
          setModel={setModel}
        />
        <p className="text-[10px] text-[var(--crab-text-muted)] mt-2">
          Questions will be generated in: <span className="font-medium text-[var(--crab-text-secondary)]">{detectedLanguage}</span>
        </p>
      </div>

      {/* Generate button + progress + results — tool_calling only */}
      {detectedTaskType !== 'rag_qa' && (<>

      {/* Generate button + progress (tool-calling mode) */}
      <div className="flex items-center gap-3 flex-wrap">
        {!isGenerating ? (
          <Button
            onClick={handleGenerate}
            disabled={compositeTasks.length === 0}
            className="bg-[var(--crab-accent)] text-[var(--crab-text)] hover:bg-[var(--crab-accent-hover)] flex items-center gap-2"
          >
            <FlaskConical size={14} />
            Generate Questions ({compositeTasks.length} tasks)
          </Button>
        ) : (
          <Button
            variant="outline"
            onClick={() => abortRef.current?.abort()}
            className="border-red-500/30 text-red-400 hover:bg-red-500/10"
          >
            <X size={14} className="mr-1" /> Stop
          </Button>
        )}

        {generatedTasks.length > 0 && (
          <>
            <Button
              onClick={handleSendToRunEval}
              className="bg-[var(--crab-accent)] text-[var(--crab-text)] hover:bg-[var(--crab-accent-hover)] flex items-center gap-1.5"
            >
              <Play size={13} />
              Send to Run Eval
            </Button>
            <Button
              variant="outline"
              onClick={handleExportJson}
              className="flex items-center gap-1.5 text-xs border-[var(--crab-border-strong)] text-[var(--crab-text-secondary)] hover:text-[var(--crab-text)]"
            >
              <Download size={13} />
              Export JSON
            </Button>
            <Button
              variant="outline"
              onClick={handleSaveToServer}
              className="flex items-center gap-1.5 text-xs border-[var(--crab-border-strong)] text-[var(--crab-text-secondary)] hover:text-[var(--crab-text)]"
            >
              <Check size={13} />
              Save to Server
            </Button>
            <Button
              variant="outline"
              onClick={handleCopyScript}
              className="flex items-center gap-1.5 text-xs border-[var(--crab-border-strong)] text-[var(--crab-text-secondary)] hover:text-[var(--crab-text)]"
            >
              {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
              Copy Messages
            </Button>
          </>
        )}
      </div>

      {isGenerating && (
        <div className="bg-[var(--crab-bg-secondary)] border border-[var(--crab-border)] rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[var(--crab-text-secondary)] flex items-center gap-1.5">
              <Loader2 size={11} className="animate-spin text-amber-500" />
              Generating questions...
            </span>
            <span className="text-xs text-[var(--crab-text-muted)]">
              {generateProgress.done} / {generateProgress.total}
            </span>
          </div>
          <Progress value={progressPct} className="h-1.5" />
        </div>
      )}

      {/* Generate Tool Call Arguments — optional step for binary scoring */}
      {generatedTasks.length > 0 && !isGenerating && (
        <div className="bg-[var(--crab-bg-secondary)] border border-[var(--crab-border)] rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-[var(--crab-text)]">Generate Tool Call Arguments</p>
              <p className="text-[10px] text-[var(--crab-text-muted)] mt-0.5">
                Optional — enables binary <code className="text-amber-600">tool_call_exact</code> scoring. Tasks requiring clarification will get <code className="text-amber-600">expected_tool_calls: []</code>.
              </p>
            </div>
            {generatedTasks.some(t => t.expectedToolCalls !== undefined) && (
              <span className="text-[10px] text-emerald-600 font-medium">Done</span>
            )}
          </div>
          {!isGeneratingArgs ? (
            <Button
              onClick={handleGenerateArgs}
              variant="outline"
              className="flex items-center gap-1.5 text-xs border-[var(--crab-border-strong)] text-[var(--crab-text-secondary)] hover:text-[var(--crab-text)]"
            >
              <ArrowRight size={13} />
              Generate Tool Call Arguments
            </Button>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--crab-text-secondary)] flex items-center gap-1.5">
                  <Loader2 size={11} className="animate-spin text-amber-500" />
                  Generating arguments...
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--crab-text-muted)]">
                    {argsProgress.done} / {argsProgress.total}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => abortRef.current?.abort()}
                    className="h-6 px-2 text-[10px] border-red-500/30 text-red-400 hover:bg-red-500/10"
                  >
                    <X size={10} className="mr-1" /> Stop
                  </Button>
                </div>
              </div>
              <Progress
                value={argsProgress.total > 0 ? Math.round((argsProgress.done / argsProgress.total) * 100) : 0}
                className="h-1.5"
              />
            </div>
          )}
        </div>
      )}

      {/* Stats summary */}
      {stats && generatedTasks.length > 0 && (
        <div className="bg-[var(--crab-bg-secondary)] border border-[var(--crab-border)] rounded-xl p-4">
          <div className="flex flex-wrap gap-4">
            <div className="text-sm">
              <span className="font-semibold text-[var(--crab-text)]">{stats.totalTasks}</span>
              <span className="text-[var(--crab-text-secondary)] ml-1">tasks</span>
            </div>
            <div className="w-px h-4 bg-[var(--crab-bg-tertiary)] self-center" />
            <div className="text-sm">
              <span className="font-semibold text-[var(--crab-text)]">{stats.avgStepsPerTask}</span>
              <span className="text-[var(--crab-text-secondary)] ml-1">avg steps</span>
            </div>
            <div className="w-px h-4 bg-[var(--crab-bg-tertiary)] self-center" />
            <div className="text-sm">
              <span className="font-semibold text-[var(--crab-text)]">{Math.round(stats.skillCoverage * 100)}%</span>
              <span className="text-[var(--crab-text-secondary)] ml-1">skill coverage</span>
            </div>
            <div className="w-px h-4 bg-[var(--crab-bg-tertiary)] self-center" />
            <div className="text-sm">
              <span className="font-semibold text-[var(--crab-text)]">{Math.round(stats.toolCoverage * 100)}%</span>
              <span className="text-[var(--crab-text-secondary)] ml-1">tool coverage</span>
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {generatedTasks.length > 0 ? (
        <ScrollArea className="h-[520px] pr-1">
          <div className="space-y-2">
            {generatedTasks.map(task => (
              <GeneratedTaskRow key={task.id} task={task} />
            ))}
          </div>
        </ScrollArea>
      ) : (
        !isGenerating && compositeTasks.length > 0 && (
          <div className="bg-[var(--crab-bg-secondary)] border border-[var(--crab-border)] rounded-xl p-10 text-center text-[var(--crab-text-muted)]">
            <CrawdAnim type="thinking" size={80} className="mb-3" />
            <p className="text-sm">Click Generate Questions to create natural language test cases.</p>
          </div>
        )
      )}

      </>)} {/* end tool_calling only */}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────

export default function TaskGeneratorPage() {
  const { currentStep, setStep, atomicSubtasks, detectedTaskType, qaPairs, reset } = useTaskGeneratorStore()
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
  }, [])

  // Guard: if we're on a step that requires in-memory data that's been lost
  // (e.g. after a page reload), reset back to Step 1.
  useEffect(() => {
    if (!hydrated) return
    // For QA mode: step 2 is valid if qaPairs exist
    if (detectedTaskType === 'rag_qa') {
      if (currentStep >= 2 && qaPairs.length === 0) setStep(1)
    } else {
      if (currentStep >= 2 && atomicSubtasks.length === 0) setStep(1)
      if (currentStep >= 3 && atomicSubtasks.length === 0) setStep(1)
    }
  }, [hydrated, currentStep, atomicSubtasks.length, qaPairs.length, detectedTaskType, setStep])

  if (!hydrated) return null

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <FlaskConical size={20} className="text-[var(--crab-accent)]" strokeWidth={1.8} />
            <h1 className="text-2xl font-semibold text-[var(--crab-text)] tracking-tight">Task Generator</h1>
          </div>
          {(currentStep > 1 || atomicSubtasks.length > 0 || qaPairs.length > 0) && (
            <button
              onClick={() => {
                if (confirm('Reset everything and start over?')) reset()
              }}
              className="text-xs text-[var(--crab-text-muted)] hover:text-red-400 flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw size={12} />
              Start over
            </button>
          )}
        </div>
        <p className="text-[var(--crab-text-secondary)] text-sm mt-1">
          Generate diverse, difficulty-controlled test cases from any agent specification document.
        </p>
      </div>

      <Stepper current={currentStep} />

      {currentStep === 1 && (
        <Step1Extract
          onNext={() => setStep(2)}
          onNextQA={() => setStep(2)}
        />
      )}
      {currentStep === 2 && detectedTaskType === 'rag_qa' && (
        <Step2QAReview onNext={() => setStep(4)} />
      )}
      {currentStep === 2 && detectedTaskType !== 'rag_qa' && (
        <Step2Review onNext={() => setStep(3)} />
      )}
      {currentStep === 3 && (
        <Step3Compose onNext={() => setStep(4)} />
      )}
      {currentStep === 4 && (
        <Step4Generate />
      )}

      {/* Step navigation */}
      {currentStep > 1 && (
        <div className="mt-6 flex items-center gap-2">
          <button
            onClick={() => setStep(currentStep - 1)}
            className="text-xs text-[var(--crab-text-muted)] hover:text-[var(--crab-text)] flex items-center gap-1"
          >
            <ChevronRight size={12} className="rotate-180" />
            Back to {STEPS[currentStep - 2]?.label}
          </button>
        </div>
      )}
    </div>
  )
}
