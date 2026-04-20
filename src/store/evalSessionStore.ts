'use client'
import { create } from 'zustand'
import { EvalProgress } from '@/lib/evalRunner'
import { RecordLog } from '@/types'

// ── Module-level AbortController (survives component unmount) ────────
let _controller: AbortController | null = null

export function getEvalController(): AbortController {
  if (!_controller || _controller.signal.aborted) {
    _controller = new AbortController()
  }
  return _controller
}

export function abortEval() {
  _controller?.abort()
  _controller = null
}

// ── Per-model slot ───────────────────────────────────────────────────
export interface ModelRunSlot {
  modelId: string
  modelName: string
  model: string
  logs: RecordLog[]
  progress: EvalProgress | null
  overallProgress: number
  isRunning: boolean
  isDone: boolean
  errorMessage: string | null
}

export interface EvalSessionState {
  isRunning: boolean
  isDone: boolean
  runs: Record<string, ModelRunSlot>
  runOrder: string[]
  totalRecordsPerModel: number
  /** Overall progress across all slots (avg) — kept for Sidebar compat */
  overallProgress: number
  /** Session-level error (e.g. thrown before a slot could start) */
  errorMessage: string | null

  startSession: (
    slots: Array<Pick<ModelRunSlot, 'modelId' | 'modelName' | 'model'>>,
    totalRecordsPerModel: number
  ) => void
  appendLog: (modelId: string, log: RecordLog) => void
  updateProgress: (modelId: string, p: EvalProgress) => void
  setOverallProgress: (modelId: string, pct: number) => void
  setModelDone: (modelId: string) => void
  setModelError: (modelId: string, msg: string) => void
  setError: (msg: string) => void
  stopSession: () => void
  reset: () => void
}

const INITIAL = {
  isRunning: false,
  isDone: false,
  runs: {} as Record<string, ModelRunSlot>,
  runOrder: [] as string[],
  totalRecordsPerModel: 0,
  overallProgress: 0,
  errorMessage: null as string | null,
}

function recomputeAggregate(runs: Record<string, ModelRunSlot>, runOrder: string[]) {
  if (runOrder.length === 0) return { isRunning: false, isDone: false, overallProgress: 0 }
  let sum = 0
  let anyRunning = false
  let allDone = true
  for (const id of runOrder) {
    const slot = runs[id]
    if (!slot) { allDone = false; continue }
    sum += slot.overallProgress
    if (slot.isRunning) anyRunning = true
    if (!slot.isDone) allDone = false
  }
  return {
    isRunning: anyRunning,
    isDone: allDone,
    overallProgress: Math.round(sum / runOrder.length),
  }
}

export const useEvalSessionStore = create<EvalSessionState>()((set) => ({
  ...INITIAL,

  startSession: (slots, totalRecordsPerModel) => {
    const runs: Record<string, ModelRunSlot> = {}
    const runOrder: string[] = []
    for (const s of slots) {
      runs[s.modelId] = {
        modelId: s.modelId,
        modelName: s.modelName,
        model: s.model,
        logs: [],
        progress: null,
        overallProgress: 0,
        isRunning: true,
        isDone: false,
        errorMessage: null,
      }
      runOrder.push(s.modelId)
    }
    set({
      ...INITIAL,
      runs,
      runOrder,
      totalRecordsPerModel,
      isRunning: true,
      isDone: false,
    })
  },

  appendLog: (modelId, log) =>
    set((state) => {
      const slot = state.runs[modelId]
      if (!slot) return state
      const nextSlot: ModelRunSlot = { ...slot, logs: [...slot.logs, log].slice(-500) }
      const nextRuns = { ...state.runs, [modelId]: nextSlot }
      return { ...state, runs: nextRuns }
    }),

  updateProgress: (modelId, p) =>
    set((state) => {
      const slot = state.runs[modelId]
      if (!slot) return state
      const nextSlot: ModelRunSlot = { ...slot, progress: p }
      const nextRuns = { ...state.runs, [modelId]: nextSlot }
      return { ...state, runs: nextRuns }
    }),

  setOverallProgress: (modelId, pct) =>
    set((state) => {
      const slot = state.runs[modelId]
      if (!slot) return state
      const nextSlot: ModelRunSlot = { ...slot, overallProgress: pct }
      const nextRuns = { ...state.runs, [modelId]: nextSlot }
      const agg = recomputeAggregate(nextRuns, state.runOrder)
      return { ...state, runs: nextRuns, overallProgress: agg.overallProgress }
    }),

  setModelDone: (modelId) =>
    set((state) => {
      const slot = state.runs[modelId]
      if (!slot) return state
      const nextSlot: ModelRunSlot = { ...slot, isRunning: false, isDone: true, overallProgress: 100 }
      const nextRuns = { ...state.runs, [modelId]: nextSlot }
      const agg = recomputeAggregate(nextRuns, state.runOrder)
      return {
        ...state,
        runs: nextRuns,
        isRunning: agg.isRunning,
        isDone: agg.isDone,
        overallProgress: agg.overallProgress,
      }
    }),

  setModelError: (modelId, msg) =>
    set((state) => {
      const slot = state.runs[modelId]
      if (!slot) return state
      const nextSlot: ModelRunSlot = { ...slot, isRunning: false, isDone: true, errorMessage: msg }
      const nextRuns = { ...state.runs, [modelId]: nextSlot }
      const agg = recomputeAggregate(nextRuns, state.runOrder)
      return {
        ...state,
        runs: nextRuns,
        isRunning: agg.isRunning,
        isDone: agg.isDone,
        overallProgress: agg.overallProgress,
      }
    }),

  setError: (msg) => set({ isRunning: false, errorMessage: msg }),

  stopSession: () =>
    set((state) => {
      const nextRuns: Record<string, ModelRunSlot> = {}
      for (const id of state.runOrder) {
        const slot = state.runs[id]
        if (!slot) continue
        nextRuns[id] = slot.isDone ? slot : { ...slot, isRunning: false }
      }
      return { ...state, runs: nextRuns, isRunning: false }
    }),

  reset: () => set({ ...INITIAL, runs: {}, runOrder: [] }),
}))
