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

// ── Store ────────────────────────────────────────────────────────────
export interface EvalSessionState {
  isRunning: boolean
  isDone: boolean
  progress: EvalProgress | null
  logs: RecordLog[]
  overallProgress: number
  totalRecords: number
  errorMessage: string | null

  // Actions
  startSession: (totalRecords: number) => void
  stopSession: () => void
  setDone: () => void
  setError: (msg: string) => void
  updateProgress: (p: EvalProgress) => void
  appendLog: (log: RecordLog) => void
  setOverallProgress: (pct: number) => void
  reset: () => void
}

const INITIAL: Omit<EvalSessionState, keyof {
  startSession: never; stopSession: never; setDone: never;
  setError: never; updateProgress: never; appendLog: never;
  setOverallProgress: never; reset: never
}> = {
  isRunning: false,
  isDone: false,
  progress: null,
  logs: [],
  overallProgress: 0,
  totalRecords: 0,
  errorMessage: null,
}

export const useEvalSessionStore = create<EvalSessionState>()((set) => ({
  ...INITIAL,

  startSession: (totalRecords) =>
    set({ isRunning: true, isDone: false, progress: null, logs: [], overallProgress: 0, totalRecords, errorMessage: null }),

  stopSession: () => set({ isRunning: false }),

  setDone: () => set({ isRunning: false, isDone: true, overallProgress: 100 }),

  setError: (msg) => set({ isRunning: false, errorMessage: msg }),

  updateProgress: (p) => set({ progress: p }),

  appendLog: (log) =>
    set((state) => ({ logs: [...state.logs, log].slice(-500) })),

  setOverallProgress: (pct) => set({ overallProgress: pct }),

  reset: () => set({ ...INITIAL }),
}))
