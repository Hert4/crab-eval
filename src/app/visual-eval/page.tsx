'use client'
import { useState, useRef, useEffect } from 'react'
import { useConfigStore } from '@/store/configStore'
import { useVisualEvalStore } from '@/store/visualEvalStore'
import { startSimulation, stopSimulation, generateScenario, SimConfig, startBatchSimulation, BatchTargetModel } from '@/lib/visualEvalRunner'
import { getApiKey, setApiKey, OpenAIConfig, OpenAITool } from '@/lib/openai'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import { toast } from 'sonner'
import {
  Play, Square, RefreshCw, Upload, MessageSquare,
  Bot, User, Wrench, CheckCircle2, AlertCircle, Loader2,
  ChevronDown, ChevronUp, FileText, Sparkles, Settings, Download, X, Repeat2, ListChecks, Layers,
} from 'lucide-react'
import { SimulationTurn, SimulationResult, TaskResult } from '@/types'

// ── Export helpers ────────────────────────────────────────────────────
function exportAsJson(result: SimulationResult | null, turns: SimulationTurn[], scenarioName: string) {
  const payload = result ?? {
    scenarioName,
    turns,
    exportedAt: new Date().toISOString(),
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `visual-eval_${scenarioName.replace(/[^a-z0-9_-]/gi, '_').slice(0, 60)}_${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function exportAsMarkdown(result: SimulationResult | null, turns: SimulationTurn[], scenarioName: string) {
  const date = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const scoreLabel = result?.finalScore === null ? 'N/A' : `${result?.finalScore ?? '—'}%`
  const lines: string[] = [
    `# Visual Eval — ${scenarioName}`,
    ``,
    `**Date:** ${result?.date ?? date}  `,
    `**Model:** ${result?.targetModel ?? '—'}  `,
    `**Turns:** ${turns.length}  `,
    result ? `**Score:** ${scoreLabel}  ` : '',
    result ? `**Duration:** ${Math.round(result.durationMs / 1000)}s  ` : '',
    ``,
    result?.finalAssessment ? `> ${result.finalAssessment}` : '',
    ``,
    `---`,
    ``,
    `## Transcript`,
    ``,
  ]

  for (const turn of turns) {
    if (turn.role === 'tool') {
      lines.push(`**[Tool result · ${turn.tool_name}]**`)
      lines.push('```json')
      lines.push(turn.content)
      lines.push('```')
    } else {
      const label = turn.role === 'user' ? '**User**' : '**Target**'
      const timing = turn.durationMs !== undefined ? ` *(${turn.durationMs}ms)*` : ''
      lines.push(`${label}${timing}`)
      if (turn.tool_calls && turn.tool_calls.length > 0) {
        for (const tc of turn.tool_calls) {
          lines.push(`> *calls* \`${tc.function.name}(${tc.function.arguments.slice(0, 80)}${tc.function.arguments.length > 80 ? '…' : ''})\``)
        }
      }
      if (turn.content) lines.push(``, turn.content)
    }
    lines.push(``, `---`, ``)
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `visual-eval_${scenarioName.replace(/[^a-z0-9_-]/gi, '_').slice(0, 60)}_${new Date().toISOString().slice(0, 10)}.md`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Chat bubble ───────────────────────────────────────────────────────
function ChatBubble({ turn }: { turn: SimulationTurn }) {
  const [expanded, setExpanded] = useState(false)
  const isTool = turn.role === 'tool'
  const isUser = turn.role === 'user'
  const hasToolCalls = turn.tool_calls && turn.tool_calls.length > 0
  const longContent = turn.content.length > 300
  const display = longContent && !expanded ? turn.content.slice(0, 300) + '…' : turn.content

  if (isTool) {
    return (
      <div className="flex justify-center">
        <div className="max-w-[85%] w-full">
          <div className="flex items-center gap-1.5 mb-1 justify-center">
            <Wrench size={10} className="text-violet-400" />
            <span className="text-[10px] text-violet-400 font-semibold uppercase tracking-wider">
              Tool result · {turn.tool_name}
            </span>
          </div>
          <div className="text-[11px] font-mono bg-violet-50 border border-violet-100 rounded-lg px-3 py-2 text-violet-700 whitespace-pre-wrap break-all">
            {display}
            {longContent && (
              <button onClick={() => setExpanded(v => !v)}
                className="ml-1 text-[11px] text-violet-500 hover:underline inline-flex items-center gap-0.5">
                {expanded ? <><ChevronUp size={10} /> ít hơn</> : <><ChevronDown size={10} /> xem thêm</>}
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5 ${
        isUser ? 'bg-[#1A1A1A]' : 'bg-amber-100'
      }`}>
        {isUser
          ? <User size={13} className="text-white" />
          : <Bot size={13} className="text-amber-600" />}
      </div>

      {/* Bubble */}
      <div className={`flex flex-col max-w-[75%] ${isUser ? 'items-end' : 'items-start'}`}>
        <span className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${
          isUser ? 'text-[#9B9B9B]' : 'text-amber-600'
        }`}>
          {isUser ? 'User' : 'Target'}
          {turn.durationMs !== undefined && (
            <span className="ml-1.5 font-normal text-[#C4C4C3] normal-case tracking-normal">
              {turn.durationMs}ms
            </span>
          )}
        </span>

        {/* Tool calls chip (on assistant bubbles) */}
        {hasToolCalls && (
          <div className="mb-1.5 space-y-1 w-full">
            {turn.tool_calls!.map((tc, i) => (
              <div key={i} className="text-[11px] font-mono bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
                <span className="text-amber-700 font-semibold">{tc.function.name}</span>
                <span className="text-[#9B9B9B] ml-1">
                  ({tc.function.arguments.slice(0, 60)}{tc.function.arguments.length > 60 ? '…' : ''})
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Message content */}
        {turn.content && (
          <div className={`px-3.5 py-2.5 rounded-2xl ${
            isUser
              ? 'bg-[#1A1A1A] text-white rounded-tr-sm'
              : 'bg-white border border-[#E5E5E4] text-[#1A1A1A] rounded-tl-sm'
          }`}>
            {isUser ? (
              // User messages: plain text (usually short queries, no markdown needed)
              <p className="text-[13px] leading-relaxed" style={{ wordBreak: 'break-word' }}>
                {display}
                {longContent && (
                  <button onClick={() => setExpanded(v => !v)}
                    className="ml-1 text-[11px] text-gray-300 hover:underline inline-flex items-center gap-0.5">
                    {expanded ? <><ChevronUp size={10} /> ít hơn</> : <><ChevronDown size={10} /> xem thêm</>}
                  </button>
                )}
              </p>
            ) : (
              // Assistant messages: full markdown rendering
              <>
                <MarkdownRenderer content={display} />
                {longContent && (
                  <button onClick={() => setExpanded(v => !v)}
                    className="mt-1 text-[11px] text-amber-600 hover:underline inline-flex items-center gap-0.5">
                    {expanded ? <><ChevronUp size={10} /> ít hơn</> : <><ChevronDown size={10} /> xem thêm</>}
                  </button>
                )}
              </>
            )}
          </div>
        )}

      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────
export default function VisualEvalPage() {
  const appConfig = useConfigStore()
  const store = useVisualEvalStore()
  const {
    isRunning, isDone, turns, currentTurn, maxTurns, currentTask, taskTotal, statusText, finalResult, errorMessage,
    cfg, setCfg, resetTranscript, removeDocument,
    isBatchRunning, batchIndex, batchTotal, batchResults,
  } = store

  // Defer rendering until after hydration to avoid SSR/localStorage mismatch
  const [hydrated, setHydrated] = useState(false)

  // Local UI-only state (not worth persisting)
  const [toolsJsonError,    setToolsJsonError]    = useState('')
  const [generatingStatus,  setGeneratingStatus]  = useState('')
  const [generating,        setGenerating]        = useState(false)
  // showConfig and api keys are initialised AFTER hydration to avoid SSR mismatch
  const [showConfig,        setShowConfig]        = useState(true)
  const [userApiKeyState,   setUserApiKeyState]   = useState('')
  const [oracleApiKeyState, setOracleApiKeyState] = useState('')
  const [judgeApiKeyState,  setJudgeApiKeyState]  = useState('')
  const [showJudgeDebug,    setShowJudgeDebug]    = useState(false)

  // After hydration: read localStorage/sessionStorage and set correct initial values
  useEffect(() => {
    setHydrated(true)
    setShowConfig(!cfg.generated)
    setUserApiKeyState(getApiKey('visual_user_api_key'))
    setOracleApiKeyState(getApiKey('visual_oracle_api_key'))
    setJudgeApiKeyState(getApiKey('visual_judge_api_key'))
    // Init User Model defaults from app config if empty
    if (!cfg.userBaseUrl && (appConfig.judgeBaseUrl || appConfig.targetBaseUrl)) {
      setCfg({ userBaseUrl: appConfig.judgeBaseUrl || appConfig.targetBaseUrl })
    }
    if (!cfg.userModel && (appConfig.judgeModel || appConfig.targetModel)) {
      setCfg({ userModel: appConfig.judgeModel || appConfig.targetModel })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll chat to bottom
  const chatScrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!chatScrollRef.current) return
    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
  }, [turns.length])

  useEffect(() => {
    if (errorMessage && errorMessage !== 'Stopped by user') toast.error(errorMessage)
  }, [errorMessage])

  // ── File text extraction ──────────────────────────────────────────
  const extractText = async (file: File): Promise<string> => {
    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    if (['txt', 'md', 'csv', 'tsv', 'xml', 'html', 'htm', 'yaml', 'yml', 'log'].includes(ext)) {
      return new Promise((resolve, reject) => {
        const r = new FileReader(); r.onload = e => resolve((e.target?.result as string) || ''); r.onerror = reject; r.readAsText(file)
      })
    }
    if (ext === 'json') {
      return new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onload = e => { try { resolve(JSON.stringify(JSON.parse((e.target?.result as string) || ''), null, 2)) } catch { resolve((e.target?.result as string) || '') } }
        r.onerror = reject; r.readAsText(file)
      })
    }
    if (ext === 'docx') {
      const { default: JSZip } = await import('jszip')
      const zip = await JSZip.loadAsync(await file.arrayBuffer())
      const doc = zip.file('word/document.xml')
      if (!doc) throw new Error('No word/document.xml')
      const xml = await doc.async('string')
      return xml.replace(/<w:br[^/]*/gi, '\n').replace(/<w:p[ >][^>]*>/gi, '\n').replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim()
    }
    if (ext === 'pdf') throw new Error('PDF not supported. Convert to .txt first.')
    return new Promise((resolve, reject) => {
      const r = new FileReader(); r.onload = e => resolve((e.target?.result as string) || ''); r.onerror = reject; r.readAsText(file)
    })
  }

  // ── Upload & generate ─────────────────────────────────────────────
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    if (!cfg.userBaseUrl || !cfg.userModel) { toast.error('Configure User Model first'); return }
    try {
      setCfg({ fileName: file.name })
      const text = await extractText(file)
      setCfg({ fileText: text })
      await runGenerate(text, file.name)
    } catch (err) { toast.error(`Failed to read file: ${err}`); setGenerating(false) }
  }

  const runGenerate = async (text: string, fname: string) => {
    if (!(text ?? '').trim()) {
      toast.error('Re-upload the source document before generating again')
      return
    }
    if (userApiKeyState) setApiKey('visual_user_api_key', userApiKeyState)
    setGenerating(true)
    setCfg({ generated: false })
    setGeneratingStatus('Generating scenario (1/2)…')
    try {
      const userCfg: OpenAIConfig = {
        baseUrl: cfg.userBaseUrl,
        apiKey: getApiKey('visual_user_api_key'),
        model: cfg.userModel,
        maxTokens: 8000,
      }
      const result = await generateScenario(text, userCfg, undefined, setGeneratingStatus, cfg.numTasksInput)
      setCfg({
        scenarioName: fname.replace(/\.[^.]+$/, '').slice(0, 60),
        scenarioDesc: result.scenarioDescription,
        targetSysPrompt: result.targetSystemPrompt,
        toolsJson: JSON.stringify(result.tools, null, 2),
        mockContext: result.mockContext,
        tasksJson: JSON.stringify(result.tasks, null, 2),
        generated: true,
      })
      setToolsJsonError('')
      toast.success(`Scenario ready — ${result.tools.length} tool(s) extracted`)
      setShowConfig(false)  // collapse config, show chat area
    } catch (err) {
      toast.error(`Generation failed: ${err}`)
    } finally {
      setGenerating(false)
      setGeneratingStatus('')
    }
  }

  // ── Run simulation ────────────────────────────────────────────────
  const handleRun = async () => {
    if (!cfg.scenarioName.trim()) { toast.error('Scenario name required'); return }
    if (!cfg.scenarioDesc.trim()) { toast.error('Scenario description required'); return }
    if (!appConfig.targetBaseUrl || !appConfig.targetModel) { toast.error('Configure target model in Config page first'); return }
    if (!cfg.userBaseUrl || !cfg.userModel) { toast.error('Configure User Model'); return }
    if (userApiKeyState) setApiKey('visual_user_api_key', userApiKeyState)
    if (judgeApiKeyState) setApiKey('visual_judge_api_key', judgeApiKeyState)

    let parsedTools: OpenAITool[] = []
    const trimmed = cfg.toolsJson.trim()
    if (trimmed && trimmed !== '[]') {
      try {
        parsedTools = JSON.parse(trimmed)
        if (!Array.isArray(parsedTools)) { toast.error('Tools must be a JSON array'); return }
        setToolsJsonError('')
      } catch (e) {
        setToolsJsonError(`Invalid JSON: ${e}`)
        toast.error('Fix tools JSON before running'); return
      }
    }

    // Parse replay script if set
    let replayScript: string[] | undefined
    try {
      const parsed = JSON.parse(cfg.replayScript || '[]')
      if (Array.isArray(parsed) && parsed.length > 0) replayScript = parsed as string[]
    } catch { /* ignore */ }

    // Parse task list if set
    let taskList: string[] | undefined
    try {
      const parsed = JSON.parse(cfg.tasksJson || '[]')
      if (Array.isArray(parsed) && parsed.length > 0) taskList = parsed as string[]
    } catch { /* ignore */ }

    const simConfig: SimConfig = {
      scenarioName: cfg.scenarioName.trim(),
      scenarioDescription: cfg.scenarioDesc.trim(),
      targetSystemPrompt: cfg.targetSysPrompt.trim(),
      targetConfig: {
        baseUrl: appConfig.targetBaseUrl,
        model: appConfig.targetModel,
        maxTokens: appConfig.targetMaxTokens,
        temperature: appConfig.targetTemperature,
      },
      userConfig: { baseUrl: cfg.userBaseUrl, model: cfg.userModel, maxTokens: 2048 },
      oracleConfig: (cfg.oracleBaseUrl.trim() && cfg.oracleModel.trim())
        ? { baseUrl: cfg.oracleBaseUrl.trim(), model: cfg.oracleModel.trim(), maxTokens: 2048 }
        : undefined,
      judgeConfig: (cfg.judgeBaseUrl.trim() && cfg.judgeModel.trim())
        ? { baseUrl: cfg.judgeBaseUrl.trim(), model: cfg.judgeModel.trim() }
        : undefined,
      additionalJudges: (cfg.additionalJudges ?? [])
        .filter(j => j.baseUrl.trim() && j.model.trim())
        .map(j => ({ baseUrl: j.baseUrl.trim(), model: j.model.trim(), apiKeyName: j.apiKeyName || 'visual_judge_api_key' })),
      complianceRules: (() => {
        try { return cfg.complianceRulesJson ? JSON.parse(cfg.complianceRulesJson) : undefined } catch { return undefined }
      })(),
      maxTurns: cfg.maxTurnsInput,
      tools: parsedTools.length > 0 ? parsedTools : undefined,
      mockContext: cfg.mockContext || undefined,
      tasks: taskList,
      replayScript,
      scoringMode: cfg.scoringMode ?? 'hybrid',
    }

    await startSimulation(simConfig)
    toast.success(replayScript ? `Replay started (${replayScript.length} messages)` : 'Simulation started')
  }

  // ── Parse batch models from textarea ─────────────────────────────
  // Format: one model per line — "baseUrl|modelName" or just "modelName" (reuses target baseUrl)
  const parsedBatchModels: BatchTargetModel[] = (() => {
    return (cfg.batchModelsText ?? '')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const sep = line.indexOf('|')
        if (sep !== -1) {
          return { baseUrl: line.slice(0, sep).trim(), model: line.slice(sep + 1).trim() }
        }
        return { baseUrl: appConfig.targetBaseUrl, model: line }
      })
      .filter(m => m.model)
  })()

  // ── Run batch simulation ──────────────────────────────────────────
  const handleRunBatch = async () => {
    if (!cfg.scenarioName.trim()) { toast.error('Scenario name required'); return }
    if (!cfg.scenarioDesc.trim()) { toast.error('Scenario description required'); return }
    if (!cfg.userBaseUrl || !cfg.userModel) { toast.error('Configure User Model'); return }
    if (parsedBatchModels.length === 0) { toast.error('Add at least one model to the batch list'); return }
    if (userApiKeyState) setApiKey('visual_user_api_key', userApiKeyState)
    if (judgeApiKeyState) setApiKey('visual_judge_api_key', judgeApiKeyState)

    let parsedTools: OpenAITool[] = []
    const trimmed = cfg.toolsJson.trim()
    if (trimmed && trimmed !== '[]') {
      try {
        parsedTools = JSON.parse(trimmed)
        if (!Array.isArray(parsedTools)) { toast.error('Tools must be a JSON array'); return }
      } catch (e) { toast.error(`Fix tools JSON: ${e}`); return }
    }

    let replayScript: string[] | undefined
    try {
      const parsed = JSON.parse(cfg.replayScript || '[]')
      if (Array.isArray(parsed) && parsed.length > 0) replayScript = parsed as string[]
    } catch { /* ignore */ }

    let taskList: string[] | undefined
    try {
      const parsed = JSON.parse(cfg.tasksJson || '[]')
      if (Array.isArray(parsed) && parsed.length > 0) taskList = parsed as string[]
    } catch { /* ignore */ }

    const baseConfig = {
      scenarioName: cfg.scenarioName.trim(),
      scenarioDescription: cfg.scenarioDesc.trim(),
      targetSystemPrompt: cfg.targetSysPrompt.trim(),
      userConfig: { baseUrl: cfg.userBaseUrl, model: cfg.userModel, maxTokens: 2048 },
      oracleConfig: (cfg.oracleBaseUrl.trim() && cfg.oracleModel.trim())
        ? { baseUrl: cfg.oracleBaseUrl.trim(), model: cfg.oracleModel.trim(), maxTokens: 2048 }
        : undefined,
      judgeConfig: (cfg.judgeBaseUrl.trim() && cfg.judgeModel.trim())
        ? { baseUrl: cfg.judgeBaseUrl.trim(), model: cfg.judgeModel.trim() }
        : undefined,
      additionalJudges: (cfg.additionalJudges ?? [])
        .filter(j => j.baseUrl.trim() && j.model.trim())
        .map(j => ({ baseUrl: j.baseUrl.trim(), model: j.model.trim(), apiKeyName: j.apiKeyName || 'visual_judge_api_key' })),
      complianceRules: (() => {
        try { return cfg.complianceRulesJson ? JSON.parse(cfg.complianceRulesJson) : undefined } catch { return undefined }
      })(),
      maxTurns: cfg.maxTurnsInput,
      tools: parsedTools.length > 0 ? parsedTools : undefined,
      mockContext: cfg.mockContext || undefined,
      tasks: taskList,
      replayScript,
      runsPerModel: cfg.runsPerModel ?? 1,
      scoringMode: cfg.scoringMode ?? 'hybrid',
    }

    await startBatchSimulation(parsedBatchModels, baseConfig)
    toast.success(`Fair batch started — ${parsedBatchModels.length} models`)
  }

  const progressIndex = taskTotal > 0 ? currentTask : currentTurn
  const progressTotal = taskTotal > 0 ? taskTotal : maxTurns
  const progress = progressTotal > 0 ? Math.round((progressIndex / progressTotal) * 100) : 0
  const canRegenerate = Boolean((cfg.fileName ?? '').trim() && (cfg.fileText ?? '').trim())

  // Capture user-turn messages from current transcript for replay
  const captureReplayScript = () => {
    const userMessages = turns
      .filter(t => t.role === 'user')
      .map(t => t.content)
      .filter(Boolean)
    if (!userMessages.length) { toast.error('No user turns to capture'); return }
    setCfg({ replayScript: JSON.stringify(userMessages) })
    toast.success(`Captured ${userMessages.length} user messages as replay script`)
  }

  const clearReplayScript = () => {
    setCfg({ replayScript: '[]' })
    toast.success('Replay script cleared — next run will use User Model')
  }

  // Check if replay script is active
  let activeReplayCount = 0
  try {
    const parsed = JSON.parse(cfg.replayScript || '[]')
    if (Array.isArray(parsed)) activeReplayCount = parsed.length
  } catch { /* ignore */ }

  // Wait for client-side hydration before rendering (avoids localStorage/sessionStorage mismatch)
  if (!hydrated) return null

  return (
    <div className="flex h-full" style={{ height: '100vh' }}>

      {/* ── LEFT PANEL (fixed width, full height, scrollable internally) ── */}
      <div className="w-72 shrink-0 flex flex-col border-r border-[#E5E5E4] bg-white h-full">

        {/* Header */}
        <div className="shrink-0 px-4 pt-4 pb-3 border-b border-[#F3F3F2]">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-sm font-semibold text-[#1A1A1A]">Visual Eval</h1>
              <p className="text-[10px] text-[#9B9B9B] mt-0.5">Upload doc → simulate conversation</p>
            </div>
            <button onClick={() => setShowConfig(v => !v)}
              className={`p-1.5 rounded-lg transition-colors ${showConfig ? 'bg-amber-50 text-amber-600' : 'text-[#9B9B9B] hover:bg-[#F3F3F2]'}`}
              title="Toggle config">
              <Settings size={14} />
            </button>
          </div>
        </div>

        {/* Scrollable config area */}
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">

            {/* Config panel */}
            {showConfig && (
              <>
                {/* User Model */}
                <div>
                  <p className="text-[10px] font-semibold text-[#9B9B9B] uppercase tracking-wider mb-1.5">User Model</p>
                  <div className="space-y-1.5">
                    <input value={cfg.userBaseUrl} onChange={e => setCfg({ userBaseUrl: e.target.value })}
                      placeholder="Base URL" className="w-full text-xs border border-[#E5E5E4] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#1A1A1A]" />
                    <input value={cfg.userModel} onChange={e => setCfg({ userModel: e.target.value })}
                      placeholder="Model name" className="w-full text-xs border border-[#E5E5E4] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#1A1A1A]" />
                    <input type="password" value={userApiKeyState}
                      onChange={e => { setUserApiKeyState(e.target.value); setApiKey('visual_user_api_key', e.target.value) }}
                      placeholder="API Key" className="w-full text-xs border border-[#E5E5E4] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#1A1A1A]" />
                  </div>
                </div>

                {/* Oracle Model — dedicated tool faker */}
                <div>
                  <div className="flex items-center gap-1 mb-0.5">
                    <Wrench size={10} className="text-[#9B9B9B]" />
                    <p className="text-[10px] font-semibold text-[#9B9B9B] uppercase tracking-wider">Oracle Model</p>
                  </div>
                  <p className="text-[10px] text-[#9B9B9B] mb-1.5">Fake tool responses — leave blank to reuse User Model</p>
                  <div className="space-y-1.5">
                    <input value={cfg.oracleBaseUrl} onChange={e => setCfg({ oracleBaseUrl: e.target.value })}
                      placeholder="Base URL (blank = same as User)" className="w-full text-xs border border-[#E5E5E4] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#1A1A1A]" />
                    <input value={cfg.oracleModel} onChange={e => setCfg({ oracleModel: e.target.value })}
                      placeholder="Model name (blank = same as User)" className="w-full text-xs border border-[#E5E5E4] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#1A1A1A]" />
                    <input type="password" value={oracleApiKeyState}
                      onChange={e => { setOracleApiKeyState(e.target.value); setApiKey('visual_oracle_api_key', e.target.value) }}
                      placeholder="API Key (blank = same as User)" className="w-full text-xs border border-[#E5E5E4] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#1A1A1A]" />
                  </div>
                </div>

                {/* Judge Model — dedicated evaluator */}
                <div>
                  <div className="flex items-center gap-1 mb-0.5">
                    <CheckCircle2 size={10} className="text-[#9B9B9B]" />
                    <p className="text-[10px] font-semibold text-[#9B9B9B] uppercase tracking-wider">Judge Model</p>
                  </div>
                  <p className="text-[10px] text-[#9B9B9B] mb-1.5">Scores the transcript — leave blank to reuse User Model</p>
                  {!cfg.judgeModel.trim() && cfg.userModel.trim() && (
                    <div className="flex items-center gap-1 text-[10px] text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1 mb-1.5">
                      <AlertCircle size={10} />
                      <span>Judge = User Model — may introduce provider bias</span>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <input value={cfg.judgeBaseUrl} onChange={e => setCfg({ judgeBaseUrl: e.target.value })}
                      placeholder="Base URL (blank = same as User)" className="w-full text-xs border border-[#E5E5E4] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#1A1A1A]" />
                    <input value={cfg.judgeModel} onChange={e => setCfg({ judgeModel: e.target.value })}
                      placeholder="Model name (blank = same as User)" className="w-full text-xs border border-[#E5E5E4] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#1A1A1A]" />
                    <input type="password" value={judgeApiKeyState}
                      onChange={e => { setJudgeApiKeyState(e.target.value); setApiKey('visual_judge_api_key', e.target.value) }}
                      placeholder="API Key (blank = same as User)" className="w-full text-xs border border-[#E5E5E4] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#1A1A1A]" />
                  </div>

                  {/* Additional judges for multi-judge consensus (M2) */}
                  {(cfg.additionalJudges ?? []).length === 0 && (
                    <p className="text-[10px] text-[#9B9B9B] mt-1.5">Single judge — add 2+ for consensus scoring</p>
                  )}
                  {(cfg.additionalJudges ?? []).map((judge, i) => (
                    <div key={i} className="mt-2 border border-[#E5E5E4] rounded-lg p-2 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold text-[#9B9B9B] uppercase tracking-wider">Judge {i + 2}</span>
                        <button
                          onClick={() => setCfg({ additionalJudges: (cfg.additionalJudges ?? []).filter((_, idx) => idx !== i) })}
                          className="text-[10px] text-[#9B9B9B] hover:text-[#DC2626]"
                        >Remove</button>
                      </div>
                      <input
                        value={judge.baseUrl}
                        onChange={e => setCfg({ additionalJudges: (cfg.additionalJudges ?? []).map((j, idx) => idx === i ? { ...j, baseUrl: e.target.value } : j) })}
                        placeholder="Base URL" className="w-full text-xs border border-[#E5E5E4] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#1A1A1A]" />
                      <input
                        value={judge.model}
                        onChange={e => setCfg({ additionalJudges: (cfg.additionalJudges ?? []).map((j, idx) => idx === i ? { ...j, model: e.target.value } : j) })}
                        placeholder="Model name" className="w-full text-xs border border-[#E5E5E4] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#1A1A1A]" />
                      <input
                        value={judge.apiKeyName ?? ''}
                        onChange={e => setCfg({ additionalJudges: (cfg.additionalJudges ?? []).map((j, idx) => idx === i ? { ...j, apiKeyName: e.target.value } : j) })}
                        placeholder="API key name in sessionStorage" className="w-full text-xs border border-[#E5E5E4] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#1A1A1A]" />
                    </div>
                  ))}
                  {(cfg.additionalJudges ?? []).length < 2 && (
                    <button
                      onClick={() => setCfg({ additionalJudges: [...(cfg.additionalJudges ?? []), { baseUrl: '', model: '', apiKeyName: 'visual_judge_api_key_2', weight: 1 }] })}
                      className="mt-1.5 text-[10px] text-[#6B6B6B] hover:text-[#1A1A1A] border border-dashed border-[#E5E5E4] rounded-lg px-3 py-1 w-full text-center"
                    >+ Add Judge</button>
                  )}
                </div>

                {/* Upload */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[10px] font-semibold text-[#9B9B9B] uppercase tracking-wider">Business Document</p>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-[#9B9B9B]">Tasks to generate</span>
                      <input type="number" min={1} max={10} value={cfg.numTasksInput}
                        onChange={e => setCfg({ numTasksInput: Math.min(10, Math.max(1, parseInt(e.target.value) || 4)) })}
                        className="w-10 text-xs text-center border border-[#E5E5E4] rounded-lg px-1 py-1 focus:outline-none focus:ring-1 focus:ring-[#1A1A1A]" />
                    </div>
                  </div>
                  <label className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl p-4 cursor-pointer transition-colors ${
                    generating ? 'border-amber-300 bg-amber-50 cursor-not-allowed'
                      : cfg.fileName ? 'border-emerald-300 bg-emerald-50'
                      : 'border-[#E5E5E4] hover:border-[#D97706] hover:bg-amber-50/30'
                  }`}>
                    <input type="file" accept=".txt,.md,.json,.csv,.docx,.yaml,.yml,.xml,.html,.log"
                      className="sr-only" onChange={handleUpload} disabled={generating} />
                    {generating ? (
                      <><Loader2 size={18} className="animate-spin text-amber-500" />
                        <span className="text-[11px] text-amber-600 font-medium">{generatingStatus}</span></>
                    ) : cfg.fileName ? (
                      <><FileText size={18} className="text-emerald-500" />
                        <span className="text-[11px] text-emerald-600 font-medium truncate max-w-full px-1 text-center">{cfg.fileName}</span>
                        <span className="text-[10px] text-[#9B9B9B]">Click to replace</span></>
                    ) : (
                      <><Upload size={18} className="text-[#9B9B9B]" />
                        <span className="text-[11px] text-[#6B6B6B] font-medium">Drop or click to upload</span>
                        <span className="text-[10px] text-[#9B9B9B]">.txt · .md · .docx · .json · .csv</span></>
                    )}
                  </label>
                  {cfg.fileName && !generating && (
                    <div className="mt-1.5 flex gap-1.5">
                      <button onClick={() => runGenerate(cfg.fileText, cfg.fileName)} disabled={!canRegenerate}
                        className={`flex-1 flex items-center justify-center gap-1.5 text-[11px] py-1 rounded-lg transition-colors ${
                          canRegenerate
                            ? 'text-[#9B9B9B] hover:text-[#1A1A1A] hover:bg-[#F3F3F2]'
                            : 'text-[#C4C4C3] cursor-not-allowed'
                        }`}>
                        <Sparkles size={11} /> Re-generate
                      </button>
                      <button
                        onClick={() => { removeDocument(); setShowConfig(true) }}
                        title="Remove document"
                        className="flex items-center justify-center gap-1 text-[11px] text-red-400 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors">
                        <X size={11} /> Remove
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Scenario fields — always show if generated */}
            {cfg.generated && (
              <>
                <div>
                  <p className="text-[10px] font-semibold text-[#9B9B9B] uppercase tracking-wider mb-1.5">Scenario</p>
                  <div className="space-y-1.5">
                    <input value={cfg.scenarioName} onChange={e => setCfg({ scenarioName: e.target.value })}
                      placeholder="Name" className="w-full text-xs border border-[#E5E5E4] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#1A1A1A]" />
                    <textarea value={cfg.scenarioDesc} onChange={e => setCfg({ scenarioDesc: e.target.value })}
                      placeholder="User scenario description"
                      className="w-full text-xs border border-[#E5E5E4] rounded-lg px-3 py-2 resize-none h-20 focus:outline-none focus:ring-1 focus:ring-[#1A1A1A]" />
                    <textarea value={cfg.targetSysPrompt} onChange={e => setCfg({ targetSysPrompt: e.target.value })}
                      placeholder="Target system prompt (empty = Config page)"
                      className="w-full text-xs border border-[#E5E5E4] rounded-lg px-3 py-2 resize-none h-16 focus:outline-none focus:ring-1 focus:ring-[#1A1A1A]" />
                  </div>
                </div>

                {/* Target model + options */}
                <div>
                  <p className="text-[10px] font-semibold text-[#9B9B9B] uppercase tracking-wider mb-1.5">Target Model</p>
                  {appConfig.targetModel ? (
                    <div className="text-xs bg-[#F9F9F8] rounded-lg px-3 py-2 space-y-0.5 mb-2">
                      <div className="flex justify-between">
                        <span className="text-[#9B9B9B]">Model</span>
                        <span className="font-medium truncate max-w-[130px]">{appConfig.targetModel}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#9B9B9B]">Temp</span>
                        <span>{appConfig.targetTemperature}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs text-amber-600 mb-2">
                      <AlertCircle size={12} />
                      <span>Not configured — <a href="/config" className="underline">Config</a></span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#6B6B6B]">Max turns</span>
                    <input type="number" min={2} max={100} value={cfg.maxTurnsInput}
                      onChange={e => setCfg({ maxTurnsInput: Math.min(100, Math.max(2, parseInt(e.target.value) || 8)) })}
                      className="w-16 text-xs text-center border border-[#E5E5E4] rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#1A1A1A]" />
                  </div>
                </div>

                {/* Batch Models */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] font-semibold text-[#9B9B9B] uppercase tracking-wider flex items-center gap-1">
                      <Layers size={10} /> Batch Models
                    </p>
                    {parsedBatchModels.length > 0 && (
                      <span className="text-[10px] text-violet-600 font-medium bg-violet-50 px-1.5 py-0.5 rounded-full">
                        {parsedBatchModels.length} models
                      </span>
                    )}
                  </div>
                  <textarea
                    value={cfg.batchModelsText}
                    onChange={e => setCfg({ batchModelsText: e.target.value })}
                    spellCheck={false}
                    placeholder={'gpt-4.1-mini\nhttps://api.openai.com/v1|gpt-4.1\nhttps://my-api.com/v1|misa-ai-1.1'}
                    className="w-full text-[10px] font-mono border border-[#E5E5E4] rounded-lg px-3 py-2 resize-none h-20 focus:outline-none focus:ring-1 focus:ring-[#1A1A1A] leading-relaxed"
                  />
                  <p className="text-[10px] text-[#9B9B9B] mt-0.5">
                    One model per line. Format: <code className="text-amber-600">baseUrl|modelName</code> or just <code className="text-amber-600">modelName</code>.
                  </p>
                  <p className="text-[10px] text-violet-500 mt-0.5">
                    Batch fairness reuses one fixed replay script and shared cached tool results across models.
                  </p>
                  {/* Runs per model (M3) */}
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[10px] text-[#9B9B9B]">Runs / model:</span>
                    <input
                      type="number" min={1} max={10}
                      value={cfg.runsPerModel ?? 1}
                      onChange={e => setCfg({ runsPerModel: Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)) })}
                      className="w-14 text-xs text-center border border-[#E5E5E4] rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#1A1A1A]"
                    />
                    {(cfg.runsPerModel ?? 1) > 1 && (
                      <span className="text-[10px] text-[#9B9B9B]">Bootstrap CI enabled</span>
                    )}
                  </div>
                  {/* Scoring Mode (τ-bench style) */}
                  <div className="mt-1.5">
                    <span className="text-[10px] text-[#9B9B9B] block mb-1">Scoring mode:</span>
                    <div className="flex flex-col gap-1">
                      {([
                        ['hybrid', 'Hybrid (recommended) — 70% programmatic + 30% quality'],
                        ['programmatic', 'Programmatic only — binary pass/fail per task'],
                        ['judge_only', 'Judge only — LLM scoring (legacy)'],
                      ] as const).map(([value, label]) => (
                        <label key={value} className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name="scoringMode"
                            value={value}
                            checked={(cfg.scoringMode ?? 'hybrid') === value}
                            onChange={() => setCfg({ scoringMode: value })}
                            className="w-3 h-3 accent-[#1A1A1A]"
                          />
                          <span className="text-[10px] text-[#6B6B6B] select-none">{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Replay Script indicator */}                {activeReplayCount > 0 && (
                  <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center gap-1.5">
                        <Repeat2 size={11} className="text-blue-500" />
                        <span className="text-[10px] font-semibold text-blue-700 uppercase tracking-wider">Replay Mode</span>
                      </div>
                      <button onClick={clearReplayScript}
                        className="text-[10px] text-blue-400 hover:text-red-500 transition-colors" title="Clear replay script">
                        <X size={11} />
                      </button>
                    </div>
                    <p className="text-[10px] text-blue-600">
                      {activeReplayCount} fixed messages — User Model skipped
                    </p>
                    <p className="text-[10px] text-blue-400 mt-0.5">
                      All models get identical questions
                    </p>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] font-semibold text-[#9B9B9B] uppercase tracking-wider flex items-center gap-1">
                      <ListChecks size={10} /> Tasks
                    </p>
                    {(() => {
                      let count = 0
                      try { const a = JSON.parse(cfg.tasksJson); if (Array.isArray(a)) count = a.length } catch { /* */ }
                      return count > 0 ? (
                        <span className="text-[10px] text-blue-600 font-medium bg-blue-50 px-1.5 py-0.5 rounded-full">
                          {count} tasks
                        </span>
                      ) : null
                    })()}
                  </div>
                  <textarea value={cfg.tasksJson} onChange={e => setCfg({ tasksJson: e.target.value })}
                    spellCheck={false}
                    placeholder={'["Task 1: ...", "Task 2: ...", "Task 3: ..."]'}
                    className="w-full text-[10px] font-mono border border-[#E5E5E4] rounded-lg px-3 py-2 resize-none h-24 focus:outline-none focus:ring-1 focus:ring-[#1A1A1A] leading-relaxed" />
                  <p className="text-[10px] text-[#9B9B9B] mt-0.5">JSON array of task strings. User Model delivers them in order.</p>
                </div>

                {/* Tools */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] font-semibold text-[#9B9B9B] uppercase tracking-wider flex items-center gap-1">
                      <Wrench size={10} /> Tools
                    </p>
                    {(() => {
                      let count = 0
                      try { const a = JSON.parse(cfg.toolsJson); if (Array.isArray(a)) count = a.length } catch { /* */ }
                      return count > 0 ? (
                        <span className="text-[10px] text-emerald-600 font-medium bg-emerald-50 px-1.5 py-0.5 rounded-full">
                          {count} tools
                        </span>
                      ) : null
                    })()}
                  </div>
                  <textarea value={cfg.toolsJson} onChange={e => { setCfg({ toolsJson: e.target.value }); setToolsJsonError('') }}
                    spellCheck={false}
                    className={`w-full text-[10px] font-mono border rounded-lg px-3 py-2 resize-none h-32 focus:outline-none focus:ring-1 leading-relaxed ${
                      toolsJsonError ? 'border-red-300 focus:ring-red-400 bg-red-50' : 'border-[#E5E5E4] focus:ring-[#1A1A1A]'
                    }`} />
                  {toolsJsonError && <p className="text-[10px] text-red-500 mt-0.5">{toolsJsonError}</p>}
                </div>
              </>
            )}
          </div>
        </ScrollArea>

        {/* Bottom action bar */}
        <div className="shrink-0 px-4 py-3 border-t border-[#F3F3F2] space-y-2">
          {/* Progress */}
          {(isRunning || isDone || isBatchRunning) && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-[#9B9B9B] truncate max-w-[160px]">{statusText}</span>
                <span className="text-[10px] font-mono text-[#9B9B9B]">
                  {isDone ? '✓' : `${progressIndex}/${progressTotal}`}
                </span>
              </div>
              <Progress
                value={isDone ? 100 : progress}
                className="h-1"
              />
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-2">
            {(isDone && !isBatchRunning) && (
              <Button variant="ghost" size="sm" onClick={() => { resetTranscript(); setShowConfig(false) }}
                className="flex-1 text-xs text-[#9B9B9B] hover:text-[#1A1A1A] flex items-center gap-1.5">
                <RefreshCw size={11} /> New
              </Button>
            )}
            {(isRunning || isBatchRunning) ? (
              <Button size="sm" variant="outline" onClick={() => { stopSimulation(); toast('Stopped') }}
                className="flex-1 border-red-200 text-red-600 hover:bg-red-50 flex items-center gap-1.5 text-xs">
                <Square size={11} /> Stop
              </Button>
            ) : !isDone ? (
              <>
                <Button size="sm" onClick={handleRun}
                  disabled={!cfg.generated || generating}
                  className="flex-1 bg-[#1A1A1A] text-white hover:bg-[#333] flex items-center gap-1.5 text-xs disabled:opacity-40">
                  {activeReplayCount > 0
                    ? <><Repeat2 size={12} /> Replay ({activeReplayCount})</>
                    : <><Play size={12} /> Run</>
                  }
                </Button>
                {parsedBatchModels.length > 0 && (
                  <Button size="sm" onClick={handleRunBatch}
                    disabled={!cfg.generated || generating}
                    className="flex-1 bg-violet-600 text-white hover:bg-violet-700 flex items-center gap-1.5 text-xs disabled:opacity-40">
                    <Layers size={12} /> Batch ({parsedBatchModels.length})
                  </Button>
                )}
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── RIGHT: Chat window (fixed height, internal scroll) ─────────── */}
      <div className="flex-1 min-w-0 flex flex-col bg-[#F9F9F8] h-full">

        {/* Chat header */}
        <div className="shrink-0 px-4 py-2.5 border-b border-[#E5E5E4] bg-white flex items-center gap-2">
          <MessageSquare size={14} className="text-[#9B9B9B]" />
          <span className="text-xs font-semibold text-[#1A1A1A] flex-1 truncate">
            {cfg.scenarioName || 'Transcript'}
          </span>
          {activeReplayCount > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full shrink-0">
              <Repeat2 size={9} /> Replay
            </span>
          )}
          {turns.length > 0 && (
            <span className="text-[10px] text-[#9B9B9B] bg-[#F3F3F2] px-1.5 py-0.5 rounded-full shrink-0">{turns.length}</span>
          )}
          {turns.length > 0 && !isRunning && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => exportAsMarkdown(finalResult ?? null, turns, cfg.scenarioName || 'transcript')}
                title="Export Markdown"
                className="flex items-center gap-1 text-[10px] text-[#9B9B9B] hover:text-[#1A1A1A] px-2 py-1 rounded-lg hover:bg-[#F3F3F2] transition-colors">
                <Download size={11} /> MD
              </button>
              <button
                onClick={() => exportAsJson(finalResult ?? null, turns, cfg.scenarioName || 'transcript')}
                title="Export JSON"
                className="flex items-center gap-1 text-[10px] text-[#9B9B9B] hover:text-[#1A1A1A] px-2 py-1 rounded-lg hover:bg-[#F3F3F2] transition-colors">
                <Download size={11} /> JSON
              </button>
            </div>
          )}
          {isRunning && <Loader2 size={11} className="animate-spin text-amber-500 shrink-0" />}
        </div>

        {/* Messages — flex-1, overflow-y-auto, this is the scrollable chat pane */}
        <div ref={chatScrollRef} className="flex-1 overflow-y-auto">

          {/* Batch results summary panel */}
          {(isBatchRunning || (isDone && batchResults.length > 0)) && (
            <div className="px-5 pt-4 pb-2">
              <div className="bg-white border border-[#E5E5E4] rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-[#F9F9F8] border-b border-[#E5E5E4] flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Layers size={12} className="text-violet-500" />
                    <span className="text-[11px] font-semibold text-[#1A1A1A]">Batch Eval</span>
                    {isBatchRunning && (
                      <Loader2 size={10} className="animate-spin text-violet-500" />
                    )}
                  </div>
                  <span className="text-[10px] text-[#9B9B9B]">{batchResults.length}/{batchTotal} done</span>
                </div>
                <div className="divide-y divide-[#F3F3F2]">
                  {/* Completed results */}
                  {batchResults.map((r, i) => (
                    <div key={i} className="px-3 py-2 flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.status === 'done' ? 'bg-emerald-500' : 'bg-red-400'}`} />
                      <span className="text-xs font-medium text-[#1A1A1A] flex-1 truncate">{r.model}</span>
                      {r.status === 'done' ? (
                        <>
                          <span
                            className="text-xs font-bold tabular-nums"
                            style={{ color: r.avgScore === null ? '#6B7280' : r.avgScore >= 70 ? '#059669' : r.avgScore >= 50 ? '#D97706' : '#DC2626' }}
                          >
                            {r.avgScore === null ? 'N/A' : `${r.avgScore}%`}
                          </span>
                          <span className="text-[10px] text-[#9B9B9B] tabular-nums">{Math.round(r.durationMs / 1000)}s</span>
                        </>
                      ) : (
                        <span className="text-[10px] text-red-500 truncate max-w-[80px]">{r.error ?? 'error'}</span>
                      )}
                    </div>
                  ))}
                  {/* Currently running */}
                  {isBatchRunning && batchResults.length < batchTotal && (
                    <div className="px-3 py-2 flex items-center gap-2">
                      <Loader2 size={10} className="animate-spin text-violet-500 shrink-0" />
                      <span className="text-xs text-[#9B9B9B] flex-1 truncate">
                        {parsedBatchModels[batchIndex]?.model ?? '…'}
                      </span>
                      <span className="text-[10px] text-[#9B9B9B]">
                        {taskTotal > 0 ? `${currentTask}/${taskTotal}` : 'running'}
                      </span>
                    </div>
                  )}
                  {/* Pending */}
                  {isBatchRunning && parsedBatchModels.slice(batchResults.length + 1).map((m, i) => (
                    <div key={i} className="px-3 py-2 flex items-center gap-2 opacity-40">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#C4C4C3] shrink-0" />
                      <span className="text-xs text-[#9B9B9B] flex-1 truncate">{m.model}</span>
                      <span className="text-[10px] text-[#C4C4C3]">pending</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {turns.length === 0 && !isRunning ? (
            <div className="h-full flex flex-col items-center justify-center text-[#9B9B9B] px-8">
              <MessageSquare size={36} strokeWidth={1.2} className="mb-3" />
              <p className="text-sm font-medium text-[#6B6B6B] text-center">
                {cfg.generated ? 'Click Run Simulation to start' : 'Upload a business document to get started'}
              </p>
              <p className="text-xs mt-2 text-center max-w-xs leading-relaxed">
                {cfg.generated
                  ? `Scenario: "${cfg.scenarioName}" · ${JSON.parse(cfg.toolsJson || '[]').length || 0} tools ready`
                  : 'AI reads the document, generates a test scenario, then 2 models simulate a realistic conversation.'}
              </p>
            </div>
          ) : (
            <div className="px-5 py-4 space-y-4">
              {turns.map(t => <ChatBubble key={t.turnIndex} turn={t} />)}

              {/* Final result card */}
              {finalResult && (
                <div className="border border-emerald-200 bg-emerald-50 rounded-2xl p-4 mt-2">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                    <span className="text-sm font-semibold text-emerald-700 flex-1">Simulation Complete</span>
                    <span className="text-2xl font-bold text-emerald-600">
                      {finalResult.finalScore === null ? 'N/A' : `${finalResult.finalScore}%`}
                    </span>
                  </div>
                  <p className="text-xs text-[#4B4B4B] leading-relaxed">{finalResult.finalAssessment}</p>
                  {finalResult.evaluationStatus === 'unavailable' && (
                    <p className="text-[10px] text-amber-700 mt-1">
                      Hybrid evaluator could not produce a stable score for this run.
                    </p>
                  )}

                  {/* Per-task breakdown */}
                  {finalResult.taskResults && finalResult.taskResults.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[10px] font-semibold text-[#9B9B9B] uppercase tracking-wider">Task Breakdown</p>
                        {finalResult.scoringMode && finalResult.scoringMode !== 'judge_only' && (
                          <span className="text-[9px] text-violet-600 bg-violet-50 border border-violet-200 rounded px-1.5 py-0.5 font-medium">
                            {finalResult.scoringMode === 'hybrid' ? 'Hybrid' : 'Programmatic'} scoring
                          </span>
                        )}
                      </div>
                      {finalResult.programmaticScore !== undefined && finalResult.qualityScore !== undefined && (
                        <div className="flex gap-3 text-[10px] text-[#9B9B9B] mb-1.5">
                          <span>Programmatic: <span className="font-semibold text-[#1A1A1A]">{finalResult.programmaticScore}%</span></span>
                          <span>Quality: <span className="font-semibold text-[#1A1A1A]">{Math.round(finalResult.qualityScore)}%</span></span>
                        </div>
                      )}
                      {finalResult.taskResults.map((tr: TaskResult, i: number) => {
                        const statusColor = tr.status === 'completed' ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                          : tr.status === 'wrong' ? 'text-red-700 bg-red-50 border-red-200'
                          : tr.status === 'incomplete' ? 'text-amber-700 bg-amber-50 border-amber-200'
                          : 'text-[#9B9B9B] bg-[#F9F9F8] border-[#E5E5E4]'
                        const statusIcon = tr.status === 'completed' ? '✓'
                          : tr.status === 'wrong' ? '✗'
                          : tr.status === 'incomplete' ? '◑'
                          : '–'
                        return (
                          <div key={i} className={`rounded-lg border px-2.5 py-2 text-xs ${statusColor}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-start gap-1.5 flex-1 min-w-0">
                                <span className="font-bold shrink-0 mt-0.5">{statusIcon}</span>
                                <span className="font-medium leading-snug">{tr.task}</span>
                              </div>
                              <span className="shrink-0 font-bold">{tr.score}%</span>
                            </div>
                            {tr.note && <p className="text-[10px] mt-0.5 opacity-75 pl-4">{tr.note}</p>}
                            {/* Programmatic verification details */}
                            {tr.verification && (
                              <div className="pl-4 mt-1 space-y-0.5 text-[10px] opacity-80">
                                <span className="font-medium">
                                  behavior: {tr.verification.behaviorCorrect ? 'correct' : 'wrong'}
                                </span>
                                {tr.verification.actionResult && (
                                  <span className="ml-2">
                                    actions: {tr.verification.actionResult.matchedActions}/{tr.verification.actionResult.expectedActions}
                                  </span>
                                )}
                                {tr.verification.communicationResult && !tr.verification.communicationResult.allContained && (
                                  <span className="ml-2 text-red-600">
                                    missing: {tr.verification.communicationResult.missingTerms.slice(0, 2).join(', ')}
                                  </span>
                                )}
                              </div>
                            )}
                            {tr.breakdown && !tr.verification && (
                              <div className="pl-4 mt-1 flex flex-wrap gap-1.5 text-[10px] opacity-80">
                                <span>completion {tr.breakdown.completion}%</span>
                                <span>grounding {tr.breakdown.grounding}%</span>
                                {tr.breakdown.clarification !== null && <span>clarification {tr.breakdown.clarification}%</span>}
                                {tr.breakdown.toolUse !== null && <span>tool {tr.breakdown.toolUse}%</span>}
                                {tr.breakdown.toolTrace !== null && <span>trace {tr.breakdown.toolTrace}%</span>}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  <div className="flex gap-3 mt-2 text-[10px] text-[#9B9B9B]">
                    <span>{finalResult.turns.length} turns</span>
                    <span>{Math.round(finalResult.durationMs / 1000)}s</span>
                    <span className="truncate">{finalResult.targetModel}</span>
                  </div>
                  {/* Judge & Oracle metadata */}
                  {(finalResult.judgeModel || finalResult.oracleModel) && (
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[#9B9B9B]">
                      {finalResult.judgeModel && (
                        <span>judge: <span className="font-medium text-[#6B6B6B]">{finalResult.judgeModel}</span></span>
                      )}
                      {finalResult.oracleModel && (
                        <span>oracle: <span className="font-medium text-[#6B6B6B]">{finalResult.oracleModel}</span></span>
                      )}
                      {finalResult.toolsUsed && finalResult.toolsUsed.length > 0 && (
                        <span>{finalResult.toolsUsed.length} tools</span>
                      )}
                    </div>
                  )}
                  {activeReplayCount === 0 && (
                    <button
                      onClick={captureReplayScript}
                      className="mt-3 w-full flex items-center justify-center gap-1.5 text-[11px] text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-100 rounded-lg py-1.5 transition-colors"
                    >
                      <Repeat2 size={11} /> Use as Replay Script
                    </button>
                  )}
                  {/* Judge debug panel */}
                  {finalResult.evaluationDebug?.rawJudgeResponse && (
                    <div className="mt-2">
                      <button
                        onClick={() => setShowJudgeDebug(v => !v)}
                        className="flex items-center gap-1 text-[10px] text-[#9B9B9B] hover:text-[#6B6B6B] transition-colors"
                      >
                        {showJudgeDebug ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                        Judge response {showJudgeDebug ? '(hide)' : '(show)'}
                      </button>
                      {showJudgeDebug && (
                        <pre className="mt-1.5 text-[10px] font-mono bg-[#F9F9F8] border border-[#E5E5E4] rounded-lg px-3 py-2 overflow-x-auto whitespace-pre-wrap break-all text-[#6B6B6B] max-h-48 overflow-y-auto">
                          {finalResult.evaluationDebug.rawJudgeResponse}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
