'use client'
import { useState, useRef, useEffect } from 'react'
import { useConfigStore } from '@/store/configStore'
import { useVisualEvalStore } from '@/store/visualEvalStore'
import { startSimulation, stopSimulation, generateScenario, SimConfig } from '@/lib/visualEvalRunner'
import { getApiKey, setApiKey, OpenAIConfig, OpenAITool } from '@/lib/openai'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer'
import { toast } from 'sonner'
import {
  Play, Square, RefreshCw, Upload, MessageSquare,
  Bot, User, Wrench, CheckCircle2, AlertCircle, Loader2,
  ChevronDown, ChevronUp, FileText, Sparkles, Settings,
} from 'lucide-react'
import { SimulationTurn } from '@/types'

// ── Score badge ───────────────────────────────────────────────────────
function ScoreBadge({ scores }: { scores: NonNullable<SimulationTurn['scores']> }) {
  const avg = Math.round(((scores.relevancy + scores.accuracy + scores.helpfulness) / 3) * 10)
  const color = avg >= 80 ? 'text-emerald-600 bg-emerald-50' : avg >= 60 ? 'text-amber-600 bg-amber-50' : 'text-red-600 bg-red-50'
  return (
    <div className="flex items-center gap-1.5 mt-1">
      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${color}`}>{avg}%</span>
      <span className="text-[10px] text-[#C4C4C3]">R:{scores.relevancy} A:{scores.accuracy} H:{scores.helpfulness}</span>
    </div>
  )
}

// ── Chat bubble ───────────────────────────────────────────────────────
function ChatBubble({ turn }: { turn: SimulationTurn }) {
  const [expanded, setExpanded] = useState(false)
  const isTool = turn.role === 'tool'
  const isAssistant = turn.role === 'assistant'
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

        {turn.scores && <ScoreBadge scores={turn.scores} />}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────
export default function VisualEvalPage() {
  const appConfig = useConfigStore()
  const store = useVisualEvalStore()
  const { isRunning, isDone, turns, currentTurn, maxTurns, statusText, finalResult, errorMessage, cfg, setCfg, reset } = store

  // Local UI-only state (not worth persisting)
  const [toolsJsonError,   setToolsJsonError]   = useState('')
  const [generatingStatus, setGeneratingStatus] = useState('')
  const [generating,       setGenerating]       = useState(false)
  const [showConfig,       setShowConfig]       = useState(!cfg.generated)
  const [userApiKeyState,  setUserApiKeyState]  = useState(() => getApiKey('visual_user_api_key'))

  // Init User Model defaults from app config if empty
  useEffect(() => {
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

  // Open config panel when no scenario yet
  useEffect(() => {
    if (!cfg.generated && !isRunning && !isDone) setShowConfig(true)
  }, [cfg.generated, isRunning, isDone])

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
      const result = await generateScenario(text, userCfg, undefined, setGeneratingStatus)
      setCfg({
        scenarioName: fname.replace(/\.[^.]+$/, '').slice(0, 60),
        scenarioDesc: result.scenarioDescription,
        targetSysPrompt: result.targetSystemPrompt,
        toolsJson: JSON.stringify(result.tools, null, 2),
        mockContext: result.mockContext,
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
      maxTurns: cfg.maxTurnsInput,
      tools: parsedTools.length > 0 ? parsedTools : undefined,
      mockContext: cfg.mockContext || undefined,
    }

    await startSimulation(simConfig)
    toast.success('Simulation started')
  }

  const progress = maxTurns > 0 ? Math.round((currentTurn / maxTurns) * 100) : 0

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

                {/* Upload */}
                <div>
                  <p className="text-[10px] font-semibold text-[#9B9B9B] uppercase tracking-wider mb-1.5">Business Document</p>
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
                    <button onClick={() => runGenerate(cfg.fileText, cfg.fileName)}
                      className="mt-1.5 w-full flex items-center justify-center gap-1.5 text-[11px] text-[#9B9B9B] hover:text-[#1A1A1A] py-1">
                      <Sparkles size={11} /> Re-generate
                    </button>
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
                    <input type="number" min={2} max={20} value={cfg.maxTurnsInput}
                      onChange={e => setCfg({ maxTurnsInput: Math.min(20, Math.max(2, parseInt(e.target.value) || 8)) })}
                      className="w-16 text-xs text-center border border-[#E5E5E4] rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#1A1A1A]" />
                  </div>
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
          {(isRunning || isDone) && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-[#9B9B9B] truncate max-w-[160px]">{statusText}</span>
                <span className="text-[10px] font-mono text-[#9B9B9B]">{isDone ? '✓' : `${currentTurn}/${maxTurns}`}</span>
              </div>
              <Progress value={isDone ? 100 : progress} className="h-1" />
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-2">
            {isDone && (
              <Button variant="ghost" size="sm" onClick={() => { reset(); setShowConfig(true) }}
                className="flex-1 text-xs text-[#9B9B9B] hover:text-[#1A1A1A] flex items-center gap-1.5">
                <RefreshCw size={11} /> New
              </Button>
            )}
            {isRunning ? (
              <Button size="sm" variant="outline" onClick={() => { stopSimulation(); toast('Stopped') }}
                className="flex-1 border-red-200 text-red-600 hover:bg-red-50 flex items-center gap-1.5 text-xs">
                <Square size={11} /> Stop
              </Button>
            ) : !isDone ? (
              <Button size="sm" onClick={handleRun}
                disabled={!cfg.generated || generating}
                className="flex-1 bg-[#1A1A1A] text-white hover:bg-[#333] flex items-center gap-1.5 text-xs disabled:opacity-40">
                <Play size={12} /> Run Simulation
              </Button>
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
          {turns.length > 0 && (
            <span className="text-[10px] text-[#9B9B9B] bg-[#F3F3F2] px-1.5 py-0.5 rounded-full shrink-0">{turns.length}</span>
          )}
          {isRunning && <Loader2 size={11} className="animate-spin text-amber-500 shrink-0" />}
        </div>

        {/* Messages — flex-1, overflow-y-auto, this is the scrollable chat pane */}
        <div ref={chatScrollRef} className="flex-1 overflow-y-auto">
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
                    <span className="text-2xl font-bold text-emerald-600">{finalResult.finalScore}%</span>
                  </div>
                  <p className="text-xs text-[#4B4B4B] leading-relaxed">{finalResult.finalAssessment}</p>
                  <div className="flex gap-3 mt-2 text-[10px] text-[#9B9B9B]">
                    <span>{finalResult.turns.length} turns</span>
                    <span>{Math.round(finalResult.durationMs / 1000)}s</span>
                    <span className="truncate">{finalResult.targetModel}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
