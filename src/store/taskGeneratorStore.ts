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
  MultiTurnPair,
  InstructionPair,
  SafetyCase,
  SummarizationPair,
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

  // Task type detection — extended to 6 types
  detectedTaskType: 'tool_calling' | 'rag_qa' | 'multi_turn' | 'instruction_following' | 'safety' | 'summarization' | null
  isDetecting: boolean

  // QA/RAG mode
  qaPairs: QAPair[]
  qaProgress: { done: number; total: number }

  // Multi-turn Conversation mode
  multiTurnPairs: MultiTurnPair[]
  multiTurnProgress: { done: number; total: number }

  // Instruction Following mode
  instructionPairs: InstructionPair[]
  instructionProgress: { done: number; total: number }

  // Safety / Guardrail mode
  safetyCases: SafetyCase[]
  safetyProgress: { done: number; total: number }

  // Summarization mode
  summarizationPairs: SummarizationPair[]
  summarizationProgress: { done: number; total: number }

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

  // Detection actions
  setDetectedTaskType: (t: 'tool_calling' | 'rag_qa' | 'multi_turn' | 'instruction_following' | 'safety' | 'summarization' | null) => void
  setIsDetecting: (v: boolean) => void

  // QA/RAG actions
  setQAPairs: (pairs: QAPair[]) => void
  updateQAPair: (id: string, patch: Partial<QAPair>) => void
  removeQAPair: (id: string) => void
  setQAProgress: (p: { done: number; total: number }) => void

  // Multi-turn actions
  setMultiTurnPairs: (pairs: MultiTurnPair[]) => void
  updateMultiTurnPair: (id: string, patch: Partial<MultiTurnPair>) => void
  removeMultiTurnPair: (id: string) => void
  setMultiTurnProgress: (p: { done: number; total: number }) => void

  // Instruction Following actions
  setInstructionPairs: (pairs: InstructionPair[]) => void
  updateInstructionPair: (id: string, patch: Partial<InstructionPair>) => void
  removeInstructionPair: (id: string) => void
  setInstructionProgress: (p: { done: number; total: number }) => void

  // Safety actions
  setSafetyCases: (cases: SafetyCase[]) => void
  updateSafetyCase: (id: string, patch: Partial<SafetyCase>) => void
  removeSafetyCase: (id: string) => void
  setSafetyProgress: (p: { done: number; total: number }) => void

  // Summarization actions
  setSummarizationPairs: (pairs: SummarizationPair[]) => void
  updateSummarizationPair: (id: string, patch: Partial<SummarizationPair>) => void
  removeSummarizationPair: (id: string) => void
  setSummarizationProgress: (p: { done: number; total: number }) => void

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

      // Detection initial state
      detectedTaskType: null,
      isDetecting: false,

      // QA/RAG mode initial state
      qaPairs: [],
      qaProgress: { done: 0, total: 0 },

      // Multi-turn initial state
      multiTurnPairs: [],
      multiTurnProgress: { done: 0, total: 0 },

      // Instruction Following initial state
      instructionPairs: [],
      instructionProgress: { done: 0, total: 0 },

      // Safety initial state
      safetyCases: [],
      safetyProgress: { done: 0, total: 0 },

      // Summarization initial state
      summarizationPairs: [],
      summarizationProgress: { done: 0, total: 0 },

      // ── Basic actions
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

      // ── Detection actions
      setDetectedTaskType: (t) => set({ detectedTaskType: t }),
      setIsDetecting: (v) => set({ isDetecting: v }),

      // ── QA/RAG actions
      setQAPairs: (pairs) => set({ qaPairs: pairs }),
      updateQAPair: (id, patch) =>
        set((st) => ({
          qaPairs: st.qaPairs.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        })),
      removeQAPair: (id) =>
        set((st) => ({ qaPairs: st.qaPairs.filter((p) => p.id !== id) })),
      setQAProgress: (p) => set({ qaProgress: p }),

      // ── Multi-turn actions
      setMultiTurnPairs: (pairs) => set({ multiTurnPairs: pairs }),
      updateMultiTurnPair: (id, patch) =>
        set((st) => ({
          multiTurnPairs: st.multiTurnPairs.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        })),
      removeMultiTurnPair: (id) =>
        set((st) => ({ multiTurnPairs: st.multiTurnPairs.filter((p) => p.id !== id) })),
      setMultiTurnProgress: (p) => set({ multiTurnProgress: p }),

      // ── Instruction Following actions
      setInstructionPairs: (pairs) => set({ instructionPairs: pairs }),
      updateInstructionPair: (id, patch) =>
        set((st) => ({
          instructionPairs: st.instructionPairs.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        })),
      removeInstructionPair: (id) =>
        set((st) => ({ instructionPairs: st.instructionPairs.filter((p) => p.id !== id) })),
      setInstructionProgress: (p) => set({ instructionProgress: p }),

      // ── Safety actions
      setSafetyCases: (cases) => set({ safetyCases: cases }),
      updateSafetyCase: (id, patch) =>
        set((st) => ({
          safetyCases: st.safetyCases.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        })),
      removeSafetyCase: (id) =>
        set((st) => ({ safetyCases: st.safetyCases.filter((c) => c.id !== id) })),
      setSafetyProgress: (p) => set({ safetyProgress: p }),

      // ── Summarization actions
      setSummarizationPairs: (pairs) => set({ summarizationPairs: pairs }),
      updateSummarizationPair: (id, patch) =>
        set((st) => ({
          summarizationPairs: st.summarizationPairs.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        })),
      removeSummarizationPair: (id) =>
        set((st) => ({ summarizationPairs: st.summarizationPairs.filter((p) => p.id !== id) })),
      setSummarizationProgress: (p) => set({ summarizationProgress: p }),

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
          multiTurnPairs: [],
          multiTurnProgress: { done: 0, total: 0 },
          instructionPairs: [],
          instructionProgress: { done: 0, total: 0 },
          safetyCases: [],
          safetyProgress: { done: 0, total: 0 },
          summarizationPairs: [],
          summarizationProgress: { done: 0, total: 0 },
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
