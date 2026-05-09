import { Dataset, DataRecord, RecordLog, RunResult, TaskRunResult } from '@/types'
import { chatCompletion, OpenAIConfig, OpenAIMessage, OpenAITool } from './openai'
import { computeMetrics, avgScores } from './metrics'
import { randomUUID } from './utils'
import {
  useEvalSessionStore,
  getEvalController,
  abortEval,
} from '@/store/evalSessionStore'

// ── Public types ─────────────────────────────────────────────────────
export interface EvalTarget {
  modelId: string          // slot key (agent id hoặc 'default')
  modelName: string        // display name
  baseUrl: string
  model: string
  maxTokens: number
  temperature: number
  apiKey: string
  systemPrompt: string
}

export interface EvalConfig {
  targets: EvalTarget[]
  judgeConfig: {
    baseUrl: string
    model: string
    enabled: boolean
    apiKey: string
  }
  concurrency?: number
}

export interface EvalProgress {
  datasetIndex: number
  datasetTotal: number
  datasetName: string
  recordIndex: number
  recordTotal: number
  currentId: string
  status: 'running' | 'done' | 'error'
  log?: RecordLog
}

// ── Retry wrapper (5 attempts, exponential backoff) ──────────────────
const MAX_RETRIES = 5
const RETRY_BASE_MS = 1000

async function chatCompletionWithRetry(
  config: OpenAIConfig,
  messages: OpenAIMessage[],
  signal: AbortSignal,
  tools?: OpenAITool[]
): Promise<Awaited<ReturnType<typeof chatCompletion>>> {
  let lastError: unknown
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      return await chatCompletion(config, messages, signal, tools)
    } catch (e: unknown) {
      lastError = e
      if (e instanceof DOMException && e.name === 'AbortError') throw e
      if (signal.aborted) throw e

      const msg = e instanceof Error ? e.message : String(e)
      const isRetryable =
        e instanceof TypeError ||
        msg.includes('timeout') ||
        msg.includes('ECONNRESET') ||
        msg.includes('ETIMEDOUT') ||
        /API error (429|5\d\d)/.test(msg)

      if (!isRetryable || attempt === MAX_RETRIES - 1) break

      const delay = RETRY_BASE_MS * Math.pow(2, attempt)
      console.warn(`[evalRunner] Attempt ${attempt + 1} failed (${msg}), retrying in ${delay}ms…`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw lastError
}

// ── Concurrency semaphore (p-limit style, no external dep) ───────────
function makeSemaphore(limit: number) {
  let active = 0
  const queue: Array<() => void> = []

  function schedule() {
    while (active < limit && queue.length > 0) {
      active++
      queue.shift()!()
    }
  }

  return function acquire<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => { active--; schedule() })
      })
      schedule()
    })
  }
}

// ── Module-level runner (survives page navigation) ───────────────────
let _runningPromise: Promise<void> | null = null

// Module-level judge semaphore — bounds total in-flight judge calls across
// all targets. Without this, a multi-target eval can fan-out to
// (N targets × concurrency × ~8 judge metrics) parallel calls and overwhelm
// the judge upstream.
let _judgeAcquire: (<T>(fn: () => Promise<T>) => Promise<T>) | null = null

function withJudgeLimit<T>(fn: () => Promise<T>): Promise<T> {
  return _judgeAcquire ? _judgeAcquire(fn) : fn()
}

export function isEvalRunning(): boolean {
  return !!_runningPromise
}

export async function startEval(
  datasets: Dataset[],
  config: EvalConfig
): Promise<void> {
  if (_runningPromise) return
  if (!config.targets.length) {
    useEvalSessionStore.getState().setError('No target models selected')
    return
  }

  const store = useEvalSessionStore.getState()
  const totalRecordsPerModel = datasets.reduce((s, d) => s + d.data.length, 0)
  store.startSession(
    config.targets.map(t => ({ modelId: t.modelId, modelName: t.modelName, model: t.model })),
    totalRecordsPerModel
  )

  const controller = getEvalController()

  _runningPromise = _runAllTargets(datasets, config, controller.signal)
    .catch((e) => {
      if (e instanceof DOMException && e.name === 'AbortError') {
        useEvalSessionStore.getState().stopSession()
      } else {
        useEvalSessionStore.getState().setError(String(e))
      }
    })
    .finally(() => {
      _runningPromise = null
    })
}

