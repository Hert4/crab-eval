'use client'
import { useState, useEffect } from 'react'
import { useAgentsStore, AgentProfile } from '@/store/agentsStore'
import { testConnection, getApiKey, setApiKey } from '@/lib/openai'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Bot, Plus, Trash2, CheckCircle2, XCircle, Loader2, Pencil, X, Check } from 'lucide-react'

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

// ── Blank form state ──────────────────────────────────────────────────
const blankForm = () => ({
  name: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  maxTokens: 2048,
  temperature: 0.0,
  apiKey: '',
})

// ── Single agent card ─────────────────────────────────────────────────
function AgentCard({ agent }: { agent: AgentProfile }) {
  const { updateAgent, removeAgent } = useAgentsStore()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ ...agent, apiKey: '' })
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState<boolean | null>(null)

  useEffect(() => {
    setForm({ ...agent, apiKey: getApiKey(agent.apiKeyName) })
  }, [agent])

  const save = () => {
    updateAgent(agent.id, {
      name: form.name,
      baseUrl: form.baseUrl,
      model: form.model,
      maxTokens: form.maxTokens,
      temperature: form.temperature,
    })
    setApiKey(agent.apiKeyName, form.apiKey)
    setEditing(false)
    toast.success(`Agent "${form.name}" saved`)
  }

  const cancel = () => {
    setForm({ ...agent, apiKey: getApiKey(agent.apiKeyName) })
    setEditing(false)
  }

  const testConn = async () => {
    setTesting(true)
    setStatus(null)
    const ok = await testConnection({ baseUrl: form.baseUrl, apiKey: form.apiKey, model: form.model })
    setStatus(ok)
    setTesting(false)
    toast(ok ? 'Connection successful' : 'Connection failed', { icon: ok ? '✅' : '❌' })
  }

  const del = () => {
    if (!confirm(`Remove agent "${agent.name}"?`)) return
    removeAgent(agent.id)
    toast(`Removed "${agent.name}"`)
  }

  return (
    <div className="bg-[var(--crab-bg-secondary)] border border-[var(--crab-border)] rounded-xl p-5">
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Bot size={15} className="text-[var(--crab-accent)]" />
          {editing ? (
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="font-semibold text-sm text-[var(--crab-text)] bg-transparent border-b border-[var(--crab-accent)] outline-none px-0.5"
              autoFocus
            />
          ) : (
            <span className="font-semibold text-sm text-[var(--crab-text)]">{agent.name}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {!editing ? (
            <>
              <button
                onClick={() => setEditing(true)}
                className="p-1.5 rounded-lg text-[var(--crab-text-muted)] hover:text-[var(--crab-text)] hover:bg-[var(--crab-bg-hover)] transition-colors"
                title="Edit"
              >
                <Pencil size={13} />
              </button>
              <button
                onClick={del}
                className="p-1.5 rounded-lg text-[var(--crab-text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                title="Remove"
              >
                <Trash2 size={13} />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={save}
                className="p-1.5 rounded-lg text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                title="Save"
              >
                <Check size={14} />
              </button>
              <button
                onClick={cancel}
                className="p-1.5 rounded-lg text-[var(--crab-text-muted)] hover:text-[var(--crab-text)] hover:bg-[var(--crab-bg-hover)] transition-colors"
                title="Cancel"
              >
                <X size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Fields */}
      {editing ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Field label="Base URL">
              <input type="text" value={form.baseUrl} onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))} className={inputCls} placeholder="https://api.openai.com/v1" />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="API Key" hint="Stored in localStorage">
              <div className="flex gap-2">
                <input type="password" value={form.apiKey} onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))} className={`flex-1 ${inputCls.replace('w-full ', '')}`} placeholder="sk-..." />
                <div className="flex items-center gap-1">
                  {status !== null && (status
                    ? <CheckCircle2 size={14} className="text-emerald-400" />
                    : <XCircle size={14} className="text-red-400" />
                  )}
                  <Button size="sm" variant="outline" onClick={testConn} disabled={testing}
                    className="text-xs h-9 border-[var(--crab-border-strong)] text-[var(--crab-text-secondary)] hover:bg-[var(--crab-bg-hover)]">
                    {testing ? <Loader2 size={12} className="animate-spin" /> : 'Test'}
                  </Button>
                </div>
              </div>
            </Field>
          </div>
          <Field label="Model name">
            <input type="text" value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} className={inputCls} placeholder="gpt-4o-mini" />
          </Field>
          <Field label="Max tokens">
            <input type="number" value={form.maxTokens} onChange={e => setForm(f => ({ ...f, maxTokens: Number(e.target.value) }))} className={inputCls} />
          </Field>
          <Field label="Temperature">
            <input type="number" step={0.1} min={0} max={2} value={form.temperature} onChange={e => setForm(f => ({ ...f, temperature: Number(e.target.value) }))} className={inputCls} />
          </Field>
        </div>
      ) : (
        // Read-only summary
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
          {[
            ['Base URL', agent.baseUrl],
            ['Model', agent.model],
            ['Max tokens', String(agent.maxTokens)],
            ['Temperature', String(agent.temperature)],
            ['API Key', getApiKey(agent.apiKeyName) ? '••••••••' : '(not set)'],
          ].map(([label, val]) => (
            <div key={label} className="flex items-center justify-between py-0.5">
              <span className="text-[var(--crab-text-muted)]">{label}</span>
              <span className="font-mono text-[var(--crab-text)] truncate max-w-[180px] text-right">{val}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Add agent form ────────────────────────────────────────────────────
function AddAgentForm({ onClose }: { onClose: () => void }) {
  const { addAgent } = useAgentsStore()
  const [form, setForm] = useState(blankForm())
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState<boolean | null>(null)

  const submit = () => {
    if (!form.name.trim()) { toast.error('Name is required'); return }
    if (!form.baseUrl.trim()) { toast.error('Base URL is required'); return }
    if (!form.model.trim()) { toast.error('Model is required'); return }
    const apiKeyName = `agent_${Date.now()}_key`
    addAgent({ name: form.name, baseUrl: form.baseUrl, model: form.model, maxTokens: form.maxTokens, temperature: form.temperature, apiKeyName })
    setApiKey(apiKeyName, form.apiKey)
    toast.success(`Agent "${form.name}" added`)
    onClose()
  }

  const testConn = async () => {
    setTesting(true)
    setStatus(null)
    const ok = await testConnection({ baseUrl: form.baseUrl, apiKey: form.apiKey, model: form.model })
    setStatus(ok)
    setTesting(false)
    toast(ok ? 'Connection successful' : 'Connection failed', { icon: ok ? '✅' : '❌' })
  }

  return (
    <div className="bg-[var(--crab-bg-secondary)] border border-[var(--crab-accent-medium)] rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Plus size={15} className="text-[var(--crab-accent)]" />
        <span className="font-semibold text-sm text-[var(--crab-text)]">New Agent</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Field label="Display name">
            <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inputCls} placeholder="e.g. GPT-4.1 Mini (MISA)" autoFocus />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Base URL">
            <input type="text" value={form.baseUrl} onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))} className={inputCls} placeholder="https://api.openai.com/v1" />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="API Key" hint="Stored in localStorage">
            <div className="flex gap-2">
              <input type="password" value={form.apiKey} onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))} className={`flex-1 ${inputCls.replace('w-full ', '')}`} placeholder="sk-..." />
              <div className="flex items-center gap-1">
                {status !== null && (status
                  ? <CheckCircle2 size={14} className="text-emerald-400" />
                  : <XCircle size={14} className="text-red-400" />
                )}
                <Button size="sm" variant="outline" onClick={testConn} disabled={testing}
                  className="text-xs h-9 border-[var(--crab-border-strong)] text-[var(--crab-text-secondary)] hover:bg-[var(--crab-bg-hover)]">
                  {testing ? <Loader2 size={12} className="animate-spin" /> : 'Test'}
                </Button>
              </div>
            </div>
          </Field>
        </div>
        <Field label="Model name">
          <input type="text" value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} className={inputCls} placeholder="gpt-4o-mini" />
        </Field>
        <Field label="Max tokens">
          <input type="number" value={form.maxTokens} onChange={e => setForm(f => ({ ...f, maxTokens: Number(e.target.value) }))} className={inputCls} />
        </Field>
        <Field label="Temperature">
          <input type="number" step={0.1} min={0} max={2} value={form.temperature} onChange={e => setForm(f => ({ ...f, temperature: Number(e.target.value) }))} className={inputCls} />
        </Field>
      </div>
      <div className="flex gap-2 mt-4">
        <Button onClick={submit} className="bg-[var(--crab-accent)] text-[var(--crab-text)] hover:bg-[var(--crab-accent-hover)] flex-1 text-sm">
          Add Agent
        </Button>
        <Button variant="outline" onClick={onClose} className="border-[var(--crab-border-strong)] text-[var(--crab-text-secondary)] hover:bg-[var(--crab-bg-hover)] text-sm">
          Cancel
        </Button>
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────
export default function AgentsPage() {
  const { agents } = useAgentsStore()
  const [hydrated, setHydrated] = useState(false)
  const [adding, setAdding] = useState(false)

  useEffect(() => { setHydrated(true) }, [])
  if (!hydrated) return null

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--crab-text)] tracking-tight">Agents</h1>
          <p className="text-[var(--crab-text-secondary)] text-sm mt-1">
            Define model profiles once — reuse them in Config, Run Eval, and Task Generator.
          </p>
        </div>
        {!adding && (
          <Button
            onClick={() => setAdding(true)}
            className="bg-[var(--crab-accent)] text-[var(--crab-text)] hover:bg-[var(--crab-accent-hover)] flex items-center gap-1.5 text-sm"
          >
            <Plus size={14} /> Add Agent
          </Button>
        )}
      </div>

      <div className="space-y-4">
        {adding && <AddAgentForm onClose={() => setAdding(false)} />}

        {agents.length === 0 && !adding ? (
          <div className="bg-[var(--crab-bg-secondary)] border border-[var(--crab-border)] rounded-xl p-12 text-center text-[var(--crab-text-muted)]">
            <Bot size={36} className="mx-auto mb-3" strokeWidth={1.2} />
            <p className="text-sm mb-4">No agents yet.</p>
            <Button
              onClick={() => setAdding(true)}
              className="bg-[var(--crab-accent)] text-[var(--crab-text)] hover:bg-[var(--crab-accent-hover)] text-sm"
            >
              <Plus size={13} className="mr-1" /> Add your first agent
            </Button>
          </div>
        ) : (
          agents.map(a => <AgentCard key={a.id} agent={a} />)
        )}
      </div>
    </div>
  )
}
