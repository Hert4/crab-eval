'use client'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { SimulationTurn, SimulationResult } from '@/types'

// ── Module-level AbortController ────────────────────────────────────
let _simController: AbortController | null = null

export function getSimController(): AbortController {
  if (!_simController || _simController.signal.aborted) {
    _simController = new AbortController()
  }
  return _simController
}

export function abortSim() {
  _simController?.abort()
  _simController = null
}

// ── Config that must survive navigation ──────────────────────────────
export interface VisualEvalConfig {
  scenarioName: string
  scenarioDesc: string
  targetSysPrompt: string
  toolsJson: string
  mockContext: string
  maxTurnsInput: number
  userBaseUrl: string
  userModel: string
  // Oracle model — dedicated to faking tool responses (separate from User Model)
  oracleBaseUrl: string
  oracleModel: string
  // Ordered task list — User Model delivers these tasks one by one to Target Model.
  // Format: JSON array of strings. Each string is one task description.
  // ["Find candidates named X", "Get Technical Interview list for RJ20231201", ...]
  tasksJson: string    // '[]' or JSON array of task strings
  numTasksInput: number  // how many tasks to auto-generate (user-controlled, default 4)
  // Replay script — JSON array of user turn contents captured from a previous run.
  replayScript: string
  fileName: string
  fileText: string
  generated: boolean
  // Batch eval — list of "baseUrl|modelName" entries, one per line
  batchModelsText: string
}

// ── Batch result summary ─────────────────────────────────────────────
export interface BatchModelResult {
  model: string
  finalScore: number | null
  avgScore: number | null
  durationMs: number
  turns: number
  status: 'done' | 'error'
  error?: string
}

// ── Store ────────────────────────────────────────────────────────────
export interface VisualEvalState {
  // ── Simulation runtime (persisted so transcript survives navigation) ──
  isRunning: boolean
  isDone: boolean
  turns: SimulationTurn[]
  currentTurn: number
  maxTurns: number
  currentTask: number
  taskTotal: number
  statusText: string
  finalResult: SimulationResult | null
  errorMessage: string | null

  // ── Batch state ──
  isBatchRunning: boolean
  batchIndex: number       // 0-based current model index
  batchTotal: number       // total models in batch
  batchResults: BatchModelResult[]

  // ── Config (persisted across navigation) ──
  cfg: VisualEvalConfig

  // ── Actions ──
  startSim: (maxTurns: number, taskTotal?: number) => void
  addTurn: (t: SimulationTurn) => void
  setTaskProgress: (currentTask: number) => void
  updateStatus: (text: string) => void
  setDone: (result: SimulationResult) => void
  setError: (msg: string) => void
  setCfg: (patch: Partial<VisualEvalConfig>) => void
  resetTranscript: () => void
  reset: () => void
  removeDocument: () => void
  // Batch actions
  startBatch: (total: number, maxTurns: number, taskTotal?: number) => void
  nextBatchModel: (index: number, model: string, maxTurns: number, taskTotal?: number) => void
  addBatchResult: (r: BatchModelResult) => void
  finishBatch: () => void
}

const DEFAULT_CFG: VisualEvalConfig = {
  scenarioName: '',
  scenarioDesc: '',
  targetSysPrompt: '',
  toolsJson: '[]',
  mockContext: '',
  maxTurnsInput: 8,
  userBaseUrl: '',
  userModel: '',
  oracleBaseUrl: '',
  oracleModel: '',
  tasksJson: '[]',
  numTasksInput: 4,
  replayScript: '[]',
  fileName: '',
  fileText: '',
  generated: false,
  batchModelsText: '',
}

const INITIAL_RUNTIME = {
  isRunning: false,
  isDone: false,
  turns: [] as SimulationTurn[],
  currentTurn: 0,
  maxTurns: 10,
  currentTask: 0,
  taskTotal: 0,
  statusText: '',
  finalResult: null as SimulationResult | null,
  errorMessage: null as string | null,
  isBatchRunning: false,
  batchIndex: 0,
  batchTotal: 0,
  batchResults: [] as BatchModelResult[],
}