export function stopEval() {
  abortEval()
  useEvalSessionStore.getState().stopSession()
  _runningPromise = null
  _judgeAcquire = null
}

// ── Per-record processing args/result ───────────────────────────────
interface ProcessRecordArgs {
  modelId: string
  record: DataRecord
  di: number
  ri: number
  datasetLength: number
  datasets: Dataset[]
  taskName: string
  metrics: string[]
  targetOpenAI: OpenAIConfig
  targetSystemPrompt: string
  judgeOpenAI: OpenAIConfig
  judgeEnabled: boolean
  abortSignal: AbortSignal
}

interface ProcessRecordResult {
  log: RecordLog
  scores: Record<string, number>
  error: boolean
}

async function processRecord({
  modelId, record, di, ri, datasetLength, datasets, taskName, metrics,
  targetOpenAI, targetSystemPrompt, judgeOpenAI, judgeEnabled, abortSignal,
}: ProcessRecordArgs): Promise<ProcessRecordResult> {
  const s = useEvalSessionStore.getState()
  s.updateProgress(modelId, {
    datasetIndex: di,
    datasetTotal: datasets.length,
    datasetName: taskName,
    recordIndex: ri,
    recordTotal: datasetLength,
    currentId: record.id,
    status: 'running',
  })

  const t0 = Date.now()
  let output = ''
  let gotToolCalls: RecordLog['tool_calls'] = []
  let error: string | undefined

  try {
    const messages = buildMessages(record, targetSystemPrompt)
    const tools = record.tools as OpenAITool[] | undefined
    const res = await chatCompletionWithRetry(targetOpenAI, messages, abortSignal, tools)
    const choice = res.choices?.[0]
    output = choice?.message?.content || ''
    gotToolCalls = choice?.message?.tool_calls?.map(tc => ({
      type: tc.type,
      function: { name: tc.function.name, arguments: tc.function.arguments },
    })) || []
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    error = String(e)
  }

  const recordForMetrics = { ...record, tool_calls: gotToolCalls }
  const scores = computeMetrics(recordForMetrics, output, metrics)

  // LLM-as-judge — all judge calls for this record run in parallel
  if (judgeEnabled && !abortSignal.aborted) {
    const judgePromises: Array<Promise<[string, number | null]>> = []

    if (metrics.includes('faithfulness') && record.context) {
      const faithfulnessPrompt = record.reference
        ? `Context: ${record.context}\n\nReference answer: ${record.reference}\n\nModel answer: ${output}\n\nRate faithfulness 1-10: does the model answer stay grounded in the context and align with the reference answer? Respond with ONLY a single integer on its own line. No explanation.`
        : `Context: ${record.context}\n\nAnswer: ${output}\n\nRate faithfulness 1-10. Respond with ONLY a single integer on its own line. No explanation.`
      judgePromises.push(
        withJudgeLimit(() => judgeScore(judgeOpenAI, faithfulnessPrompt, abortSignal))
          .then(v => ['faithfulness', v] as [string, number | null])
      )
    }
    if (metrics.includes('answer_relevancy')) {
      judgePromises.push(
        withJudgeLimit(() => judgeScore(judgeOpenAI, `Question: ${record.input}\n\nAnswer: ${output}\n\nRate relevancy 1-10. Respond with ONLY a single integer on its own line. No explanation.`, abortSignal))
          .then(v => ['answer_relevancy', v] as [string, number | null])
      )
    }
    if (metrics.includes('answer_correctness') && record.reference) {
      judgePromises.push(
        withJudgeLimit(() => judgeScore(
          judgeOpenAI,
          `Question: ${record.input}\n\nReference answer: ${record.reference}\n\nModel answer: ${output}\n\nRate how well the model answer aligns with the reference answer in content and factual correctness, 1-10 (10=fully aligned/equivalent, 5=partially correct, 1=completely wrong or missing). Accept semantically equivalent phrasing, different valid alternatives, and different ordering. Respond with ONLY a single integer on its own line. No explanation.`,
          abortSignal
        )).then(v => ['answer_correctness', v] as [string, number | null])
      )
    }
    if (metrics.includes('criteria_score') && record.reference) {
      const criteria = record.reference.split('\n').map(s => s.trim()).filter(Boolean)
      if (criteria.length > 0) {
        judgePromises.push(
          withJudgeLimit(() => criteriaJudgeScore(judgeOpenAI, record.input, output, gotToolCalls, criteria, abortSignal, record.tools as OpenAITool[] | undefined))
            .then(v => ['criteria_score', v] as [string, number | null])
        )
      }
    }
    if (metrics.includes('context_retention') && record.conversation_history?.length) {
      const historyText = record.conversation_history
        .map(t => {
          const role = t.role || (t.user ? 'user' : 'assistant')
          const content = t.content || t.user || t.bot || ''
          return `${role}: ${content}`
        }).join('\n')
      judgePromises.push(
        withJudgeLimit(() => judgeScore(judgeOpenAI, `Conversation history:\n${historyText}\n\nFinal question: ${record.input}\n\nModel answer: ${output}\n\nDoes the model correctly use or reference information from the conversation history? Rate 1-10 (10=excellent context use, 1=ignored context). Respond with ONLY a single integer on its own line.`, abortSignal))
          .then(v => ['context_retention', v] as [string, number | null])
      )
    }
    if (metrics.includes('consistency_score') && record.conversation_history?.length) {
      const historyText = record.conversation_history
        .map(t => {
          const role = t.role || (t.user ? 'user' : 'assistant')
          const content = t.content || t.user || t.bot || ''
          return `${role}: ${content}`
        }).join('\n')
      judgePromises.push(
        withJudgeLimit(() => judgeScore(judgeOpenAI, `Conversation history:\n${historyText}\n\nModel answer: ${output}\n\nDoes the model's answer contradict or conflict with anything in the conversation history? Rate 1-10 (10=fully consistent with no contradictions, 1=major contradictions). Respond with ONLY a single integer on its own line.`, abortSignal))
          .then(v => ['consistency_score', v] as [string, number | null])
      )
    }
    if (metrics.includes('instruction_adherence') && record.metadata?.constraints) {
      const constraints = record.metadata.constraints as string[]
      if (Array.isArray(constraints) && constraints.length > 0) {
        judgePromises.push(
          withJudgeLimit(() => passFailJudgeScore(
            judgeOpenAI,
            `Instruction given to model:\n"""\n${record.input}\n"""\n\nModel output:\n"""\n${output}\n"""\n\nEvaluate whether the output satisfies each constraint below.\nFor each constraint, answer only "pass" or "fail".\n\nConstraints:\n${constraints.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\nRespond with ONLY a JSON array of "pass"/"fail" values, one per constraint, in order.\nExample for 3 constraints: ["pass", "fail", "pass"]\nNo explanation. No markdown.`,
            constraints.length,
            abortSignal
          )).then(v => ['instruction_adherence', v] as [string, number | null])
        )
      }
    }
    if (metrics.includes('coverage_score') && record.metadata?.key_facts) {
      const keyFacts = record.metadata.key_facts as string[]
      if (Array.isArray(keyFacts) && keyFacts.length > 0) {
        judgePromises.push(
          withJudgeLimit(() => passFailJudgeScore(
            judgeOpenAI,
            `Model summary:\n"""\n${output}\n"""\n\nCheck whether each key fact below is present (explicitly or implicitly) in the summary.\nFor each fact, answer only "pass" (present) or "fail" (missing).\n\nKey facts:\n${keyFacts.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n\nRespond with ONLY a JSON array of "pass"/"fail" values, one per fact, in order.\nExample for 3 facts: ["pass", "fail", "pass"]\nNo explanation. No markdown.`,
            keyFacts.length,
            abortSignal
          )).then(v => ['coverage_score', v] as [string, number | null])
        )
      }
    }
    if (metrics.includes('faithfulness') && !record.context && record.metadata?.source_text) {
      judgePromises.push(
        withJudgeLimit(() => judgeScore(judgeOpenAI, `Source text: ${String(record.metadata!.source_text)}\n\nSummary: ${output}\n\nRate how faithful the summary is to the source text (no hallucinations or unsupported claims) 1-10. Respond with ONLY a single integer on its own line.`, abortSignal))
          .then(v => ['faithfulness', v] as [string, number | null])
      )
    }
    if (metrics.includes('translation_quality')) {
      let sourceText = record.input
      const firstBrace = sourceText.indexOf('{')
      const lastBrace = sourceText.lastIndexOf('}')
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        sourceText = sourceText.substring(firstBrace, lastBrace + 1)
      }
      judgePromises.push(
        withJudgeLimit(() => translationQualityJudgeScore(judgeOpenAI, sourceText, output, record.reference, record.metadata, abortSignal))
          .then(v => ['translation_quality', v] as [string, number | null])
      )
    }

    // All judge metrics for this record run concurrently
    const judgeResults = await Promise.all(judgePromises)
    for (const [metricName, score] of judgeResults) {
      if (score !== null) scores[metricName] = score
    }

    // translation_score = 0.4 × ngram_metric + 0.6 × translation_quality
    // n-gram metric is whichever of chrf/chrf2/meteor/bleu/bleu1 appears in gt_metrics (priority order)
    if (metrics.includes('translation_score')) {
      const selected = (['chrf', 'chrf2', 'meteor', 'bleu', 'bleu1'] as const)
        .find(m => metrics.includes(m) && scores[m] != null)
      const judgeScore = scores['translation_quality']
      if (selected && judgeScore != null) {
        scores['translation_score'] = parseFloat((0.4 * scores[selected] + 0.6 * judgeScore).toFixed(2))
      }
    }
  }

  const log: RecordLog = {
    id: record.id,
    status: error ? 'error' : 'done',
    input: record.input,
    reference: record.reference,
    output,
    tool_calls: gotToolCalls,
    scores,
    error,
    durationMs: Date.now() - t0,
    ...(record.metadata ? { metadata: record.metadata } : {}),
  }

  const s2 = useEvalSessionStore.getState()
  s2.appendLog(modelId, log)
  s2.updateProgress(modelId, {
    datasetIndex: di,
    datasetTotal: datasets.length,
    datasetName: taskName,
    recordIndex: ri + 1,
    recordTotal: datasetLength,
    currentId: record.id,
    status: error ? 'error' : 'done',
    log,
  })

  return { log, scores, error: !!error }
}

