'use client'
import { create } from 'zustand'
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
  fileName: string
  fileText: string
  generated: boolean
}

// ── Store ────────────────────────────────────────────────────────────
export interface VisualEvalState {
  // ── Simulation runtime ──
  isRunning: boolean
  isDone: boolean
  turns: SimulationTurn[]
  currentTurn: number
  maxTurns: number
  statusText: string
  finalResult: SimulationResult | null
  errorMessage: string | null

  // ── Config (persisted across navigation) ──
  cfg: VisualEvalConfig

  // ── Actions ──
  startSim: (maxTurns: number) => void
  addTurn: (t: SimulationTurn) => void
  updateStatus: (text: string) => void
  setDone: (result: SimulationResult) => void
  setError: (msg: string) => void
  setCfg: (patch: Partial<VisualEvalConfig>) => void
  reset: () => void
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
  fileName: '',
  fileText: '',
  generated: false,
}

const INITIAL_RUNTIME = {
  isRunning: false,
  isDone: false,
  turns: [] as SimulationTurn[],
  currentTurn: 0,
  maxTurns: 10,
  statusText: '',
  finalResult: null as SimulationResult | null,
  errorMessage: null as string | null,
}

export const useVisualEvalStore = create<VisualEvalState>()((set) => ({
  ...INITIAL_RUNTIME,
  cfg: { ...DEFAULT_CFG },

  startSim: (maxTurns) =>
    set({ ...INITIAL_RUNTIME, isRunning: true, maxTurns, statusText: 'Starting simulation…' }),

  addTurn: (t) =>
    set((s) => ({
      turns: [...s.turns, t],
      currentTurn: t.role === 'user' ? s.currentTurn + 1 : s.currentTurn,
    })),

  updateStatus: (text) => set({ statusText: text }),

  setDone: (result) =>
    set({ isRunning: false, isDone: true, finalResult: result, statusText: 'Simulation complete' }),

  setError: (msg) =>
    set({ isRunning: false, errorMessage: msg, statusText: `Error: ${msg}` }),

  setCfg: (patch) =>
    set((s) => ({ cfg: { ...s.cfg, ...patch } })),

  reset: () => set({ ...INITIAL_RUNTIME, cfg: { ...DEFAULT_CFG } }),
}))
