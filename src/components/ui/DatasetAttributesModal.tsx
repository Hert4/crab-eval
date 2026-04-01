'use client'
import { useEffect, useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Dataset } from '@/types'

interface Row {
  key: string
  value: string
}

interface Props {
  dataset: Dataset | null
  onClose: () => void
  onSave: (datasetId: string, attrs: Record<string, string>) => void
}

export function DatasetAttributesModal({ dataset, onClose, onSave }: Props) {
  const [rows, setRows] = useState<Row[]>([])

  // Sync rows when dataset changes
  useEffect(() => {
    if (!dataset) return
    const attrs = dataset.metadata.customAttributes ?? {}
    setRows(
      Object.entries(attrs).map(([key, value]) => ({ key, value }))
    )
  }, [dataset?.id])  // eslint-disable-line react-hooks/exhaustive-deps

  if (!dataset) return null

  const addRow = () => setRows(r => [...r, { key: '', value: '' }])

  const updateRow = (i: number, field: 'key' | 'value', val: string) =>
    setRows(r => r.map((row, idx) => idx === i ? { ...row, [field]: val } : row))

  const removeRow = (i: number) =>
    setRows(r => r.filter((_, idx) => idx !== i))

  const handleSave = () => {
    const attrs: Record<string, string> = {}
    for (const { key, value } of rows) {
      if (key.trim()) attrs[key.trim()] = value
    }
    onSave(dataset.id, attrs)
  }

  // Check if there are changes
  const existing = JSON.stringify(
    Object.entries(dataset.metadata.customAttributes ?? {}).sort()
  )
  const current = JSON.stringify(
    rows.filter(r => r.key.trim()).map(r => [r.key.trim(), r.value]).sort()
  )
  const hasChanges = existing !== current

  const inputCls = 'w-full border border-[var(--crab-border-strong)] bg-[var(--crab-bg-tertiary)] rounded-lg px-3 py-2 text-xs text-[var(--crab-text)] placeholder:text-[var(--crab-text-muted)] outline-none focus:ring-2 focus:ring-[var(--crab-accent)]/40 focus:border-[var(--crab-accent)] transition-all'

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-lg mx-4 rounded-2xl border border-[var(--crab-border)] bg-[var(--crab-bg-secondary)] shadow-xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--crab-border)]">
          <div>
            <h2 className="text-sm font-semibold text-[var(--crab-text)]">Custom Attributes</h2>
            <p className="text-[10px] text-[var(--crab-text-muted)] mt-0.5 truncate max-w-[320px]">
              {dataset.metadata.task_name}
            </p>
          </div>
          <button onClick={onClose} className="text-[var(--crab-text-muted)] hover:text-[var(--crab-text)] transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          {/* Column headers */}
          {rows.length > 0 && (
            <div className="grid grid-cols-[1fr_1fr_32px] gap-2 mb-2">
              <p className="text-[10px] font-medium text-[var(--crab-text-muted)]">Key</p>
              <p className="text-[10px] font-medium text-[var(--crab-text-muted)]">Value</p>
              <span />
            </div>
          )}

          {/* Rows */}
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {rows.map((row, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_32px] gap-2 items-center">
                <input
                  type="text"
                  value={row.key}
                  onChange={e => updateRow(i, 'key', e.target.value)}
                  placeholder="key"
                  className={inputCls}
                />
                <input
                  type="text"
                  value={row.value}
                  onChange={e => updateRow(i, 'value', e.target.value)}
                  placeholder="value"
                  className={inputCls}
                />
                <button
                  onClick={() => removeRow(i)}
                  className="flex items-center justify-center text-[var(--crab-text-muted)] hover:text-red-400 transition-colors h-8"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>

          {/* Empty state */}
          {rows.length === 0 && (
            <p className="text-xs text-[var(--crab-text-muted)] py-4 text-center">
              No custom attributes yet. Add key-value pairs to annotate this dataset.
            </p>
          )}

          {/* Add row */}
          <button
            onClick={addRow}
            className="mt-3 flex items-center gap-1.5 text-xs text-[var(--crab-text-muted)] hover:text-[var(--crab-accent)] transition-colors"
          >
            <Plus size={12} /> Add attribute
          </button>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--crab-border)] bg-[var(--crab-bg)]">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="text-xs border-[var(--crab-border-strong)] text-[var(--crab-text-secondary)] hover:bg-[var(--crab-bg-hover)] hover:text-[var(--crab-text)]"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!hasChanges}
            className="text-xs bg-[var(--crab-accent)] text-[var(--crab-text)] hover:bg-[var(--crab-accent-hover)] disabled:opacity-40"
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}