// ── Run all targets in parallel ──────────────────────────────────────
async function _runAllTargets(
  datasets: Dataset[],
  config: EvalConfig,
  abortSignal: AbortSignal
): Promise<void> {
  const judgeOpenAI: OpenAIConfig = {
    baseUrl: config.judgeConfig.baseUrl,
    apiKey: config.judgeConfig.apiKey,
    model: config.judgeConfig.model,
    temperature: 0,   // deterministic judge — no randomness
  }

  const concurrencyLimit = Math.max(1, Math.min(10, config.concurrency ?? 3))

  // Total in-flight judge calls across ALL targets. Without this cap, a
  // multi-target eval can fan-out to (N targets × concurrency × ~8 metrics)
  // concurrent judge requests and overwhelm the judge upstream.
  const judgeLimit = Math.max(2, concurrencyLimit * 2)
  _judgeAcquire = makeSemaphore(judgeLimit)

  try {
    // Each target gets its own semaphore but shares the abort signal + judge
    const targetPromises = config.targets.map(target =>
      _runEvalForTarget(target, datasets, judgeOpenAI, config.judgeConfig.enabled, concurrencyLimit, abortSignal)
        .catch((e) => {
          if (e instanceof DOMException && e.name === 'AbortError') throw e
          useEvalSessionStore.getState().setModelError(target.modelId, String(e))
        })
    )

    await Promise.allSettled(targetPromises)
  } finally {
    _judgeAcquire = null
  }

  // If aborted, propagate so the outer handler marks the session stopped
  if (abortSignal.aborted) throw new DOMException('Aborted', 'AbortError')
}

