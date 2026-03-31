'use client'
import { useState, useEffect } from 'react'
import { useConfigStore } from '@/store/configStore'
import { useAgentsStore } from '@/store/agentsStore'
import { AgentSelector } from '@/components/ui/AgentSelector'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { testConnection, getApiKey, setApiKey } from '@/lib/openai'
import { CheckCircle2, XCircle, Loader2, Settings, Bot, Link as LinkIcon } from 'lucide-react'
import Link from 'next/link'

const inputCls = 'w-full border border-[var(--crab-border-strong)] bg-[var(--crab-bg-tertiary)] rounded-lg px-3 py-2 text-sm text-[var(--crab-text)] placeholder-[var(--crab-text-muted)] outline-none focus:ring-1 focus:ring-[var(--crab-accent)] transition-colors'

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="text-xs font-medium text-[var(--crab-text-secondary)] mb-1 block">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-[var(--crab-text-muted)] mt-1">{hint}</p>}
    </div>
  )
}

export default function ConfigPage() {
  const config = useConfigStore()
  const { agents } = useAgentsStore()
  const [hydrated, setHydrated] = useState(false)

  // Agent selections (id → fills config fields on change)
  const [targetAgentId, setTargetAgentId] = useState('')
  const [judgeAgentId, setJudgeAgentId] = useState('')

  // Manual API key overrides (for when no agent selected)
  const [targetKey, setTargetKey] = useState('')
  const [judgeKey, setJudgeKey] = useState('')

  useEffect(() => {
    setTargetKey(getApiKey('target_api_key'))
    setJudgeKey(getApiKey('judge_api_key'))
    setHydrated(true)
  }, [])

  // When user picks a target agent → auto-fill config + key
  const handleTargetAgent = (id: string) => {
    setTargetAgentId(id)
    if (!id) return
    const a = agents.find(x => x.id === id)
    if (!a) return
    config.setTarget({
      targetBaseUrl: a.baseUrl,
      targetModel: a.model,
      targetMaxTokens: a.maxTokens,
      targetTemperature: a.temperature,
    })
    const key = getApiKey(a.apiKeyName)
    setTargetKey(key)
    setApiKey('target_api_key', key)
  }

  // When user picks a judge agent → auto-fill config + key
  const handleJudgeAgent = (id: string) => {
    setJudgeAgentId(id)
    if (!id) return
    const a = agents.find(x => x.id === id)
    if (!a) return
    config.setJudge({
      judgeBaseUrl: a.baseUrl,
      judgeModel: a.model,
    })
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

  const StatusIcon = ({ s }: { s: boolean | null }) => {
    if (s === null) return null
    return s ? <CheckCircle2 size={14} className="text-emerald-400" /> : <XCircle size={14} className="text-red-400" />
  }

  if (!hydrated) return null

  const hasAgents = agents.length > 0

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[var(--crab-text)] tracking-tight">Config</h1>
        <p className="text-[var(--crab-text-secondary)] text-sm mt-1">
          Configure API endpoints for evaluation and LLM-as-judge scoring.
        </p>
      </div>

      <div className="space-y-6">
        {/* Target model */}
        <div className="bg-[var(--crab-bg-secondary)] border border-[var(--crab-border)] rounded-xl p-6">
          <div className="flex items-center gap-2 mb-5">
            <Settings size={15} className="text-[var(--crab-text-muted)]" />
            <h2 className="text-sm font-semibold text-[var(--crab-text)]">Target Model</h2>
            <span className="text-xs text-[var(--crab-text-muted)]">— model being evaluated</span>
          </div>

          {/* Agent quick-pick */}
          {hasAgents ? (
            <div className="mb-4">
              <Field label="Quick-pick from Agents">
                <div className="flex gap-2">
                  <AgentSelector value={targetAgentId} onChange={handleTargetAgent} placeholder="Select agent to auto-fill…" />
                  {targetAgentId && (
                    <span className="flex items-center gap-1 text-xs text-emerald-400 shrink-0">
                      <Bot size={12} /> filled
                    </span>
                  )}
                </div>
              </Field>
            </div>
          ) : (
            <div className="mb-4 flex items-center gap-1.5 text-xs text-[var(--crab-text-muted)]">
              <Bot size={12} />
              <Link href="/agents" className="underline hover:text-[var(--crab-accent)]">Add agents</Link>
              <span>to enable quick-pick</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Field label="Base URL">
                <input type="text" value={config.targetBaseUrl} onChange={e => config.setTarget({ targetBaseUrl: e.target.value })} className={inputCls} placeholder="https://api.openai.com/v1" />
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="API Key" hint="Stored in localStorage — persisted across sessions">
                <div className="flex gap-2">
                  <input type="password" value={targetKey} onChange={e => setTargetKey(e.target.value)} className={`flex-1 ${inputCls.replace('w-full ', '')}`} placeholder="sk-..." />
                  <div className="flex items-center gap-1">
                    <StatusIcon s={targetStatus} />
                    <Button size="sm" variant="outline" onClick={testTarget} disabled={testingTarget}
                      className="text-xs h-9 border-[var(--crab-border-strong)] text-[var(--crab-text-secondary)] hover:bg-[var(--crab-bg-hover)] hover:text-[var(--crab-text)]">
                      {testingTarget ? <Loader2 size={12} className="animate-spin" /> : 'Test'}
                    </Button>
                  </div>
                </div>
              </Field>
            </div>
            <Field label="Model name">
              <input type="text" value={config.targetModel} onChange={e => config.setTarget({ targetModel: e.target.value })} className={inputCls} placeholder="gpt-4o-mini" />
            </Field>
            <Field label="Max tokens">
              <input type="number" value={config.targetMaxTokens} onChange={e => config.setTarget({ targetMaxTokens: Number(e.target.value) })} className={inputCls} />
            </Field>
            <Field label="Temperature">
              <input type="number" step={0.1} min={0} max={2} value={config.targetTemperature} onChange={e => config.setTarget({ targetTemperature: Number(e.target.value) })} className={inputCls} />
            </Field>
            <div className="col-span-2">
              <Field label="System prompt override" hint="If set, overrides the context field in each record. Leave empty to use record.context.">
                <textarea rows={3} value={config.targetSystemPrompt} onChange={e => config.setTarget({ targetSystemPrompt: e.target.value })} className={`${inputCls} resize-none`} placeholder="Optional system prompt…" />
              </Field>
            </div>
          </div>
        </div>

        {/* Judge model */}
        <div className="bg-[var(--crab-bg-secondary)] border border-[var(--crab-border)] rounded-xl p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Settings size={15} className="text-[var(--crab-text-muted)]" />
              <h2 className="text-sm font-semibold text-[var(--crab-text)]">Judge Model</h2>
              <span className="text-xs text-[var(--crab-text-muted)]">— LLM-as-judge for faithfulness & relevancy</span>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={config.judgeEnabled} onChange={e => config.setJudge({ judgeEnabled: e.target.checked })} className="accent-[var(--crab-accent)]" />
              <span className="text-xs text-[var(--crab-text-secondary)]">Enable</span>
            </label>
          </div>

          <div className={`space-y-4 transition-opacity ${config.judgeEnabled ? '' : 'opacity-40 pointer-events-none'}`}>
            {/* Agent quick-pick */}
            {hasAgents ? (
              <Field label="Quick-pick from Agents">
                <div className="flex gap-2">
                  <AgentSelector value={judgeAgentId} onChange={handleJudgeAgent} placeholder="Select agent to auto-fill…" />
                  {judgeAgentId && (
                    <span className="flex items-center gap-1 text-xs text-emerald-400 shrink-0">
                      <Bot size={12} /> filled
                    </span>
                  )}
                </div>
              </Field>
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-[var(--crab-text-muted)]">
                <Bot size={12} />
                <Link href="/agents" className="underline hover:text-[var(--crab-accent)]">Add agents</Link>
                <span>to enable quick-pick</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Field label="Base URL">
                  <input type="text" value={config.judgeBaseUrl} onChange={e => config.setJudge({ judgeBaseUrl: e.target.value })} className={inputCls} placeholder="https://api.openai.com/v1" />
                </Field>
              </div>
              <div className="col-span-2">
                <Field label="API Key" hint="Stored in localStorage — persisted across sessions">
                  <div className="flex gap-2">
                    <input type="password" value={judgeKey} onChange={e => setJudgeKey(e.target.value)} className={`flex-1 ${inputCls.replace('w-full ', '')}`} placeholder="sk-..." />
                    <div className="flex items-center gap-1">
                      <StatusIcon s={judgeStatus} />
                      <Button size="sm" variant="outline" onClick={testJudge} disabled={testingJudge}
                        className="text-xs h-9 border-[var(--crab-border-strong)] text-[var(--crab-text-secondary)] hover:bg-[var(--crab-bg-hover)] hover:text-[var(--crab-text)]">
                        {testingJudge ? <Loader2 size={12} className="animate-spin" /> : 'Test'}
                      </Button>
                    </div>
                  </div>
                </Field>
              </div>
              <div className="col-span-2">
                <Field label="Model name">
                  <input type="text" value={config.judgeModel} onChange={e => config.setJudge({ judgeModel: e.target.value })} className={inputCls} placeholder="gpt-4o" />
                </Field>
              </div>
            </div>
          </div>
        </div>

        <Button onClick={save} className="bg-[var(--crab-accent)] text-[var(--crab-text)] hover:bg-[var(--crab-accent-hover)] w-full">
          Save Config
        </Button>

        {!hasAgents && (
          <p className="text-center text-xs text-[var(--crab-text-muted)]">
            <LinkIcon size={10} className="inline mr-1" />
            Tip: <Link href="/agents" className="underline hover:text-[var(--crab-accent)]">Create agent profiles</Link> to quickly switch between models without re-entering credentials.
          </p>
        )}
      </div>
    </div>
  )
}
