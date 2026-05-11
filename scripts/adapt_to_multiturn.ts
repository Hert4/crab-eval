// Build a synthetic multi-turn tool-calling dataset by grouping records from
// ava_tool_calling_50.json. Every group of 3 single-turn records becomes one
// multi-turn record: the first two records become prior turns in
// conversation_history (each assistant turn carries expected_tool_calls), and
// the third record's input provides the final user message.
//
// Conversation flow is NOT natural — three unrelated questions glued together.
// Use this only to exercise the multi-turn evaluation pipeline; for production
// benchmarks gen real datasets via /task-generator with a multi-turn doc.

import fs from 'fs'

type ToolCall = { type?: string; function: { name: string; arguments: string } }
type SrcRecord = {
  id: string
  input: string
  output?: string
  reference?: string
  expected_tool_calls?: ToolCall[]
  conversation_history?: unknown[]
  tools?: unknown[]
  system_prompt?: string
  metadata?: Record<string, unknown>
}

const SRC = 'datasets/ava_tool_calling_50.json'
const DST = 'datasets/ava_tool_calling_multiturn.json'
const BATCH = 3

const src = JSON.parse(fs.readFileSync(SRC, 'utf8'))
const records: SrcRecord[] = src.data

const canonicalTools = records[0]?.tools ?? []
const canonicalSystem = records[0]?.system_prompt ?? ''

const newRecords: unknown[] = []
let groupIdx = 0
for (let i = 0; i + BATCH <= records.length; i += BATCH) {
  const batch = records.slice(i, i + BATCH)
  const history: unknown[] = []
  for (let j = 0; j < batch.length - 1; j++) {
    const r = batch[j]
    history.push({ role: 'user', content: r.input })
    history.push({ role: 'assistant', expected_tool_calls: r.expected_tool_calls ?? [] })
  }
  const last = batch[batch.length - 1]
  newRecords.push({
    id: `mtt_ava_${String(groupIdx).padStart(3, '0')}`,
    input: last.input,
    output: '',
    reference: last.reference ?? '',
    expected_tool_calls: last.expected_tool_calls ?? [],
    conversation_history: history,
    tools: canonicalTools,
    system_prompt: canonicalSystem,
    metadata: {
      difficulty: 'medium',
      tags: ['synthetic', 'multi_turn_tool', 'adapted_from_ava'],
      source_records: batch.map(r => r.id),
    },
  })
  groupIdx++
}

const dataset = {
  metadata: {
    task_name: 'AVA Multi-turn Tool Calling (synthetic)',
    task_type: 'multi_turn_tool',
    gt_metrics: ['tool_call_exact_sequence'],
    gt_model: 'synthetic-from-ava',
    description:
      `Synthetic multi-turn tool calling dataset built by grouping ${BATCH} consecutive records ` +
      `from ava_tool_calling_50.json. Each record has ${BATCH - 1} prior assistant turns ` +
      `(each with expected_tool_calls) followed by a final user input. Conversation flow is NOT ` +
      `natural — unrelated records glued together. Use only to exercise the multi-turn pipeline.`,
  },
  data: newRecords,
}

fs.writeFileSync(DST, JSON.stringify(dataset, null, 2) + '\n')
console.log(`Created ${newRecords.length} multi-turn records in ${DST}`)
console.log(`  source: ${records.length} single-turn records from ${SRC}`)
console.log(`  batch size: ${BATCH}`)
console.log(`  unused tail: ${records.length - newRecords.length * BATCH} records`)
