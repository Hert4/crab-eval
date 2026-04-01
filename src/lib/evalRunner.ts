import { Dataset, DataRecord, RecordLog, RunResult, TaskRunResult } from '@/types'
import { chatCompletion, OpenAIConfig, OpenAIMessage, OpenAITool, getApiKey } from './openai'
import { computeMetrics, avgScores } from './metrics'
import {
  useEvalSessionStore,
  getEvalController,
  abortEval,
} from '@/store/evalSessionStore'

export interface EvalConfig {
  targetConfig: {
    baseUrl: string
    model: string
    maxTokens: number
    temperature: number
    systemPrompt: string
  }
  judgeConfig: {
    baseUrl: string
    model: string
    enabled: boolean
  }
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

export type ProgressCallback = (p: EvalProgress) => void

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

// ── Module-level runner (survives page navigation) ───────────────────
let _runningPromise: Promise<void> | null = null

export function isEvalRunning(): boolean {
  return !!_runningPromise
}

export async function startEval(
  datasets: Dataset[],
  config: EvalConfig
): Promise<void> {
  if (_runningPromise) return

  const store = useEvalSessionStore.getState()
  const totalRecords = datasets.reduce((s, d) => s + d.data.length, 0)
  store.startSession(totalRecords)

  const controller = getEvalController()

  _runningPromise = _runEval(datasets, config, controller.signal)
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
}

// ── Internal eval pipeline ───────────────────────────────────────────
async function _runEval(
  datasets: Dataset[],
  config: EvalConfig,
  abortSignal: AbortSignal
): Promise<void> {
  const targetApiKey = getApiKey('target_api_key')
  const judgeApiKey = getApiKey('judge_api_key')

  const targetOpenAI: OpenAIConfig = {
    baseUrl: config.targetConfig.baseUrl,
    apiKey: targetApiKey,
    model: config.targetConfig.model,
    maxTokens: config.targetConfig.maxTokens,
    temperature: config.targetConfig.temperature,
  }

  const judgeOpenAI: OpenAIConfig = {
    baseUrl: config.judgeConfig.baseUrl,
    apiKey: judgeApiKey,
    model: config.judgeConfig.model,
    temperature: 0,   // deterministic judge — no randomness
  }

  const runId = crypto.randomUUID()
  const startTime = Date.now()
  const taskResults: Record<string, TaskRunResult> = {}
  const taskScores: Record<string, Record<string, number>> = {}

  let processedTotal = 0
  const totalRecords = useEvalSessionStore.getState().totalRecords ||
    datasets.reduce((s, d) => s + d.data.length, 0)

  for (let di = 0; di < datasets.length; di++) {
    if (abortSignal.aborted) break

    const dataset = datasets[di]
    const taskName = dataset.metadata.task_name
    const metrics = dataset.metadata.gt_metrics || ['exact_match', 'token_f1']
    const logs: RecordLog[] = []
    const perRecordScores: Record<string, number>[] = []

    for (let ri = 0; ri < dataset.data.length; ri++) {
      if (abortSignal.aborted) break

      const record = dataset.data[ri]
      const s = useEvalSessionStore.getState()

      s.updateProgress({
        datasetIndex: di,
        datasetTotal: datasets.length,
        datasetName: taskName,
        recordIndex: ri,
        recordTotal: dataset.data.length,
        currentId: record.id,
        status: 'running',
      })

      const t0 = Date.now()
      let output = ''
      let gotToolCalls: RecordLog['tool_calls'] = []
      let error: string | undefined

      try {
        const messages = buildMessages(record, config.targetConfig.systemPrompt)
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

      // LLM-as-judge
      if (config.judgeConfig.enabled && !abortSignal.aborted) {
        if (metrics.includes('faithfulness') && record.context) {
          const score = await judgeScore(
            judgeOpenAI,
            `Context: ${record.context}\n\nAnswer: ${output}\n\nRate faithfulness 1-10 (integer only):`,
            abortSignal
          )
          if (score !== null) scores['faithfulness'] = score
        }
        if (metrics.includes('answer_relevancy')) {
          const score = await judgeScore(
            judgeOpenAI,
            `Question: ${record.input}\n\nAnswer: ${output}\n\nRate relevancy 1-10 (integer only):`,
            abortSignal
          )
          if (score !== null) scores['answer_relevancy'] = score
        }
        if (metrics.includes('criteria_score') && record.reference) {
          const criteria = record.reference
            .split('\n')
            .map(s => s.trim())
            .filter(Boolean)
          if (criteria.length > 0) {
            const score = await criteriaJudgeScore(
              judgeOpenAI,
              record.input,
              output,
              gotToolCalls,
              criteria,
              abortSignal,
              record.tools as OpenAITool[] | undefined
            )
            if (score !== null) scores['criteria_score'] = score
          }
        }
        // ── Multi-turn metrics ───────────────────────────────────────────
        if (metrics.includes('context_retention') && record.conversation_history?.length) {
          const historyText = record.conversation_history
            .map(t => {
              const role = t.role || (t.user ? 'user' : 'assistant')
              const content = t.content || t.user || t.bot || ''
              return `${role}: ${content}`
            })
            .join('\n')
          const score = await judgeScore(
            judgeOpenAI,
            `Conversation history:\n${historyText}\n\nFinal question: ${record.input}\n\nModel answer: ${output}\n\nDoes the model correctly use or reference information from the conversation history? Rate 1-10 (10=excellent context use, 1=ignored context):`,
            abortSignal
          )
          if (score !== null) scores['context_retention'] = score
        }
        if (metrics.includes('consistency_score') && record.conversation_history?.length) {
          const historyText = record.conversation_history
            .map(t => {
              const role = t.role || (t.user ? 'user' : 'assistant')
              const content = t.content || t.user || t.bot || ''
              return `${role}: ${content}`
            })
            .join('\n')
          const score = await judgeScore(
            judgeOpenAI,
            `Conversation history:\n${historyText}\n\nModel answer: ${output}\n\nDoes the model's answer contradict or conflict with anything in the conversation history? Rate 1-10 (10=fully consistent with no contradictions, 1=major contradictions):`,
            abortSignal
          )
          if (score !== null) scores['consistency_score'] = score
        }
        // ── Instruction Following metrics ────────────────────────────────
        if (metrics.includes('instruction_adherence') && record.metadata?.constraints) {
          const constraints = record.metadata.constraints as string[]
          if (Array.isArray(constraints) && constraints.length > 0) {
            const score = await passFailJudgeScore(
              judgeOpenAI,
              `Instruction given to model:\n"""\n${record.input}\n"""\n\nModel output:\n"""\n${output}\n"""\n\nEvaluate whether the output satisfies each constraint below.\nFor each constraint, answer only "pass" or "fail".\n\nConstraints:\n${constraints.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\nRespond with ONLY a JSON array of "pass"/"fail" values, one per constraint, in order.\nExample for 3 constraints: ["pass", "fail", "pass"]\nNo explanation. No markdown.`,
              constraints.length,
              abortSignal
            )
            if (score !== null) scores['instruction_adherence'] = score
          }
        }
        // ── Summarization metrics ────────────────────────────────────────
        if (metrics.includes('coverage_score') && record.metadata?.key_facts) {
          const keyFacts = record.metadata.key_facts as string[]
          if (Array.isArray(keyFacts) && keyFacts.length > 0) {
            const score = await passFailJudgeScore(
              judgeOpenAI,
              `Model summary:\n"""\n${output}\n"""\n\nCheck whether each key fact below is present (explicitly or implicitly) in the summary.\nFor each fact, answer only "pass" (present) or "fail" (missing).\n\nKey facts:\n${keyFacts.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n\nRespond with ONLY a JSON array of "pass"/"fail" values, one per fact, in order.\nExample for 3 facts: ["pass", "fail", "pass"]\nNo explanation. No markdown.`,
              keyFacts.length,
              abortSignal
            )
            if (score !== null) scores['coverage_score'] = score
          }
        }
        // ── Faithfulness for summarization (reuse same judge) ────────────
        if (metrics.includes('faithfulness') && !record.context && record.metadata?.source_text) {
          const score = await judgeScore(
            judgeOpenAI,
            `Source text: ${String(record.metadata.source_text)}\n\nSummary: ${output}\n\nRate how faithful the summary is to the source text (no hallucinations or unsupported claims) 1-10 (integer only):`,
            abortSignal
          )
          if (score !== null) scores['faithfulness'] = score
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

      logs.push(log)
      if (!error) perRecordScores.push(scores)
      processedTotal++

      const s2 = useEvalSessionStore.getState()
      s2.appendLog(log)
      s2.updateProgress({
        datasetIndex: di,
        datasetTotal: datasets.length,
        datasetName: taskName,
        recordIndex: ri + 1,
        recordTotal: dataset.data.length,
        currentId: record.id,
        status: error ? 'error' : 'done',
        log,
      })
      s2.setOverallProgress(Math.round((processedTotal / totalRecords) * 100))
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

  if (!abortSignal.aborted) {
    const result: RunResult = {
      runId,
      model: config.targetConfig.model,
      baseUrl: config.targetConfig.baseUrl,
      date: new Date().toISOString().replace('T', ' ').slice(0, 19),
      durationMs: Date.now() - startTime,
      tasks: taskScores,
      taskDetails: taskResults,
      // store judge identity so results are reproducible
      ...(config.judgeConfig?.enabled && {
        judgeModel: config.judgeConfig.model,
        judgeBaseUrl: config.judgeConfig.baseUrl,
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

    useEvalSessionStore.getState().setDone()
  }
}

// ── Helpers ──────────────────────────────────────────────────────────
function buildMessages(
  record: DataRecord,
  systemPromptOverride: string
): OpenAIMessage[] {
  const messages: OpenAIMessage[] = []
  const systemContent = systemPromptOverride || record.context || ''
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

async function judgeScore(
  config: OpenAIConfig,
  prompt: string,
  signal: AbortSignal
): Promise<number | null> {
  try {
    const res = await chatCompletion(config, [{ role: 'user', content: prompt }], signal)
    const text = res.choices[0]?.message?.content || ''
    const match = text.match(/\d+(\.\d+)?/)
    if (!match) return null
    const raw = parseFloat(match[0])
    const score = raw <= 1 ? raw * 100 : raw <= 10 ? raw * 10 : raw
    return Math.min(100, Math.max(0, parseFloat(score.toFixed(2))))
  } catch {
    return null
  }
}

// ── Pass/Fail Judge (for instruction_adherence, coverage_score) ───────
// Sends a prompt asking the judge to return a JSON array of "pass"/"fail".
// Returns (passed / total) * 100 as score.
async function passFailJudgeScore(
  config: OpenAIConfig,
  prompt: string,
  expectedCount: number,
  signal: AbortSignal
): Promise<number | null> {
  try {
    const res = await chatCompletion(config, [{ role: 'user', content: prompt }], signal)
    const text = (res.choices[0]?.message?.content || '').trim()
    const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
    const results: string[] = JSON.parse(cleaned)
    if (!Array.isArray(results)) return null
    const passed = results.filter(r => r.toLowerCase().trim() === 'pass').length
    const total = Math.max(expectedCount, results.length)
    return Math.round((passed / total) * 100)
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
    ? `\nAvailable tool definitions (judge MUST use these to verify tool name and argument names are correct):\n${
        toolDefinitions.map(t => {
          const fn = t.function
          const params = fn.parameters?.properties
            ? Object.entries(fn.parameters.properties as Record<string, {type?: string; description?: string}>)
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
    const text = (res.choices[0]?.message?.content || '').trim()
    const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
    const results: string[] = JSON.parse(cleaned)
    const passed = results.filter(r => r.toLowerCase().trim() === 'pass').length
    return Math.round((passed / criteria.length) * 100)
  } catch {
    return null
  }
}
