// Judge Reliability Audit — stress-tests the LLM-as-judge on three dimensions:
// verbosity bias, stochastic stability, score separability.
//
// Inspired by JRH (arxiv 2603.05399), MCJudgeBench (arxiv 2605.03858),
// and Bias & Uncertainty in LLM-as-Judge (arxiv 2605.06939).
//
// Each function calls the same judge prompt shape that evalRunner's
// `answer_correctness` uses (compare candidate vs reference for a given
// question, score 1-10) so the audit reflects real judge behavior.

import { chatCompletion, OpenAIConfig } from './openai'
import { DataRecord } from '@/types'

// ── Public types ──────────────────────────────────────────────────────

export interface JudgeAuditInput {
  baseUrl: string
  model: string
  apiKey: string
}

export interface AuditProgress {
  phase: 'verbosity' | 'stability' | 'separability'
  completed: number
  total: number
}

// ── Constants ─────────────────────────────────────────────────────────
// Justification for each: chosen so the metric maps cleanly onto a
// human-readable 0-100 scale and tests run within a reasonable cost budget.

const STABILITY_REPEATS = 3                   // 3 = enough to estimate stddev cheaply
const STABILITY_SCALE = 4                     // observed stddev rarely exceeds 25 → ×4 fills 0-100
const SCRAMBLE_RATIO = 0.3                    // 30% words replaced — degrades meaning while keeping length
const MIN_RECORDS_FOR_AUDIT = 1
const JUDGE_PARALLEL = 4                      // cap concurrent judge calls to avoid upstream throttling

// Small inline vocab (no extra lib). Common English so it works on any task type.
const SCRAMBLE_VOCAB = [
  'thing', 'system', 'process', 'value', 'method', 'result', 'data', 'item',
  'element', 'component', 'function', 'object', 'state', 'event', 'time',
  'place', 'person', 'group', 'fact', 'point', 'level', 'kind', 'form',
  'type', 'part', 'side', 'case', 'way', 'matter', 'topic', 'idea', 'plan',
  'task', 'goal', 'option', 'change', 'order', 'detail', 'effect', 'cause',
  'reason', 'note', 'list', 'block', 'set', 'field', 'rule', 'limit', 'unit',
]

// ── Helpers ───────────────────────────────────────────────────────────

function parseJudgeScore(text: string): number | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const tagged = trimmed.match(/(?:<score>|score\s*[:=]|rating\s*[:=])\s*(\d+(?:\.\d+)?)/i)
  if (tagged) return parseFloat(tagged[1])
  const allNumbers = trimmed.match(/\d+(?:\.\d+)?/g)
  if (!allNumbers || allNumbers.length === 0) return null
  return parseFloat(allNumbers[allNumbers.length - 1])
}

function normalizeScore(raw: number | null): number | null {
  if (raw === null) return null
  const score = raw <= 10 ? raw * 10 : raw
  return Math.min(100, Math.max(0, parseFloat(score.toFixed(2))))
}

function buildJudgePrompt(question: string, reference: string, candidate: string): string {
  return `You are evaluating an answer to a question.

Question:
"""
${question}
"""

Reference answer (ground truth):
"""
${reference}
"""

Candidate answer to evaluate:
"""
${candidate}
"""

Score the candidate from 1 to 10 based on how well it matches the reference in correctness and completeness. 10 = perfect match in meaning, 1 = completely wrong.

Respond with ONLY a single number between 1 and 10. No explanation.`
}

async function callJudge(
  config: OpenAIConfig,
  prompt: string,
  signal: AbortSignal
): Promise<number | null> {
  try {
    const res = await chatCompletion(config, [{ role: 'user', content: prompt }], signal)
    const text = res.choices[0]?.message?.content || ''
    return normalizeScore(parseJudgeScore(text))
  } catch {
    return null
  }
}