// ── Single-target eval pipeline ──────────────────────────────────────
async function _runEvalForTarget(
  target: EvalTarget,
  datasets: Dataset[],
  judgeOpenAI: OpenAIConfig,
  judgeEnabled: boolean,
  concurrencyLimit: number,
  abortSignal: AbortSignal
): Promise<void> {
  const targetOpenAI: OpenAIConfig = {
    baseUrl: target.baseUrl,
    apiKey: target.apiKey,
    model: target.model,
    maxTokens: target.maxTokens,
    temperature: target.temperature,
  }

  const runId = randomUUID()
  const startTime = Date.now()
  const taskResults: Record<string, TaskRunResult> = {}
  const taskScores: Record<string, Record<string, number>> = {}

  let processedTotal = 0
  const totalRecords = datasets.reduce((s, d) => s + d.data.length, 0)

  const acquire = makeSemaphore(concurrencyLimit)

  for (let di = 0; di < datasets.length; di++) {
    if (abortSignal.aborted) break

    const dataset = datasets[di]
    const taskName = dataset.metadata.task_name
    const metrics = dataset.metadata.gt_metrics || ['exact_match', 'token_f1']
    const logs: RecordLog[] = []
    const perRecordScores: Record<string, number>[] = []

    const recordPromises = dataset.data.map((record, ri) =>
      acquire(async () => {
        if (abortSignal.aborted) return null

        const result = await processRecord({
          modelId: target.modelId,
          record, di, ri,
          datasetLength: dataset.data.length,
          datasets, taskName, metrics,
          targetOpenAI,
          targetSystemPrompt: target.systemPrompt,
          judgeOpenAI,
          judgeEnabled,
          abortSignal,
        })

        processedTotal++
        useEvalSessionStore.getState().setOverallProgress(
          target.modelId,
          Math.round((processedTotal / totalRecords) * 100)
        )
        return result
      })
    )

    const results = await Promise.all(recordPromises)

    for (const result of results) {
      if (result === null) continue
      logs.push(result.log)
      if (!result.error) perRecordScores.push(result.scores)
    }

    const avgScore = avgScores(perRecordScores)
    taskResults[taskName] = {
      taskName,
      taskType: dataset.metadata.task_type,
      description: dataset.metadata.description || taskName,
      numSamples: perRecordScores.length,
      metrics,
      scores: avgScore,
      logs,
    }
    taskScores[taskName] = avgScore
  }

  if (abortSignal.aborted) return

  const result: RunResult = {
    runId,
    model: target.model,
    baseUrl: target.baseUrl,
    date: new Date().toISOString().replace('T', ' ').slice(0, 19),
    durationMs: Date.now() - startTime,
    tasks: taskScores,
    taskDetails: taskResults,
    ...(judgeEnabled && {
      judgeModel: judgeOpenAI.model,
      judgeBaseUrl: judgeOpenAI.baseUrl,
    }),
  }

  // Save to localStorage (strips taskDetails to avoid quota issues)
  const { useResultsStore } = await import('@/store/resultsStore')
  useResultsStore.getState().upsertRun(result)

  // Save to disk: results/<model>/<task>.json
  try {
    await fetch('/api/results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    })
  } catch (e) {
    console.warn('[evalRunner] Failed to save results to disk:', e)
  }

  useEvalSessionStore.getState().setModelDone(target.modelId)
}

// ── Helpers ──────────────────────────────────────────────────────────
function buildMessages(
  record: DataRecord,
  systemPromptOverride: string
): OpenAIMessage[] {
  const messages: OpenAIMessage[] = []
  const systemContent = systemPromptOverride || record.system_prompt || record.context || ''
  if (systemContent) messages.push({ role: 'system', content: systemContent })

  if (record.conversation_history?.length) {
    for (const turn of record.conversation_history) {
      if (turn.role && turn.content) {
        messages.push({ role: turn.role as 'user' | 'assistant', content: turn.content })
      } else if (turn.user) {
        messages.push({ role: 'user', content: turn.user })
        if (turn.bot) messages.push({ role: 'assistant', content: turn.bot })
      }
    }
  }

  messages.push({ role: 'user', content: record.input })
  return messages
}

// Extract a numeric score 1–10 (or 0–100) from judge text.
// Strategy:
//   1. Look for explicit tagged formats: <score>N</score>, "Score: N", "Rating: N"
//   2. Fall back to the LAST number in the text (avoids capturing "1-10" in
//      preambles like "Out of 10, I'd give 7" → grabs "7" not "10")
function parseJudgeScore(text: string): number | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const tagged = trimmed.match(/(?:<score>|score\s*[:=]|rating\s*[:=])\s*(\d+(?:\.\d+)?)/i)
  if (tagged) return parseFloat(tagged[1])

  const allNumbers = trimmed.match(/\d+(?:\.\d+)?/g)
  if (!allNumbers || allNumbers.length === 0) return null
  return parseFloat(allNumbers[allNumbers.length - 1])
}

