'use client'
import { create } from 'zustand'
import { persist, type PersistStorage } from 'zustand/middleware'
import { SimulationTurn, SimulationResult, MultiJudgeConfig } from '@/types'

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
  // Judge model — dedicated evaluator/judge (if blank, falls back to User Model)
  judgeBaseUrl: string
  judgeModel: string
  // Judge API key name — sessionStorage key for judge's API key (default: 'visual_judge_api_key')
  judgeApiKeyName: string
  // Additional judges for multi-judge consensus (Milestone 2) — max 2 extra
  additionalJudges: MultiJudgeConfig[]
  // Compliance rules — JSON array of ComplianceRule[] (Milestone 2)
  complianceRulesJson: string
  // Runs per model for statistical rigor (Milestone 3) — default 1, max 10
  runsPerModel: number
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
  // Scoring mode — τ-bench style programmatic + judge hybrid
  scoringMode: 'hybrid' | 'programmatic' | 'judge_only'
}

type PersistedVisualEvalConfig = Pick<
  VisualEvalConfig,
  | 'scenarioName'
  | 'scenarioDesc'
  | 'targetSysPrompt'
  | 'toolsJson'
  | 'mockContext'
  | 'maxTurnsInput'
  | 'userBaseUrl'
  | 'userModel'
  | 'oracleBaseUrl'
  | 'oracleModel'
  | 'judgeBaseUrl'
  | 'judgeModel'
  | 'judgeApiKeyName'
  | 'additionalJudges'
  | 'complianceRulesJson'
  | 'runsPerModel'
  | 'tasksJson'
  | 'numTasksInput'
  | 'replayScript'
  | 'fileName'
  | 'generated'
  | 'batchModelsText'
  | 'scoringMode'
>

interface PersistedVisualEvalState {
  cfg: PersistedVisualEvalConfig
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
  judgeBaseUrl: '',
  judgeModel: '',
  judgeApiKeyName: 'visual_judge_api_key',
  additionalJudges: [],
  complianceRulesJson: '',
  runsPerModel: 1,
  tasksJson: '[]',
  numTasksInput: 4,
  replayScript: '[]',
  fileName: '',
  fileText: '',
  generated: false,
  batchModelsText: '',
  scoringMode: 'hybrid',
}

function getBrowserStorage(kind: 'local' | 'session'): Storage | null {
  if (typeof window === 'undefined') return null
  return kind === 'local' ? window.localStorage : window.sessionStorage
}

function removeStorageValue(storage: Storage | null, key: string) {
  if (!storage) return
  try {
    storage.removeItem(key)
  } catch {
    // Ignore storage cleanup failures.
  }
}

