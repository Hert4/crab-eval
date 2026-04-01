'use client'
import { useState, useEffect } from 'react'
import { useConfigStore } from '@/store/configStore'
import { useAgentsStore } from '@/store/agentsStore'
import { AgentSelector } from '@/components/ui/AgentSelector'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { testConnection, getApiKey, setApiKey } from '@/lib/openai'
import { CheckCircle2, XCircle, Loader2, Bot, Link as LinkIcon, Eye, EyeOff } from 'lucide-react'
import Link from 'next/link'

const inputCls = 'w-full border border-[var(--crab-border-strong)] bg-[var(--crab-bg-tertiary)] rounded-lg px-3 py-2 text-sm text-[var(--crab-text)] placeholder:text-[var(--crab-text-muted)] outline-none focus:ring-2 focus:ring-[var(--crab-accent)]/40 focus:border-[var(--crab-accent)] transition-all'

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium text-[var(--crab-text-secondary)] mb-1.5">{children}</p>
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] text-[var(--crab-text-muted)] mt-1">{children}</p>
}

function PasswordInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={inputCls + ' pr-9'}
      />
      <button
        type="button"
        onClick={() => setShow(v => !v)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--crab-text-muted)] hover:text-[var(--crab-text)] transition-colors"
      >
        {show ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
    </div>
  )
}