// Simple async semaphore — caps concurrent judge calls.
function createSemaphore(max: number) {
  let active = 0
  const queue: Array<() => void> = []
  const next = () => {
    if (active >= max) return
    const fn = queue.shift()
    if (!fn) return
    active++
    fn()
  }
  return async function acquire<T>(task: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => { queue.push(resolve); next() })
    try { return await task() }
    finally { active--; next() }
  }
}

// Pad a string with repeated content + filler. Tests if longer-but-equivalent
// answers get higher scores (verbosity bias).
function padForVerbosity(text: string): string {
  return `${text}\n\nAdditionally, to elaborate further on the points above: ${text}\n\nIn summary, the answer above provides comprehensive detail across all relevant aspects.`
}

// Scramble: reverse sentence order + replace SCRAMBLE_RATIO of words with random vocab.
// Output should be roughly the same length but mostly incorrect in meaning.
function scrambleReference(text: string): string {
  // Split into sentences (rough — works on dot/!/? boundaries)
  const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0)
  const reversed = sentences.reverse().join(' ')

  // Replace random words
  const words = reversed.split(/\s+/)
  for (let i = 0; i < words.length; i++) {
    if (Math.random() < SCRAMBLE_RATIO) {
      words[i] = SCRAMBLE_VOCAB[Math.floor(Math.random() * SCRAMBLE_VOCAB.length)]
    }
  }
  return words.join(' ')
}

function stddev(nums: number[]): number {
  if (nums.length < 2) return 0
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length
  const variance = nums.reduce((acc, n) => acc + (n - mean) ** 2, 0) / nums.length
  return Math.sqrt(variance)
}

// Pick K records from dataset that have non-empty input + reference.
// Returns shuffled subset deterministically (uses Math.random — fine for sampling).
function sampleRecords(records: DataRecord[], k: number): DataRecord[] {
  const eligible = records.filter(r => (r.input || '').trim() && (r.reference || '').trim())
  if (eligible.length <= k) return eligible
  // Fisher-Yates partial shuffle
  const arr = [...eligible]
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(Math.random() * (arr.length - i))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr.slice(0, k)
}

// ── Audit functions ───────────────────────────────────────────────────

async function auditVerbosityBias(
  config: OpenAIConfig,
  records: DataRecord[],
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
  acquire: <T>(task: () => Promise<T>) => Promise<T>,
): Promise<{ score: number; perRecord: Array<{ recordId: string; original: number; padded: number; delta: number }> }> {
  const perRecord: Array<{ recordId: string; original: number; padded: number; delta: number }> = []
  let done = 0
  const total = records.length * 2

  await Promise.all(records.map(async (rec) => {
    const original = await acquire(() => callJudge(config, buildJudgePrompt(rec.input, rec.reference, rec.reference), signal))
    done++; onProgress(done, total)
    const padded = await acquire(() => callJudge(config, buildJudgePrompt(rec.input, rec.reference, padForVerbosity(rec.reference)), signal))
    done++; onProgress(done, total)
    if (original === null || padded === null) return
    perRecord.push({
      recordId: rec.id,
      original,
      padded,
      delta: Math.abs(padded - original),
    })
  }))

  if (perRecord.length === 0) return { score: 0, perRecord }
  const meanDelta = perRecord.reduce((s, r) => s + r.delta, 0) / perRecord.length
  return { score: parseFloat((100 - meanDelta).toFixed(2)), perRecord }
}

