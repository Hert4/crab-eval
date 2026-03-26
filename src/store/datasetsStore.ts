'use client'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Dataset, DataRecord } from '@/types'

interface DatasetsState {
  datasets: Dataset[]
  addDataset: (d: Dataset) => void
  removeDataset: (id: string) => void
  updateRecord: (datasetId: string, recordId: string, patch: Partial<DataRecord>) => void
  mergeGT: (datasetId: string, gtMap: Record<string, string>) => void
  clearAll: () => void
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
    { name: 'eval.datasets' }
  )
)
