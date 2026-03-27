'use client'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { RunResult } from '@/types'

interface ResultsState {
  runs: RunResult[]
  addRun: (r: RunResult) => void
  // Upsert by runId — replaces existing entry with same runId
  upsertRun: (r: RunResult) => void
  // Replace entire store with runs loaded from disk (disk = source of truth)
  replaceAll: (rs: RunResult[]) => void
  removeRun: (id: string) => void
  clearAll: () => void
}

export const useResultsStore = create<ResultsState>()(
  persist(
    (set) => ({
      runs: [],

      addRun: (r) =>
        set((state) => ({
          runs: [...state.runs.filter(x => x.runId !== r.runId), { ...r, taskDetails: undefined }],
        })),

      upsertRun: (r) =>
        set((state) => ({
          runs: [...state.runs.filter(x => x.runId !== r.runId), { ...r, taskDetails: undefined }],
        })),

      replaceAll: (rs) =>
        set({ runs: rs.map(r => ({ ...r, taskDetails: undefined })) }),

      removeRun: (id) =>
        set((state) => ({ runs: state.runs.filter(x => x.runId !== id) })),

      clearAll: () => set({ runs: [] }),
    }),
    {
      name: 'eval.results',
      // Extra safety: catch quota errors so existing runs are never lost
      storage: {
        getItem: (key) => {
          try { return JSON.parse(localStorage.getItem(key) ?? 'null') } catch { return null }
        },
        setItem: (key, value) => {
          try {
            localStorage.setItem(key, JSON.stringify(value))
          } catch (e) {
            // QuotaExceededError — trim oldest run and retry once
            const current = JSON.parse(localStorage.getItem(key) ?? '{"state":{"runs":[]}}')
            if (current?.state?.runs?.length > 1) {
              current.state.runs = current.state.runs.slice(1)
              try { localStorage.setItem(key, JSON.stringify(current)) } catch { /* give up */ }
            }
            console.warn('[resultsStore] localStorage quota exceeded, oldest run trimmed', e)
          }
        },
        removeItem: (key) => localStorage.removeItem(key),
      },
    }
  )
)