async function judgeScore(
  config: OpenAIConfig,
  prompt: string,
  signal: AbortSignal
): Promise<number | null> {
  try {
    const res = await chatCompletion(config, [{ role: 'user', content: prompt }], signal)
    const text = res.choices[0]?.message?.content || ''
    const raw = parseJudgeScore(text)
    if (raw === null) return null
    const score = raw <= 1 ? raw * 100 : raw <= 10 ? raw * 10 : raw
    return Math.min(100, Math.max(0, parseFloat(score.toFixed(2))))
  } catch {
    return null
  }
}

// Parse a JSON array of "pass"/"fail" strings out of judge response,
// tolerating markdown code fences. Returns null if not parseable.
function parsePassFailArray(text: string): string[] | null {
  const cleaned = text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
  try {
    const parsed = JSON.parse(cleaned)
    if (!Array.isArray(parsed)) return null
    return parsed.map(v => String(v))
  } catch {
    return null
  }
}

// Score = (passed / expectedCount) * 100, capped to expectedCount items.
// If judge returns fewer items than expected, missing items count as fail.
// If judge returns extra items, extras are ignored.
function passFailToScore(results: string[], expectedCount: number): number {
  if (expectedCount <= 0) return 0
  const trimmed = results.slice(0, expectedCount)
  const passed = trimmed.filter(r => r.toLowerCase().trim() === 'pass').length
  return Math.round((passed / expectedCount) * 100)
}

