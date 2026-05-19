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
          // Drop oldest runs in a loop until the payload fits, instead of
          // giving up after a single retry. Disk is the source of truth so
          // dropped localStorage entries can always be reloaded.
          const trimRunsBy = (raw: string, n: number): string => {
            try {
              const parsed = JSON.parse(raw) as { state?: { runs?: unknown[] } }
              if (parsed?.state?.runs && parsed.state.runs.length > n) {
                parsed.state.runs = parsed.state.runs.slice(n)
                return JSON.stringify(parsed)
              }
            } catch { /* fall through */ }
            return raw
          }

          let serialized = JSON.stringify(value)
          let attempts = 0
          while (attempts < 50) {
            try {
              localStorage.setItem(key, serialized)
              return
            } catch {
              const trimmed = trimRunsBy(serialized, 1)
              if (trimmed === serialized) break  // nothing left to trim
              serialized = trimmed
              attempts++
            }
          }
          console.warn(`[resultsStore] localStorage quota exceeded — dropped ${attempts} oldest run(s) from cache. Disk results are unaffected.`)
        },
        removeItem: (key) => localStorage.removeItem(key),
      },
    }
  )
)
