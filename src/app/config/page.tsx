'use client'
import { useState, useEffect } from 'react'
import { useConfigStore } from '@/store/configStore'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { testConnection, getApiKey, setApiKey } from '@/lib/openai'
import { CheckCircle2, XCircle, Loader2, Settings } from 'lucide-react'

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="text-xs font-medium text-[#6B6B6B] mb-1 block">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-[#9B9B9B] mt-1">{hint}</p>}
    </div>
  )
}

export default function ConfigPage() {
  const config = useConfigStore()
  const [hydrated, setHydrated] = useState(false)

  // API keys (sessionStorage only, not in zustand)
  const [targetKey, setTargetKey] = useState('')
  const [judgeKey, setJudgeKey] = useState('')

  useEffect(() => {
    setTargetKey(getApiKey('target_api_key'))
    setJudgeKey(getApiKey('judge_api_key'))
    setHydrated(true)
  }, [])

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
    setTestingTarget(true)
    setTargetStatus(null)
    const ok = await testConnection({
      baseUrl: config.targetBaseUrl,
      apiKey: targetKey,
      model: config.targetModel,
    })
    setTargetStatus(ok)
    setTestingTarget(false)
    toast(ok ? 'Connection successful' : 'Connection failed', { icon: ok ? '✅' : '❌' })
  }

  const testJudge = async () => {
    setTestingJudge(true)
    setJudgeStatus(null)
    const ok = await testConnection({
      baseUrl: config.judgeBaseUrl,
      apiKey: judgeKey,
      model: config.judgeModel,
    })
    setJudgeStatus(ok)
    setTestingJudge(false)
    toast(ok ? 'Connection successful' : 'Connection failed', { icon: ok ? '✅' : '❌' })
  }

  const StatusIcon = ({ s }: { s: boolean | null }) => {
    if (s === null) return null
    return s
      ? <CheckCircle2 size={14} className="text-emerald-500" />
      : <XCircle size={14} className="text-red-500" />
  }

  if (!hydrated) return null

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[#1A1A1A] tracking-tight">Config</h1>
        <p className="text-[#6B6B6B] text-sm mt-1">
          Configure API endpoints for evaluation and LLM-as-judge scoring.
        </p>
      </div>

      <div className="space-y-6">
        {/* Target model */}
        <div className="bg-white border border-[#E5E5E4] rounded-xl p-6">
          <div className="flex items-center gap-2 mb-5">
            <Settings size={15} className="text-[#9B9B9B]" />
            <h2 className="text-sm font-semibold text-[#1A1A1A]">Target Model</h2>
            <span className="text-xs text-[#9B9B9B]">— model being evaluated</span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Field label="Base URL">
                <input
                  type="text"
                  value={config.targetBaseUrl}
                  onChange={e => config.setTarget({ targetBaseUrl: e.target.value })}
                  className="w-full border border-[#E5E5E4] rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[#1A1A1A]"
                  placeholder="https://api.openai.com/v1"
                />
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="API Key" hint="Stored in sessionStorage only — cleared on tab close">
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={targetKey}
                    onChange={e => setTargetKey(e.target.value)}
                    className="flex-1 border border-[#E5E5E4] rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[#1A1A1A]"
                    placeholder="sk-..."
                  />
                  <div className="flex items-center gap-1">
                    <StatusIcon s={targetStatus} />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={testTarget}
                      disabled={testingTarget}
                      className="text-xs h-9"
                    >
                      {testingTarget ? <Loader2 size={12} className="animate-spin" /> : 'Test'}
                    </Button>
                  </div>
                </div>
              </Field>
            </div>
            <Field label="Model name">
              <input
                type="text"
                value={config.targetModel}
                onChange={e => config.setTarget({ targetModel: e.target.value })}
                className="w-full border border-[#E5E5E4] rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[#1A1A1A]"
                placeholder="gpt-4o-mini"
              />
            </Field>
            <Field label="Max tokens">
              <input
                type="number"
                value={config.targetMaxTokens}
                onChange={e => config.setTarget({ targetMaxTokens: Number(e.target.value) })}
                className="w-full border border-[#E5E5E4] rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[#1A1A1A]"
              />
            </Field>
            <Field label="Temperature">
              <input
                type="number"
                step={0.1}
                min={0}
                max={2}
                value={config.targetTemperature}
                onChange={e => config.setTarget({ targetTemperature: Number(e.target.value) })}
                className="w-full border border-[#E5E5E4] rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[#1A1A1A]"
              />
            </Field>
            <div className="col-span-2">
              <Field
                label="System prompt override"
                hint="If set, overrides the context field in each record. Leave empty to use record.context."
              >
                <textarea
                  rows={3}
                  value={config.targetSystemPrompt}
                  onChange={e => config.setTarget({ targetSystemPrompt: e.target.value })}
                  className="w-full border border-[#E5E5E4] rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[#1A1A1A] resize-none"
                  placeholder="Optional system prompt…"
                />
              </Field>
            </div>
          </div>
        </div>

        {/* Judge model */}
        <div className="bg-white border border-[#E5E5E4] rounded-xl p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Settings size={15} className="text-[#9B9B9B]" />
              <h2 className="text-sm font-semibold text-[#1A1A1A]">Judge Model</h2>
              <span className="text-xs text-[#9B9B9B]">— LLM-as-judge for faithfulness & relevancy</span>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={config.judgeEnabled}
                onChange={e => config.setJudge({ judgeEnabled: e.target.checked })}
                className="accent-[#D97706]"
              />
              <span className="text-xs text-[#6B6B6B]">Enable</span>
            </label>
          </div>

          <div className={`grid grid-cols-2 gap-4 transition-opacity ${config.judgeEnabled ? '' : 'opacity-40 pointer-events-none'}`}>
            <div className="col-span-2">
              <Field label="Base URL">
                <input
                  type="text"
                  value={config.judgeBaseUrl}
                  onChange={e => config.setJudge({ judgeBaseUrl: e.target.value })}
                  className="w-full border border-[#E5E5E4] rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[#1A1A1A]"
                  placeholder="https://api.openai.com/v1"
                />
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="API Key" hint="Stored in sessionStorage only">
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={judgeKey}
                    onChange={e => setJudgeKey(e.target.value)}
                    className="flex-1 border border-[#E5E5E4] rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[#1A1A1A]"
                    placeholder="sk-..."
                  />
                  <div className="flex items-center gap-1">
                    <StatusIcon s={judgeStatus} />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={testJudge}
                      disabled={testingJudge}
                      className="text-xs h-9"
                    >
                      {testingJudge ? <Loader2 size={12} className="animate-spin" /> : 'Test'}
                    </Button>
                  </div>
                </div>
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="Model name">
                <input
                  type="text"
                  value={config.judgeModel}
                  onChange={e => config.setJudge({ judgeModel: e.target.value })}
                  className="w-full border border-[#E5E5E4] rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-[#1A1A1A]"
                  placeholder="gpt-4o"
                />
              </Field>
            </div>
          </div>
        </div>

        <Button
          onClick={save}
          className="bg-[#1A1A1A] text-white hover:bg-[#333] w-full"
        >
          Save Config
        </Button>
      </div>
    </div>
  )
}