// ── Pass/Fail Judge (for instruction_adherence, coverage_score) ───────
async function passFailJudgeScore(
  config: OpenAIConfig,
  prompt: string,
  expectedCount: number,
  signal: AbortSignal
): Promise<number | null> {
  try {
    const res = await chatCompletion(config, [{ role: 'user', content: prompt }], signal)
    const text = res.choices[0]?.message?.content || ''
    const results = parsePassFailArray(text)
    if (!results) return null
    return passFailToScore(results, expectedCount)
  } catch {
    return null
  }
}


// ── Criteria-grounded judge ──────────────────────────────────────────
// Evaluates agent output (text + tool calls) against natural-language
// assertion criteria. Returns 0-100: (criteria passed / total) * 100.
async function criteriaJudgeScore(
  config: OpenAIConfig,
  question: string,
  agentAnswer: string,
  toolCalls: RecordLog['tool_calls'],
  criteria: string[],
  signal: AbortSignal,
  toolDefinitions?: OpenAITool[]
): Promise<number | null> {
  const criteriaList = criteria
    .map((c, i) => `${i + 1}. ${c}`)
    .join('\n')

  // Build tool schema section so judge can verify names + arg names
  const toolSchemaSection = toolDefinitions && toolDefinitions.length > 0
    ? `\nAvailable tool definitions (judge MUST use these to verify tool name and argument names are correct):\n${toolDefinitions.map(t => {
      const fn = t.function
      const params = fn.parameters?.properties
        ? Object.entries(fn.parameters.properties as Record<string, { type?: string; description?: string }>)
          .map(([k, v]) => `    - ${k} (${v.type ?? 'any'}): ${v.description ?? ''}`)
          .join('\n')
        : '    (no parameters)'
      const required: string[] = (fn.parameters?.required as string[]) ?? []
      return `  • ${fn.name}: ${fn.description ?? ''}\n    Parameters:\n${params}\n    Required: [${required.join(', ')}]`
    }).join('\n')
    }`
    : ''

  // Build a readable representation of tool calls
  const toolCallSection = toolCalls && toolCalls.length > 0
    ? `\nAgent tool calls made:\n${toolCalls.map((tc, i) => {
      let args = ''
      try { args = JSON.stringify(JSON.parse(tc.function?.arguments || '{}'), null, 2) } catch { args = tc.function?.arguments || '' }
      return `  ${i + 1}. ${tc.function?.name}(${args})`
    }).join('\n')}`
    : ''

  const agentResponseSection = agentAnswer
    ? `\nAgent text response:\n"""\n${agentAnswer}\n"""`
    : '\nAgent text response: (none — agent responded with tool calls only)'

  const prompt = `You are evaluating an AI agent's response against specific success criteria.
This agent uses function/tool calls to perform actions. Evaluate based on BOTH the text response and the tool calls made.
${toolSchemaSection}
User message sent to agent:
"""
${question}
"""
${agentResponseSection}${toolCallSection}

IMPORTANT:
- If tool definitions are provided above, a tool call is only valid if the tool name exactly matches one of the defined tools AND the argument names match the defined parameter names. A tool call with an invented name or wrong argument names must be marked as FAIL even if the intent seems correct.
- If the agent made a valid tool call with correct name and arguments, evaluate whether it satisfies the criteria. An agent that calls the right tool with the right arguments satisfies "action" criteria even if there is no text output.
- If the agent asked for clarification when required info is missing, that satisfies "ask for clarification" criteria.

Evaluate whether the agent's response satisfies each criterion below.
For each criterion, answer only "pass" or "fail".

Criteria:
${criteriaList}

Respond with ONLY a JSON array of "pass"/"fail" values, one per criterion, in order.
Example for 3 criteria: ["pass", "fail", "pass"]
No explanation. No markdown.`

  try {
    const res = await chatCompletion(
      config,
      [{ role: 'user', content: prompt }],
      signal
    )
    const text = res.choices[0]?.message?.content || ''
    const results = parsePassFailArray(text)
    if (!results) return null
    return passFailToScore(results, criteria.length)
  } catch {
    return null
  }
}