export const useVisualEvalStore = create<VisualEvalState>()(
  persist(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (set, _get) => ({
      ...INITIAL_RUNTIME,
      cfg: { ...DEFAULT_CFG },

      startSim: (maxTurns, taskTotal = 0) =>
        set({ ...INITIAL_RUNTIME, isRunning: true, maxTurns, taskTotal, statusText: 'Starting simulation…' }),

      addTurn: (t) =>
        set((s) => ({
          turns: [...s.turns, t],
          currentTurn: t.role === 'user' ? s.currentTurn + 1 : s.currentTurn,
        })),

      setTaskProgress: (currentTask) =>
        set((s) => ({ currentTask: Math.min(Math.max(0, currentTask), s.taskTotal || currentTask) })),

      updateStatus: (text) => set({ statusText: text }),

      setDone: (result) =>
        set({ isRunning: false, isDone: true, finalResult: result, statusText: 'Simulation complete' }),

      setError: (msg) =>
        set({ isRunning: false, errorMessage: msg, statusText: `Error: ${msg}` }),

      setCfg: (patch) =>
        set((s) => ({ cfg: { ...s.cfg, ...patch } })),

      // Clear transcript only — cfg (scenario, tools, prompts) stays intact
      resetTranscript: () =>
        set({ ...INITIAL_RUNTIME }),

      // Full reset — clears transcript + all config
      reset: () =>
        set({ ...INITIAL_RUNTIME, cfg: { ...DEFAULT_CFG } }),

      // Remove document — clears file + generated scenario, keeps model configs
      removeDocument: () =>
        set((s) => ({
          ...INITIAL_RUNTIME,
          cfg: {
            ...DEFAULT_CFG,
            userBaseUrl: s.cfg.userBaseUrl,
            userModel: s.cfg.userModel,
            oracleBaseUrl: s.cfg.oracleBaseUrl,
            oracleModel: s.cfg.oracleModel,
            maxTurnsInput: s.cfg.maxTurnsInput,
            batchModelsText: s.cfg.batchModelsText,
            // replayScript intentionally cleared — new doc needs new script
          },
        })),

      startBatch: (total, maxTurns, taskTotal = 0) =>
        set({
          ...INITIAL_RUNTIME,
          isBatchRunning: true,
          batchTotal: total,
          batchResults: [],
          maxTurns,
          taskTotal,
          statusText: 'Starting batch…',
        }),

      nextBatchModel: (index: number, model: string, maxTurns: number, taskTotal = 0) => {
        const s = useVisualEvalStore.getState()
        set({
          ...INITIAL_RUNTIME,
          isBatchRunning: true,
          batchIndex: index,
          batchTotal: s.batchTotal,
          batchResults: s.batchResults,
          isRunning: true,
          maxTurns,
          taskTotal,
          statusText: `[${index + 1}/${s.batchTotal}] ${model}…`,
        })
      },

      addBatchResult: (r: BatchModelResult) =>
        set((s) => ({ batchResults: [...s.batchResults, r] })),

      finishBatch: () =>
        set((s) => ({ isBatchRunning: false, isRunning: false, isDone: true, statusText: `Batch done — ${s.batchResults.length} models` })),
    }),
    {
      name: 'eval.visual',
      // Persist everything except isRunning (a running sim can't be resumed after page reload)
      partialize: (s) => ({
        isDone: s.isDone,
        turns: s.turns,
        currentTurn: s.currentTurn,
        maxTurns: s.maxTurns,
        currentTask: s.currentTask,
        taskTotal: s.taskTotal,
        statusText: s.statusText,
        finalResult: s.finalResult,
        batchResults: s.batchResults,
        cfg: s.cfg,
      }),
    }
  )
)
