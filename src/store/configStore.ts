'use client'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ConfigState {
  // Target model (for eval)
  targetBaseUrl: string
  targetModel: string
  targetMaxTokens: number
  targetTemperature: number
  targetSystemPrompt: string

  // Judge model (for LLM-as-judge)
  judgeBaseUrl: string
  judgeModel: string
  judgeEnabled: boolean

  setTarget: (patch: Partial<Omit<ConfigState, 'setTarget' | 'setJudge'>>) => void
  setJudge: (patch: Partial<Omit<ConfigState, 'setTarget' | 'setJudge'>>) => void
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set) => ({
      targetBaseUrl: 'https://api.openai.com/v1',
      targetModel: 'gpt-4o-mini',
      targetMaxTokens: 2048,
      targetTemperature: 0.0,
      targetSystemPrompt: '',

      judgeBaseUrl: 'https://api.openai.com/v1',
      judgeModel: 'gpt-4o',
      judgeEnabled: false,

      setTarget: (patch) => set((s) => ({ ...s, ...patch })),
      setJudge: (patch) => set((s) => ({ ...s, ...patch })),
    }),
    { name: 'eval.config' }
  )
)