// ── Translation Quality judge ───────────────────────────────────────
// Evaluates translation on two dimensions:
//   - Adequacy  (meaning fully preserved from source)
//   - Fluency   (natural, grammatically correct in target language)
// With reference → reference-based scoring (COMET-DA style, 1-10 each dim)
// Without reference → quality estimation only (COMET-QE style)
async function translationQualityJudgeScore(
  config: OpenAIConfig,
  source: string,
  hypothesis: string,
  reference: string | undefined,
  metadata: Record<string, unknown> | undefined,
  signal: AbortSignal
): Promise<number | null> {
  if (!source || !hypothesis) return null

  const srcLang = typeof metadata?.source_language_original === 'string'
    ? metadata.source_language_original
    : (typeof metadata?.source_language === 'string'
      ? metadata.source_language
      : 'the source language')

  const tgtLang = typeof metadata?.target_language_original === 'string'
    ? metadata.target_language_original
    : 'the target language'

  const referenceSection = reference
    ? `\nReference translation:\n"""\n${reference}\n"""`
    : ''

  const scoringInstruction = reference
    ? `Score both dimensions 1-10 considering how well the hypothesis matches the reference in meaning and whether it reads naturally in ${tgtLang}.`
    : `Score both dimensions 1-10 based on the source text alone. You cannot compare to a reference.`

  const prompt = `You are an expert translation evaluator. Evaluate the translation below on two dimensions.

Source (${srcLang}):
"""
${source}
"""

Hypothesis translation (${tgtLang}):
"""
${hypothesis}
"""${referenceSection}

${scoringInstruction}

Dimensions:
1. Adequacy (1-10): Is the full meaning of the source preserved? Deduct for missing information, added content, or meaning distortion.
2. Fluency (1-10): Is the translation grammatically correct and natural in ${tgtLang}? Deduct for awkward phrasing, grammatical errors, or unnatural word order.

Respond with ONLY a JSON object on a single line:
{"adequacy": <score>, "fluency": <score>}
No explanation. No markdown.`

  try {
    const res = await chatCompletion(config, [{ role: 'user', content: prompt }], signal)
    const text = (res.choices[0]?.message?.content || '').trim()
      .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(text)
    const adequacy = parseFloat(parsed.adequacy)
    const fluency = parseFloat(parsed.fluency)
    if (isNaN(adequacy) || isNaN(fluency)) return null
    // Average of both dimensions, scaled to 0-100
    const avg = (adequacy + fluency) / 2
    const score = avg <= 1 ? avg * 100 : avg <= 10 ? avg * 10 : avg
    return Math.min(100, Math.max(0, parseFloat(score.toFixed(2))))
  } catch {
    return null
  }
}