export default function ConfigPage() {
  const config = useConfigStore()
  const { agents } = useAgentsStore()
  const [hydrated, setHydrated] = useState(false)

  const [targetAgentId, setTargetAgentId] = useState('')
  const [judgeAgentId, setJudgeAgentId] = useState('')
  const [targetKey, setTargetKey] = useState('')
  const [judgeKey, setJudgeKey] = useState('')

  useEffect(() => {
    setTargetKey(getApiKey('target_api_key'))
    setJudgeKey(getApiKey('judge_api_key'))
    setHydrated(true)
  }, [])

  const handleTargetAgent = (id: string) => {
    setTargetAgentId(id)
    if (!id) return
    const a = agents.find(x => x.id === id)
    if (!a) return
    config.setTarget({ targetBaseUrl: a.baseUrl, targetModel: a.model, targetMaxTokens: a.maxTokens, targetTemperature: a.temperature })
    const key = getApiKey(a.apiKeyName)
    setTargetKey(key)
    setApiKey('target_api_key', key)
  }

  const handleJudgeAgent = (id: string) => {
    setJudgeAgentId(id)
    if (!id) return
    const a = agents.find(x => x.id === id)
    if (!a) return
    config.setJudge({ judgeBaseUrl: a.baseUrl, judgeModel: a.model })
    const key = getApiKey(a.apiKeyName)
    setJudgeKey(key)
    setApiKey('judge_api_key', key)
  }

  const [testingTarget, setTestingTarget] = useState(false)
  const [testingJudge, setTestingJudge] = useState(false)
  const [targetStatus, setTargetStatus] = useState<boolean | null>(null)
  const [judgeStatus, setJudgeStatus] = useState<boolean | null>(null)

  const save = () => {
    setApiKey('target_api_key', targetKey)
    setApiKey('judge_api_key', judgeKey)
    toast.success('Config saved')
  }

  const testTarget = async () => {
    setTestingTarget(true); setTargetStatus(null)
    const ok = await testConnection({ baseUrl: config.targetBaseUrl, apiKey: targetKey, model: config.targetModel })
    setTargetStatus(ok); setTestingTarget(false)
    toast(ok ? 'Connection successful' : 'Connection failed', { icon: ok ? '✅' : '❌' })
  }

  const testJudge = async () => {
    setTestingJudge(true); setJudgeStatus(null)
    const ok = await testConnection({ baseUrl: config.judgeBaseUrl, apiKey: judgeKey, model: config.judgeModel })
    setJudgeStatus(ok); setTestingJudge(false)
    toast(ok ? 'Connection successful' : 'Connection failed', { icon: ok ? '✅' : '❌' })
  }

  if (!hydrated) return null

  const hasAgents = agents.length > 0
  const hasConfig = !!(config.targetBaseUrl && config.targetModel)

  return (
    <div className="flex flex-col h-screen">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="shrink-0 px-8 pt-6 pb-5 border-b border-[var(--crab-border)] bg-[var(--crab-bg)]">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-[var(--crab-text)] tracking-tight">Config</h1>
            <p className="text-[var(--crab-text-muted)] text-xs mt-0.5">
              Configure target model and optional LLM judge.
            </p>
          </div>
          {!hasConfig && (
            <span className="text-[11px] px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
              Not configured
            </span>
          )}
          {hasConfig && (
            <span className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium flex items-center gap-1.5">
              <CheckCircle2 size={11} /> {config.targetModel}
            </span>
          )}
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-8 py-6 max-w-5xl mx-auto">
          <div className="grid grid-cols-2 gap-5">

            {/* ── Target Model ──────────────────────────── */}
            <div className="rounded-2xl border border-[var(--crab-border)] bg-[var(--crab-bg-secondary)] overflow-hidden">
              <div className="px-5 pt-5 pb-4 border-b border-[var(--crab-border-subtle)]">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-[var(--crab-accent-light)] border border-[var(--crab-accent-medium)] flex items-center justify-center shrink-0">
                    <span className="text-[var(--crab-accent)] text-xs font-bold">T</span>
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-[var(--crab-text)]">Target Model</h2>
                    <p className="text-[10px] text-[var(--crab-text-muted)]">The model being evaluated</p>
                  </div>
                </div>
              </div>

              <div className="px-5 py-4 space-y-4">
                {hasAgents && (
                  <div>
                    <Label>Quick-pick from Agents</Label>
                    <div className="flex gap-2">
                      <AgentSelector value={targetAgentId} onChange={handleTargetAgent} placeholder="Select agent to auto-fill…" />
                      {targetAgentId && (
                        <span className="flex items-center gap-1 text-[11px] text-emerald-400 shrink-0 font-medium">
                          <CheckCircle2 size={11} /> Filled
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {!hasAgents && (
                  <div className="flex items-center gap-1.5 text-xs text-[var(--crab-text-muted)] py-0.5">
                    <Bot size={12} />
                    <Link href="/agents" className="text-[var(--crab-accent)] hover:underline">Add agent profiles</Link>
                    <span>to enable quick-pick</span>
                  </div>
                )}

                <div>
                  <Label>Base URL</Label>
                  <input type="text" value={config.targetBaseUrl}
                    onChange={e => config.setTarget({ targetBaseUrl: e.target.value })}
                    className={inputCls} placeholder="https://api.openai.com/v1" />
                </div>

                <div>
                  <Label>API Key</Label>
                  <div className="flex gap-2">
                    <PasswordInput value={targetKey} onChange={v => setTargetKey(v)} placeholder="sk-..." />
                    <div className="flex items-center gap-1.5 shrink-0">
                      {targetStatus === true && <CheckCircle2 size={13} className="text-emerald-400" />}
                      {targetStatus === false && <XCircle size={13} className="text-red-400" />}
                      <Button size="sm" variant="outline" onClick={testTarget} disabled={testingTarget}
                        className="text-xs h-9 px-3 border-[var(--crab-border-strong)] text-[var(--crab-text-secondary)] hover:bg-[var(--crab-bg-hover)] hover:text-[var(--crab-text)]">
                        {testingTarget ? <Loader2 size={11} className="animate-spin" /> : 'Test'}
                      </Button>
                    </div>
                  </div>
                  <Hint>Stored in browser only — cleared when tab closes</Hint>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <Label>Model name</Label>
                    <input type="text" value={config.targetModel}
                      onChange={e => config.setTarget({ targetModel: e.target.value })}
                      className={inputCls} placeholder="gpt-4o" />
                  </div>
                  <div>
                    <Label>Temperature</Label>
                    <input type="number" step={0.1} min={0} max={2} value={config.targetTemperature}
                      onChange={e => config.setTarget({ targetTemperature: Number(e.target.value) })}
                      className={inputCls} />
                  </div>
                  <div className="col-span-3">
                    <Label>Max tokens</Label>
                    <input type="number" value={config.targetMaxTokens}
                      onChange={e => config.setTarget({ targetMaxTokens: Number(e.target.value) })}
                      className={inputCls} />
                  </div>
                </div>

                <div>
                  <Label>System prompt override</Label>
                  <textarea rows={3} value={config.targetSystemPrompt}
                    onChange={e => config.setTarget({ targetSystemPrompt: e.target.value })}
                    className={`${inputCls} resize-none`} placeholder="Optional — overrides record.context if set" />
                </div>
              </div>
            </div>

            {/* ── Judge Model ───────────────────────────── */}
            <div className={`rounded-2xl border bg-[var(--crab-bg-secondary)] overflow-hidden transition-all ${
              config.judgeEnabled ? 'border-[var(--crab-border)]' : 'border-[var(--crab-border)] opacity-80'
            }`}>
              <div className="px-5 pt-5 pb-4 border-b border-[var(--crab-border-subtle)]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 transition-all ${
                      config.judgeEnabled
                        ? 'bg-purple-900/40 border-purple-700/40'
                        : 'bg-[var(--crab-bg-tertiary)] border-[var(--crab-border-strong)]'
                    }`}>
                      <span className={`text-xs font-bold transition-colors ${config.judgeEnabled ? 'text-purple-300' : 'text-[var(--crab-text-muted)]'}`}>J</span>
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-[var(--crab-text)]">Judge Model</h2>
                      <p className="text-[10px] text-[var(--crab-text-muted)]">LLM-as-judge for faithfulness &amp; relevancy</p>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer select-none group">
                    <div className={`relative w-9 h-5 rounded-full transition-colors ${config.judgeEnabled ? 'bg-[var(--crab-accent)]' : 'bg-[var(--crab-bg-tertiary)] border border-[var(--crab-border-strong)]'}`}>
                      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${config.judgeEnabled ? 'left-4' : 'left-0.5'}`} />
                      <input type="checkbox" checked={config.judgeEnabled}
                        onChange={e => config.setJudge({ judgeEnabled: e.target.checked })}
                        className="sr-only" />
                    </div>
                    <span className="text-xs text-[var(--crab-text-secondary)]">Enable</span>
                  </label>
                </div>
              </div>

              <div className={`px-5 py-4 space-y-4 transition-opacity ${config.judgeEnabled ? '' : 'opacity-40 pointer-events-none'}`}>
                {hasAgents && (
                  <div>
                    <Label>Quick-pick from Agents</Label>
                    <div className="flex gap-2">
                      <AgentSelector value={judgeAgentId} onChange={handleJudgeAgent} placeholder="Select agent to auto-fill…" />
                      {judgeAgentId && (
                        <span className="flex items-center gap-1 text-[11px] text-emerald-400 shrink-0 font-medium">
                          <CheckCircle2 size={11} /> Filled
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {!hasAgents && (
                  <div className="flex items-center gap-1.5 text-xs text-[var(--crab-text-muted)] py-0.5">
                    <Bot size={12} />
                    <Link href="/agents" className="text-[var(--crab-accent)] hover:underline">Add agent profiles</Link>
                    <span>to enable quick-pick</span>
                  </div>
                )}

                <div>
                  <Label>Base URL</Label>
                  <input type="text" value={config.judgeBaseUrl}
                    onChange={e => config.setJudge({ judgeBaseUrl: e.target.value })}
                    className={inputCls} placeholder="https://api.openai.com/v1" />
                </div>

                <div>
                  <Label>API Key</Label>
                  <div className="flex gap-2">
                    <PasswordInput value={judgeKey} onChange={v => setJudgeKey(v)} placeholder="sk-..." />
                    <div className="flex items-center gap-1.5 shrink-0">
                      {judgeStatus === true && <CheckCircle2 size={13} className="text-emerald-400" />}
                      {judgeStatus === false && <XCircle size={13} className="text-red-400" />}
                      <Button size="sm" variant="outline" onClick={testJudge} disabled={testingJudge}
                        className="text-xs h-9 px-3 border-[var(--crab-border-strong)] text-[var(--crab-text-secondary)] hover:bg-[var(--crab-bg-hover)] hover:text-[var(--crab-text)]">
                        {testingJudge ? <Loader2 size={11} className="animate-spin" /> : 'Test'}
                      </Button>
                    </div>
                  </div>
                  <Hint>Stored in browser only — cleared when tab closes</Hint>
                </div>

                <div>
                  <Label>Model name</Label>
                  <input type="text" value={config.judgeModel}
                    onChange={e => config.setJudge({ judgeModel: e.target.value })}
                    className={inputCls} placeholder="gpt-4o" />
                </div>
              </div>

              {!config.judgeEnabled && (
                <div className="px-5 pb-5">
                  <p className="text-xs text-[var(--crab-text-muted)] bg-[var(--crab-bg-tertiary)] rounded-lg px-3 py-2.5 leading-relaxed">
                    Enable to score <span className="text-[var(--crab-text-secondary)]">faithfulness</span> and <span className="text-[var(--crab-text-secondary)]">answer_relevancy</span> metrics using an LLM judge.
                  </p>
                </div>
              )}
            </div>

          </div>

          {!hasAgents && (
            <p className="text-center text-xs text-[var(--crab-text-muted)] mt-5">
              <LinkIcon size={10} className="inline mr-1" />
              Tip: <Link href="/agents" className="text-[var(--crab-accent)] hover:underline">Create agent profiles</Link> to switch models quickly without re-entering credentials.
            </p>
          )}
        </div>
      </div>

      {/* ── Footer: Save ───────────────────────────────────── */}
      <div className="shrink-0 border-t border-[var(--crab-border)] px-8 py-4 bg-[var(--crab-bg)]">
        <div className="max-w-5xl mx-auto">
          <Button onClick={save}
            className="w-full h-10 bg-[var(--crab-accent)] text-[var(--crab-text)] hover:bg-[var(--crab-accent-hover)] font-medium text-sm">
            Save Config
          </Button>
        </div>
      </div>

    </div>
  )
}
