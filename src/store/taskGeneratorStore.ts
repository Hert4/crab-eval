'use client'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AtomicSubtask,
  CompositeTask,
  GeneratedTask,
  ComposeOptions,
  TaskSetStats,
  QAPair,
} from '@/types'

interface TaskGeneratorState {
  currentStep: number
  documentContent: string
  detectedLanguage: string
  agentSystemPrompt: string
  agentToolsJson: string        // raw JSON string of OpenAI tool definitions
  isExtracting: boolean
  sourceFile: File | null       // original uploaded file — sent directly to model when available
  atomicSubtasks: AtomicSubtask[]
  composeOptions: ComposeOptions
  compositeTasks: CompositeTask[]
  generatedTasks: GeneratedTask[]
  isGenerating: boolean
  generateProgress: { done: number; total: number }
  stats: TaskSetStats | null

  // QA/RAG mode
  detectedTaskType: 'tool_calling' | 'rag_qa' | null
  isDetecting: boolean
  qaPairs: QAPair[]
  qaProgress: { done: number; total: number }

  // Actions
  setStep: (step: number) => void
  setDocumentContent: (content: string) => void
  setDetectedLanguage: (lang: string) => void
  setAgentSystemPrompt: (p: string) => void
  setAgentToolsJson: (j: string) => void
  setIsExtracting: (v: boolean) => void
  setSourceFile: (f: File | null) => void
  setAtomicSubtasks: (s: AtomicSubtask[]) => void
  updateSubtask: (id: string, patch: Partial<AtomicSubtask>) => void
  removeSubtask: (id: string) => void
  addSubtask: (s: AtomicSubtask) => void
  setComposeOptions: (o: Partial<ComposeOptions>) => void
  setCompositeTasks: (t: CompositeTask[]) => void
  setGeneratedTasks: (t: GeneratedTask[]) => void
  setIsGenerating: (v: boolean) => void
  setGenerateProgress: (p: { done: number; total: number }) => void
  setStats: (s: TaskSetStats) => void
  // QA/RAG actions
  setDetectedTaskType: (t: 'tool_calling' | 'rag_qa' | null) => void
  setIsDetecting: (v: boolean) => void
  setQAPairs: (pairs: QAPair[]) => void
  updateQAPair: (id: string, patch: Partial<QAPair>) => void
  removeQAPair: (id: string) => void
  setQAProgress: (p: { done: number; total: number }) => void
  reset: () => void
}

const DEFAULT_COMPOSE_OPTIONS: ComposeOptions = {
  maxSteps: 5,
  includeEdgeCases: true,
  personas: ['expert', 'novice', 'out_of_scope'],
  infoLevels: ['complete', 'partial', 'ambiguous'],
  targetCount: 80,
  balanceBy: 'both',
}

export const useTaskGeneratorStore = create<TaskGeneratorState>()(
  persist(
    (set) => ({
      currentStep: 1,
      documentContent: '',
      detectedLanguage: 'English',
      agentSystemPrompt: '',
      agentToolsJson: '',
      isExtracting: false,
      sourceFile: null,
      atomicSubtasks: [],
      composeOptions: DEFAULT_COMPOSE_OPTIONS,
      compositeTasks: [],
      generatedTasks: [],
      isGenerating: false,
      generateProgress: { done: 0, total: 0 },
      stats: null,

      // QA/RAG mode initial state
      detectedTaskType: null,
      isDetecting: false,
      qaPairs: [],
      qaProgress: { done: 0, total: 0 },

      setStep: (step) => set({ currentStep: step }),
      setDocumentContent: (c) => set({ documentContent: c }),
      setDetectedLanguage: (l) => set({ detectedLanguage: l }),
      setAgentSystemPrompt: (p) => set({ agentSystemPrompt: p }),
      setAgentToolsJson: (j) => set({ agentToolsJson: j }),
      setIsExtracting: (v) => set({ isExtracting: v }),
      setSourceFile: (f) => set({ sourceFile: f }),
      setAtomicSubtasks: (s) => set({ atomicSubtasks: s }),
      updateSubtask: (id, patch) =>
        set((st) => ({
          atomicSubtasks: st.atomicSubtasks.map((s) =>
            s.id === id ? { ...s, ...patch } : s
          ),
        })),
      removeSubtask: (id) =>
        set((st) => ({
          atomicSubtasks: st.atomicSubtasks.filter((s) => s.id !== id),
        })),
      addSubtask: (s) =>
        set((st) => ({ atomicSubtasks: [...st.atomicSubtasks, s] })),
      setComposeOptions: (o) =>
        set((st) => ({ composeOptions: { ...st.composeOptions, ...o } })),
      setCompositeTasks: (t) => set({ compositeTasks: t }),
      setGeneratedTasks: (t) => set({ generatedTasks: t }),
      setIsGenerating: (v) => set({ isGenerating: v }),
      setGenerateProgress: (p) => set({ generateProgress: p }),
      setStats: (s) => set({ stats: s }),

      // QA/RAG actions
      setDetectedTaskType: (t) => set({ detectedTaskType: t }),
      setIsDetecting: (v) => set({ isDetecting: v }),
      setQAPairs: (pairs) => set({ qaPairs: pairs }),
      updateQAPair: (id, patch) =>
        set((st) => ({
          qaPairs: st.qaPairs.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        })),
      removeQAPair: (id) =>
        set((st) => ({ qaPairs: st.qaPairs.filter((p) => p.id !== id) })),
      setQAProgress: (p) => set({ qaProgress: p }),

      reset: () =>
        set({
          currentStep: 1,
          documentContent: '',
          detectedLanguage: 'English',
          agentSystemPrompt: '',
          agentToolsJson: '',
          sourceFile: null,
          atomicSubtasks: [],
          composeOptions: DEFAULT_COMPOSE_OPTIONS,
          compositeTasks: [],
          generatedTasks: [],
          generateProgress: { done: 0, total: 0 },
          stats: null,
          detectedTaskType: null,
          isDetecting: false,
          qaPairs: [],
          qaProgress: { done: 0, total: 0 },
        }),
    }),
    {
      name: 'task-generator-store',
      // Only persist lightweight config fields.
      // Heavy data (document text, subtask arrays, generated tasks) stays
      // in-memory only to avoid exceeding the ~5 MB localStorage quota.
      partialize: (state) => ({
        // currentStep intentionally NOT persisted — always restart from Step 1
        // so users are never stuck on a later step with empty in-memory data.
        detectedLanguage: state.detectedLanguage,
        composeOptions: state.composeOptions,
      }),
    }
  )
)