async function auditStochasticStability(
  config: OpenAIConfig,
  records: DataRecord[],
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
  acquire: <T>(task: () => Promise<T>) => Promise<T>,
): Promise<{ score: number; perRecord: Array<{ recordId: string; scores: number[]; stddev: number }> }> {
  const perRecord: Array<{ recordId: string; scores: number[]; stddev: number }> = []
  let done = 0
  const total = records.length * STABILITY_REPEATS

  await Promise.all(records.map(async (rec) => {
    const prompt = buildJudgePrompt(rec.input, rec.reference, rec.reference)
    const scores: number[] = []
    // Sequential within a record so we don't fan out N*records calls at once
    for (let i = 0; i < STABILITY_REPEATS; i++) {
      const s = await acquire(() => callJudge(config, prompt, signal))
      done++; onProgress(done, total)
      if (s !== null) scores.push(s)
    }
    if (scores.length < 2) return
    perRecord.push({ recordId: rec.id, scores, stddev: stddev(scores) })
  }))

  if (perRecord.length === 0) return { score: 0, perRecord }
  const meanStddev = perRecord.reduce((s, r) => s + r.stddev, 0) / perRecord.length
  const score = Math.max(0, 100 - meanStddev * STABILITY_SCALE)
  return { score: parseFloat(score.toFixed(2)), perRecord }
}

async function auditScoreSeparability(
  config: OpenAIConfig,
  records: DataRecord[],
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
  acquire: <T>(task: () => Promise<T>) => Promise<T>,
): Promise<{ score: number; perRecord: Array<{ recordId: string; good: number; bad: number; delta: number }> }> {
  const perRecord: Array<{ recordId: string; good: number; bad: number; delta: number }> = []
  let done = 0
  const total = records.length * 2

  await Promise.all(records.map(async (rec) => {
    const good = await acquire(() => callJudge(config, buildJudgePrompt(rec.input, rec.reference, rec.reference), signal))
    done++; onProgress(done, total)
    const scrambled = scrambleReference(rec.reference)
    const bad = await acquire(() => callJudge(config, buildJudgePrompt(rec.input, rec.reference, scrambled), signal))
    done++; onProgress(done, total)
    if (good === null || bad === null) return
    perRecord.push({ recordId: rec.id, good, bad, delta: good - bad })
  }))

  if (perRecord.length === 0) return { score: 0, perRecord }
  const meanDelta = perRecord.reduce((s, r) => s + r.delta, 0) / perRecord.length
  return { score: parseFloat(meanDelta.toFixed(2)), perRecord }
}

// ── Top-level runner ──────────────────────────────────────────────────

export interface RunAuditArgs {
  judge: JudgeAuditInput
  records: DataRecord[]
  sampleSize: number
  signal: AbortSignal
  onProgress?: (p: AuditProgress) => void
}

export async function runJudgeAudit(args: RunAuditArgs): Promise<{
  sampleSize: number
  verbosity: { score: number; perRecord: Array<{ recordId: string; original: number; padded: number; delta: number }> }
  stability: { score: number; perRecord: Array<{ recordId: string; scores: number[]; stddev: number }> }
  separability: { score: number; perRecord: Array<{ recordId: string; good: number; bad: number; delta: number }> }
}> {
  const sampled = sampleRecords(args.records, args.sampleSize)
  if (sampled.length < MIN_RECORDS_FOR_AUDIT) {
    throw new Error('No records with non-empty input + reference')
  }

  const config: OpenAIConfig = {
    baseUrl: args.judge.baseUrl,
    apiKey: args.judge.apiKey,
    model: args.judge.model,
    maxTokens: 64,           // judge replies with a single number
    temperature: 0,
  }

  const acquire = createSemaphore(JUDGE_PARALLEL)
  const onProgress = args.onProgress ?? (() => {})

  const verbosity = await auditVerbosityBias(
    config, sampled, args.signal,
    (done, total) => onProgress({ phase: 'verbosity', completed: done, total }),
    acquire,
  )
  const stability = await auditStochasticStability(
    config, sampled, args.signal,
    (done, total) => onProgress({ phase: 'stability', completed: done, total }),
    acquire,
  )
  const separability = await auditScoreSeparability(
    config, sampled, args.signal,
    (done, total) => onProgress({ phase: 'separability', completed: done, total }),
    acquire,
  )

  return { sampleSize: sampled.length, verbosity, stability, separability }
}
