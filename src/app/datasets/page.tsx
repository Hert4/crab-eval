'use client'
import { useCallback, useState, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { useDatasetsStore } from '@/store/datasetsStore'
import { Dataset, DataRecord } from '@/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'
import { Upload, Trash2, Eye, Download, Merge, FileJson, AlertCircle, FolderOpen, Loader2 } from 'lucide-react'

function trunc(s: string, n = 80) {
  if (!s) return '—'
  return s.length > n ? s.slice(0, n) + '…' : s
}

function parseDataset(filename: string, raw: unknown): Dataset | null {
  if (typeof raw !== 'object' || raw === null) return null
  const obj = raw as Record<string, unknown>
  if (!obj.metadata || !Array.isArray(obj.data)) return null
  return {
    id: crypto.randomUUID(),
    filename,
    uploadedAt: new Date().toISOString(),
    metadata: obj.metadata as Dataset['metadata'],
    data: obj.data as DataRecord[],
  }
}

export default function DatasetsPage() {
  const { datasets, addDataset, removeDataset, mergeGT } = useDatasetsStore()
  const [hydrated, setHydrated] = useState(false)
  const [preview, setPreview] = useState<Dataset | null>(null)
  const [mergeTarget, setMergeTarget] = useState<string | null>(null)
  const [loadingFolder, setLoadingFolder] = useState(false)

  useEffect(() => { setHydrated(true) }, [])

  // ── Load from datasets/ folder via API ────────
  const loadFromFolder = useCallback(async () => {
    setLoadingFolder(true)
    try {
      const res = await fetch('/api/datasets')
      const json = await res.json()

      if (!res.ok) {
        toast.error(json.error || 'Failed to load datasets folder')
        return
      }

      let added = 0, skipped = 0
      for (const raw of json.datasets) {
        // Avoid duplicates: skip if same task_name already loaded
        const alreadyLoaded = datasets.some(d => d.metadata.task_name === raw.metadata?.task_name)
        if (alreadyLoaded) { skipped++; continue }
        const ds = parseDataset(raw.filename, raw)
        if (ds) { addDataset(ds); added++ }
      }

      if (skipped > 0) {
        toast.success(`Loaded ${added} datasets (${skipped} already loaded — skipped)`)
      } else if (json.errors?.length) {
        toast.warning(`Loaded ${added} datasets. ${json.errors.length} file(s) skipped.`)
      } else {
        toast.success(`Loaded ${added} datasets from datasets/ folder`)
      }
    } catch (e) {
      toast.error(`Error: ${e}`)
    } finally {
      setLoadingFolder(false)
    }
  }, [addDataset, datasets])

  // ── Upload zone ────────────────────────────────
  const onDrop = useCallback((accepted: File[]) => {
    accepted.forEach(file => {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const raw = JSON.parse(e.target?.result as string)
          const ds = parseDataset(file.name, raw)
          if (!ds) throw new Error('Invalid schema')
          addDataset(ds)
          toast.success(`Loaded ${ds.metadata.task_name} (${ds.data.length} records)`)
        } catch (err) {
          toast.error(`Failed to parse ${file.name}: ${err}`)
        }
      }
      reader.readAsText(file)
    })
  }, [addDataset])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/json': ['.json'] },
    multiple: true,
  })

  // ── Merge GT ──────────────────────────────────
  const onMergeFile = useCallback((file: File, datasetId: string) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const raw = JSON.parse(e.target?.result as string)
        if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Expected {id: reference} map')
        mergeGT(datasetId, raw as Record<string, string>)
        toast.success('GT merged successfully')
        setMergeTarget(null)
      } catch (err) {
        toast.error(`Merge failed: ${err}`)
      }
    }
    reader.readAsText(file)
  }, [mergeGT])

  // ── Download ──────────────────────────────────
  const downloadDataset = (ds: Dataset) => {
    const blob = new Blob(
      [JSON.stringify({ metadata: ds.metadata, data: ds.data }, null, 2)],
      { type: 'application/json' }
    )
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = ds.filename
    a.click()
  }

  // ── Stats ─────────────────────────────────────
  const withRef = (ds: Dataset) => ds.data.filter(r => r.reference && r.reference !== '').length
  const withOutput = (ds: Dataset) => ds.data.filter(r => r.output && r.output !== '').length

  if (!hydrated) return null

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--crab-text)] tracking-tight">Datasets</h1>
            <p className="text-[var(--crab-text-secondary)] text-sm mt-1">
              Upload benchmark JSON files. Each file must have <code className="bg-[var(--crab-bg-tertiary)] px-1 rounded text-xs">metadata</code> and <code className="bg-[var(--crab-bg-tertiary)] px-1 rounded text-xs">data</code> fields.
            </p>
          </div>
          <Button
            onClick={loadFromFolder}
            disabled={loadingFolder}
            variant="outline"
            className="shrink-0 flex items-center gap-2 border-[var(--crab-border-strong)] text-[var(--crab-text-secondary)] hover:bg-[var(--crab-bg-hover)] hover:text-[var(--crab-text)]"
          >
            {loadingFolder
              ? <Loader2 size={14} className="animate-spin" />
              : <FolderOpen size={14} />
            }
            Load from datasets/ folder
          </Button>
        </div>
      </div>

      {/* Upload zone */}
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors mb-8 ${
          isDragActive
            ? 'border-[var(--crab-accent)] bg-[var(--crab-accent-light)]'
            : 'border-[var(--crab-border-strong)] hover:border-[var(--crab-accent)] hover:bg-[var(--crab-accent-light)]'
        }`}
      >
        <input {...getInputProps()} />
        <Upload size={28} className="mx-auto mb-3 text-[var(--crab-text-muted)]" strokeWidth={1.5} />
        <p className="text-[var(--crab-text)] font-medium text-sm">
          {isDragActive ? 'Drop files here…' : 'Drop JSON files here, or click to browse'}
        </p>
        <p className="text-[var(--crab-text-muted)] text-xs mt-1">Accepts .json benchmark files</p>
      </div>

      {/* Dataset list */}
      {datasets.length === 0 ? (
        <div className="text-center py-16 text-[var(--crab-text-muted)]">
          <FileJson size={40} className="mx-auto mb-3" strokeWidth={1.2} />
          <p className="text-sm">No datasets yet. Upload some files above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {datasets.map(ds => {
            const refCount = withRef(ds)
            const outCount = withOutput(ds)
            const total = ds.data.length
            const refPct = total ? Math.round(refCount / total * 100) : 0

            return (
              <div
                key={ds.id}
                className="bg-[var(--crab-bg-secondary)] border border-[var(--crab-border)] rounded-xl p-5 flex items-start justify-between gap-4 hover:border-[var(--crab-border-strong)] transition-colors"
              >
                {/* Left info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className="font-semibold text-[var(--crab-text)] text-sm">{ds.metadata.task_name}</span>
                    <Badge variant="secondary" className="text-[11px] bg-[var(--crab-bg-tertiary)] text-[var(--crab-text-secondary)] border-0">
                      {ds.metadata.task_type}
                    </Badge>
                    {ds.metadata.gt_model && (
                      <Badge variant="secondary" className="text-[11px] bg-[var(--crab-accent-light)] text-[var(--crab-accent)] border-0">
                        GT: {ds.metadata.gt_model}
                      </Badge>
                    )}
                  </div>

                  {ds.metadata.description && (
                    <p className="text-xs text-[var(--crab-text-secondary)] mb-2 truncate">{ds.metadata.description}</p>
                  )}

                  {/* Stats row */}
                  <div className="flex items-center gap-4 text-xs text-[var(--crab-text-muted)]">
                    <span><span className="font-medium text-[var(--crab-text)]">{total}</span> records</span>
                    <span>
                      <span className={`font-medium ${refPct === 100 ? 'text-emerald-400' : refPct > 50 ? 'text-amber-400' : 'text-red-400'}`}>
                        {refPct}%
                      </span> with reference
                    </span>
                    {outCount > 0 && (
                      <span><span className="font-medium text-[var(--crab-text)]">{outCount}</span> with output</span>
                    )}
                  </div>

                  {/* Metrics badges */}
                  {ds.metadata.gt_metrics?.length ? (
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {ds.metadata.gt_metrics.map(m => (
                        <span key={m} className="text-[10px] px-2 py-0.5 bg-[var(--crab-bg-tertiary)] text-[var(--crab-text-secondary)] rounded-full">
                          {m}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-[var(--crab-text-muted)] hover:text-[var(--crab-text)] hover:bg-[var(--crab-bg-hover)]"
                    onClick={() => setPreview(ds)}
                    title="Preview"
                  >
                    <Eye size={14} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-[var(--crab-text-muted)] hover:text-[var(--crab-text)] hover:bg-[var(--crab-bg-hover)]"
                    onClick={() => downloadDataset(ds)}
                    title="Download"
                  >
                    <Download size={14} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-[var(--crab-text-muted)] hover:text-[var(--crab-accent)] hover:bg-[var(--crab-accent-light)]"
                    onClick={() => setMergeTarget(ds.id)}
                    title="Merge GT from JSON"
                  >
                    <Merge size={14} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-[var(--crab-text-muted)] hover:text-red-400 hover:bg-red-500/10"
                    onClick={() => {
                      removeDataset(ds.id)
                      toast.success('Dataset removed')
                    }}
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Preview modal */}
      <Dialog open={!!preview} onOpenChange={() => setPreview(null)}>
        <DialogContent
          className="!max-w-4xl w-[calc(100vw-2rem)] max-h-[90vh] flex flex-col overflow-hidden !p-0 !gap-0 !sm:max-w-4xl bg-[var(--crab-bg)] border-[var(--crab-border)]"
        >
          <DialogHeader className="px-6 pt-5 pb-4 border-b border-[var(--crab-border)] shrink-0">
            <DialogTitle className="text-base text-[var(--crab-text)]">{preview?.metadata.task_name} — Preview</DialogTitle>
            <p className="text-xs text-[var(--crab-text-muted)] mt-0.5">
              Showing first {Math.min(preview?.data.length ?? 0, 100)} of {preview?.data.length ?? 0} records
            </p>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[var(--crab-bg-secondary)] text-[var(--crab-text-muted)] uppercase text-[10px] tracking-wider">
                  <th className="text-left px-4 py-2.5 border-b border-[var(--crab-border)] w-36 whitespace-nowrap">ID</th>
                  <th className="text-left px-4 py-2.5 border-b border-[var(--crab-border)] w-72">Input</th>
                  <th className="text-left px-4 py-2.5 border-b border-[var(--crab-border)]">Reference</th>
                  <th className="text-left px-4 py-2.5 border-b border-[var(--crab-border)] w-20 text-center">Output</th>
                </tr>
              </thead>
              <tbody>
                {preview?.data.slice(0, 100).map((r, i) => (
                  <tr key={r.id} className={`${i % 2 === 0 ? 'bg-[var(--crab-bg)]' : 'bg-[var(--crab-bg-secondary)]'} hover:bg-[var(--crab-bg-hover)] transition-colors`}>
                    <td className="px-4 py-3 text-[var(--crab-text-muted)] font-mono text-[11px] border-b border-[var(--crab-border-subtle)] align-top break-all">
                      {r.id}
                    </td>
                    <td className="px-4 py-3 text-[var(--crab-text)] border-b border-[var(--crab-border-subtle)] align-top">
                      <div className="line-clamp-3 break-words max-w-xs">{r.input}</div>
                    </td>
                    <td className="px-4 py-3 text-[var(--crab-text)] border-b border-[var(--crab-border-subtle)] align-top">
                      {r.reference
                        ? <div className="line-clamp-4 break-words">{r.reference}</div>
                        : <span className="text-red-400 flex items-center gap-1 text-[11px]"><AlertCircle size={11} />empty</span>
                      }
                    </td>
                    <td className="px-4 py-3 border-b border-[var(--crab-border-subtle)] align-top text-center">
                      {r.output
                        ? <span className="text-emerald-400 font-bold">✓</span>
                        : <span className="text-[var(--crab-text-muted)]">—</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

      {/* Merge GT modal */}
      <Dialog open={!!mergeTarget} onOpenChange={() => setMergeTarget(null)}>
        <DialogContent className="bg-[var(--crab-bg)] border-[var(--crab-border)]">
          <DialogHeader>
            <DialogTitle className="text-[var(--crab-text)]">Merge GT from JSON</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[var(--crab-text-secondary)] mb-4">
            Upload a JSON file with format: <code className="bg-[var(--crab-bg-tertiary)] px-1.5 py-0.5 rounded text-xs">{"{ \"id1\": \"reference1\", ... }"}</code>
          </p>
          <label className="block border-2 border-dashed border-[var(--crab-border-strong)] rounded-lg p-8 text-center cursor-pointer hover:border-[var(--crab-accent)] transition-colors">
            <input
              type="file"
              accept=".json"
              className="sr-only"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file && mergeTarget) onMergeFile(file, mergeTarget)
              }}
            />
            <Upload size={20} className="mx-auto mb-2 text-[var(--crab-text-muted)]" />
            <p className="text-sm text-[var(--crab-text-secondary)]">Click to choose GT file</p>
          </label>
        </DialogContent>
      </Dialog>
    </div>
  )
}
