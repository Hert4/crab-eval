'use client'
import { useAgentsStore } from '@/store/agentsStore'

interface AgentSelectorProps {
  value: string           // selected agent id ('' = none)
  onChange: (id: string) => void
  placeholder?: string
  className?: string
}

export function AgentSelector({ value, onChange, placeholder = 'Select agent…', className }: AgentSelectorProps) {
  const { agents } = useAgentsStore()

  const selectCls = [
    'w-full border border-[var(--crab-border-strong)] bg-[var(--crab-bg-tertiary)] rounded-lg px-3 py-2',
    'text-sm text-[var(--crab-text)] outline-none focus:ring-1 focus:ring-[var(--crab-accent)] transition-colors',
    'cursor-pointer',
    className ?? '',
  ].join(' ')

  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={selectCls}
    >
      <option value="">{placeholder}</option>
      {agents.map(a => (
        <option key={a.id} value={a.id}>{a.name}</option>
      ))}
    </select>
  )
}
