'use client'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface AgentProfile {
  id: string
  name: string        // display name, e.g. "GPT-4.1 Mini (MISA)"
  baseUrl: string
  model: string
  maxTokens: number
  temperature: number
  apiKeyName: string  // localStorage key for this agent's API key, e.g. "agent_<id>_key"
}

interface AgentsState {
  agents: AgentProfile[]
  addAgent: (a: Omit<AgentProfile, 'id'>) => void
  updateAgent: (id: string, patch: Partial<Omit<AgentProfile, 'id'>>) => void
  removeAgent: (id: string) => void
}

export const useAgentsStore = create<AgentsState>()(
  persist(
    (set) => ({
      agents: [],

      addAgent: (a) => set((s) => ({
        agents: [...s.agents, { ...a, id: crypto.randomUUID() }],
      })),

      updateAgent: (id, patch) => set((s) => ({
        agents: s.agents.map(a => a.id === id ? { ...a, ...patch } : a),
      })),

      removeAgent: (id) => set((s) => ({
        agents: s.agents.filter(a => a.id !== id),
      })),
    }),
    { name: 'eval.agents' }
  )
)
