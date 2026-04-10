'use client'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Dataset, DataRecord, DatasetMetadata } from '@/types'

interface DatasetsState {
  datasets: Dataset[]
  addDataset: (d: Dataset) => void
  removeDataset: (id: string) => void
  updateRecord: (datasetId: string, recordId: string, patch: Partial<DataRecord>) => void
  updateDatasetMetadata: (datasetId: string, patch: Partial<DatasetMetadata>) => void
  mergeGT: (datasetId: string, gtMap: Record<string, string>) => void
  clearAll: () => void
}

// Strip heavy fields before writing to localStorage.
// `context` on each record can be very large (full document, metadata blocks, etc.)
// and is only needed at eval-run time — it survives in-memory fine.
// `output` is always empty on upload and doesn't need persisting either.
function trimForStorage(datasets: Dataset[]): Dataset[] {
  return datasets.map(d => ({
    ...d,
    data: d.data.map(r => ({
      ...r,
      context: r.context ? r.context.slice(0, 300) : r.context,
      output: '',
    })),
  }))
}

const quotaSafeStorage = {
  getItem: (key: string) => {
    try { return JSON.parse(localStorage.getItem(key) ?? 'null') } catch { return null }
  },
  setItem: (key: string, value: unknown) => {
    const serialized = JSON.stringify(value)
    try {
      localStorage.setItem(key, serialized)
    } catch {
      // QuotaExceededError — try trimming context first, then drop oldest dataset
      try {
        const parsed = JSON.parse(serialized) as { state?: { datasets?: Dataset[] } }
        if (parsed?.state?.datasets) {
          parsed.state.datasets = trimForStorage(parsed.state.datasets)
          try {
            localStorage.setItem(key, JSON.stringify(parsed))
            return
          } catch { /* still too big, drop oldest */ }
          if (parsed.state.datasets.length > 1) {
            parsed.state.datasets = parsed.state.datasets.slice(1)
            try { localStorage.setItem(key, JSON.stringify(parsed)) } catch { /* give up */ }
          }
        }
      } catch { /* give up */ }
      console.warn('[datasetsStore] localStorage quota exceeded — some data not persisted')
    }
  },
  removeItem: (key: string) => localStorage.removeItem(key),
}

export const useDatasetsStore = create<DatasetsState>()(
  persist(
    (set) => ({
      datasets: [],

      addDataset: (d) =>
        set((state) => ({
          datasets: [...state.datasets.filter(x => x.id !== d.id), d],
        })),

      removeDataset: (id) =>
        set((state) => ({ datasets: state.datasets.filter(x => x.id !== id) })),

      updateRecord: (datasetId, recordId, patch) =>
        set((state) => ({
          datasets: state.datasets.map(d =>
            d.id !== datasetId
              ? d
              : {
                  ...d,
                  data: d.data.map(r =>
                    r.id !== recordId ? r : { ...r, ...patch }
                  ),
                }
          ),
        })),

      updateDatasetMetadata: (datasetId, patch) =>
        set((state) => ({
          datasets: state.datasets.map(d =>
            d.id !== datasetId ? d : { ...d, metadata: { ...d.metadata, ...patch } }
          ),
        })),

      mergeGT: (datasetId, gtMap) =>
        set((state) => ({
          datasets: state.datasets.map(d =>
            d.id !== datasetId
              ? d
              : {
                  ...d,
                  data: d.data.map(r =>
                    r.id in gtMap ? { ...r, reference: gtMap[r.id] } : r
                  ),
                }
          ),
        })),

      clearAll: () => set({ datasets: [] }),
    }),
    {
      name: 'eval.datasets',
      version: 6,  // bump khi thay đổi partialize schema — tự clear data cũ
      migrate: () => ({ datasets: [] }),  // data cũ thiếu expected_tool_calls → clear, user re-upload
      storage: quotaSafeStorage,
      // Only persist metadata + record IDs/inputs/references.
      // context & output are large and can be rebuilt — don't persist them.
      partialize: (state) => ({
        datasets: state.datasets.map(d => ({
          ...d,
          data: d.data.map(r => {
            // Persist only small scalar metadata keys — skip large fields
            const { difficulty, intent, tags, test_aspect, attack_type, expected_behavior } =
              (r.metadata ?? {}) as Record<string, unknown>
            const slimMeta = Object.fromEntries(
              Object.entries({ difficulty, intent, tags, test_aspect, attack_type, expected_behavior })
                .filter(([, v]) => v !== undefined)
            )
            return {
              id: r.id,
              input: r.input,
              output: '',
              reference: r.reference,
              // context: truncate to 4000 chars to stay within quota
              ...(r.context ? { context: (r.context as string).slice(0, 4000) } : {}),
              // system_prompt: per-record system prompt (tool-calling datasets)
              ...(r.system_prompt ? { system_prompt: r.system_prompt } : {}),
              // tools: keep as-is (JSON schema definitions, not large)
              ...(r.tools ? { tools: r.tools } : {}),
              // expected_tool_calls: ground truth for tool-calling metrics — MUST persist
              ...(r.expected_tool_calls ? { expected_tool_calls: r.expected_tool_calls } : {}),
              // conversation_history: needed for multi-turn eval
              ...(r.conversation_history ? { conversation_history: r.conversation_history } : {}),
              // metadata: only small well-known scalar keys
              ...(Object.keys(slimMeta).length > 0 ? { metadata: slimMeta } : {}),
            }
          }),
        })),
      }),
    }
  )
)