function sanitizePersistedCfg(cfg?: Partial<VisualEvalConfig> | null): PersistedVisualEvalConfig {
  return {
    scenarioName: cfg?.scenarioName ?? DEFAULT_CFG.scenarioName,
    scenarioDesc: cfg?.scenarioDesc ?? DEFAULT_CFG.scenarioDesc,
    targetSysPrompt: cfg?.targetSysPrompt ?? DEFAULT_CFG.targetSysPrompt,
    toolsJson: cfg?.toolsJson ?? DEFAULT_CFG.toolsJson,
    mockContext: cfg?.mockContext ?? DEFAULT_CFG.mockContext,
    maxTurnsInput: cfg?.maxTurnsInput ?? DEFAULT_CFG.maxTurnsInput,
    userBaseUrl: cfg?.userBaseUrl ?? DEFAULT_CFG.userBaseUrl,
    userModel: cfg?.userModel ?? DEFAULT_CFG.userModel,
    oracleBaseUrl: cfg?.oracleBaseUrl ?? DEFAULT_CFG.oracleBaseUrl,
    oracleModel: cfg?.oracleModel ?? DEFAULT_CFG.oracleModel,
    judgeBaseUrl: cfg?.judgeBaseUrl ?? DEFAULT_CFG.judgeBaseUrl,
    judgeModel: cfg?.judgeModel ?? DEFAULT_CFG.judgeModel,
    judgeApiKeyName: cfg?.judgeApiKeyName ?? DEFAULT_CFG.judgeApiKeyName,
    additionalJudges: cfg?.additionalJudges ?? DEFAULT_CFG.additionalJudges,
    complianceRulesJson: cfg?.complianceRulesJson ?? DEFAULT_CFG.complianceRulesJson,
    runsPerModel: cfg?.runsPerModel ?? DEFAULT_CFG.runsPerModel,
    tasksJson: cfg?.tasksJson ?? DEFAULT_CFG.tasksJson,
    numTasksInput: cfg?.numTasksInput ?? DEFAULT_CFG.numTasksInput,
    replayScript: cfg?.replayScript ?? DEFAULT_CFG.replayScript,
    fileName: cfg?.fileName ?? DEFAULT_CFG.fileName,
    generated: cfg?.generated ?? DEFAULT_CFG.generated,
    batchModelsText: cfg?.batchModelsText ?? DEFAULT_CFG.batchModelsText,
    scoringMode: cfg?.scoringMode ?? DEFAULT_CFG.scoringMode,
  }
}

const visualEvalStorage: PersistStorage<PersistedVisualEvalState> = {
  getItem: (key) => {
    const local = getBrowserStorage('local')
    const session = getBrowserStorage('session')
    const raw = local?.getItem(key) ?? session?.getItem(key) ?? null
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  },
  setItem: (key, value) => {
    const serialized = JSON.stringify(value)
    const local = getBrowserStorage('local')
    const session = getBrowserStorage('session')

    if (local) {
      try {
        local.setItem(key, serialized)
        removeStorageValue(session, key)
        return
      } catch (error) {
        removeStorageValue(local, key)
        try {
          local.setItem(key, serialized)
          removeStorageValue(session, key)
          console.warn('[visualEvalStore] recovered localStorage after clearing stale state', error)
          return
        } catch (retryError) {
          console.warn('[visualEvalStore] localStorage quota exceeded, falling back to sessionStorage', retryError)
        }
      }
    }

    if (session) {
      try {
        session.setItem(key, serialized)
        return
      } catch (error) {
        removeStorageValue(session, key)
        console.warn('[visualEvalStore] sessionStorage quota exceeded, persisted visual eval state dropped', error)
      }
    }
  },
  removeItem: (key) => {
    removeStorageValue(getBrowserStorage('local'), key)
    removeStorageValue(getBrowserStorage('session'), key)
  },
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
            judgeBaseUrl: s.cfg.judgeBaseUrl,
            judgeModel: s.cfg.judgeModel,
            judgeApiKeyName: s.cfg.judgeApiKeyName,
            additionalJudges: s.cfg.additionalJudges,
            complianceRulesJson: s.cfg.complianceRulesJson,
            runsPerModel: s.cfg.runsPerModel,
            maxTurnsInput: s.cfg.maxTurnsInput,
            batchModelsText: s.cfg.batchModelsText,
            scoringMode: s.cfg.scoringMode,
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
      version: 7,
      storage: visualEvalStorage,
      // Persist only compact config. Large runtime state and uploaded file content stay in memory.
      partialize: (s): PersistedVisualEvalState => ({
        cfg: sanitizePersistedCfg(s.cfg),
      }),
      migrate: (persistedState) => {
        const state = persistedState as Partial<VisualEvalState> | PersistedVisualEvalState | null
        return {
          cfg: sanitizePersistedCfg(state?.cfg),
        }
      },
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<PersistedVisualEvalState> | null
        return {
          ...currentState,
          ...persisted,
          cfg: {
            ...DEFAULT_CFG,
            ...currentState.cfg,
            ...persisted?.cfg,
          },
        }
      },
    }
  )
)
