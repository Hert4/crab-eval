import {
  SimulationEvaluationDebug,
  SimulationTurn,
  TaskResult,
  TaskScoreBreakdown,
  ToolTraceSummary,
  MultiJudgeResult,
  JudgeVerdict,
  ThreeAxisScore,
  ComplianceResult,
  ComplianceRule,
} from '@/types'
import { chatCompletion, OpenAIConfig, OpenAITool } from './openai'

type TaskStatus = TaskResult['status']

interface TaskSegment {
  index: number
  task: string
  transcript: string
  priorContext: string
  turns: SimulationTurn[]
  toolTrace: ToolTraceSummary
  calledTools: string[]
}

interface JudgeTaskPayload {
  task_index: number
  status: TaskStatus
  completion: number
  grounding: number
  clarification: number | null
  tool_use: number | null
  note: string
}

interface JudgeResponse {
  tasks: JudgeTaskPayload[]
  overall_assessment: string
}

export interface VisualEvaluationResult {
  taskResults?: TaskResult[]
  finalScore: number | null
  assessment: string
  status: 'scored' | 'unavailable'
  debug?: SimulationEvaluationDebug
}

interface EvaluateOptions {
  tasks?: string[]
  tools?: OpenAITool[]
}

interface ToolTraceEvaluator {
  name: 'tool_trace'
  evaluate: (segment: TaskSegment, tools?: OpenAITool[]) => { trace: ToolTraceSummary; score: number | null }
}

interface ChecklistEvaluator {
  name: 'checklist_llm'
  evaluate: (
    segments: TaskSegment[],
    judgeCfg: OpenAIConfig,
    signal: AbortSignal
  ) => Promise<{ payload: JudgeResponse; raw: string } | null>
}

const clampScore = (value: number) => Math.max(0, Math.min(100, Math.round(value)))

function compactText(text: string, max = 240): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}…`
}

function summarizeJsonForJudge(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return compactText(value, depth === 0 ? 260 : 180)
  if (typeof value !== 'object') return value

  if (Array.isArray(value)) {
    const items = value.slice(0, 3).map(item => summarizeJsonForJudge(item, depth + 1))
    return value.length > 3 ? [...items, `…(${value.length - 3} more)`] : items
  }

  const entries = Object.entries(value as Record<string, unknown>)
  const maxKeys = depth === 0 ? 10 : 6
  const summaryEntries = entries.slice(0, maxKeys).map(
    ([key, nested]) => [key, summarizeJsonForJudge(nested, depth + 1)] as const
  )
  if (entries.length > maxKeys) summaryEntries.push(['__truncatedKeys', entries.length - maxKeys] as const)
  return Object.fromEntries(summaryEntries)
}

function summarizeToolContent(content: string, max = 1200): string {
  const trimmed = content.trim()
  if (!trimmed) return ''

  try {
    const parsed = JSON.parse(trimmed) as unknown
    return truncate(JSON.stringify(summarizeJsonForJudge(parsed)), max)
  } catch {
    return truncate(trimmed, max)
  }
}

function formatCarryoverTurn(turn: SimulationTurn): string {
  if (turn.role === 'tool') {
    return `TOOL[${turn.tool_name}]: ${summarizeToolContent(turn.content, 260)}`
  }

  const label = turn.role === 'user' ? 'USER' : 'ASSISTANT'
  const toolLine = turn.tool_calls?.length
    ? ` CALLS=${turn.tool_calls.map(tc => tc.function.name).join(',')}`
    : ''
  return `${label}${toolLine}: ${compactText(turn.content, 180)}`
}

function truncate(text: string, max = 2800): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}

function buildSegmentTranscript(turns: SimulationTurn[]): string {
  return turns.map(turn => {
    if (turn.role === 'tool') {
      return `TOOL[${turn.tool_name}]: ${summarizeToolContent(turn.content, 1200)}`
    }
    const label = turn.role === 'user' ? 'USER' : 'ASSISTANT'
    const toolLine = turn.tool_calls?.length
      ? `\nCALLS: ${turn.tool_calls.map(tc => `${tc.function.name}(${tc.function.arguments})`).join(' | ')}`
      : ''
    return `${label}:${toolLine}\n${turn.content}`
  }).join('\n\n---\n\n')
}

function buildPriorContext(turns: SimulationTurn[]): string {
  if (turns.length === 0) return ''

  const priorToolTurns = turns.filter(turn => turn.role === 'tool').slice(-8)
  const recentDialogue = turns.filter(turn => turn.role !== 'tool').slice(-4)
  const sections: string[] = []

  if (priorToolTurns.length > 0) {
    sections.push(`Earlier tool evidence:\n${priorToolTurns.map(formatCarryoverTurn).join('\n')}`)
  }
  if (recentDialogue.length > 0) {
    sections.push(`Recent dialogue:\n${recentDialogue.map(formatCarryoverTurn).join('\n')}`)
  }

  return truncate(sections.join('\n\n'), 1800)
}

export function buildTaskSegments(turns: SimulationTurn[], tasks?: string[]): TaskSegment[] {
  const userIndexes = turns
    .map((turn, idx) => turn.role === 'user' ? idx : -1)
    .filter(idx => idx !== -1)

  return userIndexes.map((startIdx, taskIndex) => {
    const endIdx = userIndexes[taskIndex + 1] ?? turns.length
    const segmentTurns = turns.slice(startIdx, endIdx)
    const task = tasks?.[taskIndex] || segmentTurns[0]?.content || `Task ${taskIndex + 1}`
    return {
      index: taskIndex,
      task,
      transcript: buildSegmentTranscript(segmentTurns),
      priorContext: buildPriorContext(turns.slice(0, startIdx)),
      turns: segmentTurns,
      toolTrace: {
        totalToolCalls: 0,
        validToolCalls: 0,
        invalidToolCalls: 0,
        unknownTools: 0,
        malformedArguments: 0,
        missingRequiredArguments: 0,
      },
      calledTools: [],
    }
  })
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isMissingValue(value: unknown): boolean {
  return value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
}

function validateValueAgainstSchema(
  value: unknown,
  schema: Record<string, unknown>,
  path = '$'
): string[] {
  const issues: string[] = []
  const type = typeof schema.type === 'string' ? schema.type : undefined

  if (!type) return issues

  if (type === 'string' && typeof value !== 'string') {
    issues.push(`${path}: expected string`)
    return issues
  }
  if (type === 'number' && typeof value !== 'number') {
    issues.push(`${path}: expected number`)
    return issues
  }
  if (type === 'integer' && !Number.isInteger(value)) {
    issues.push(`${path}: expected integer`)
    return issues
  }
  if (type === 'boolean' && typeof value !== 'boolean') {
    issues.push(`${path}: expected boolean`)
    return issues
  }
  if (type === 'array') {
    if (!Array.isArray(value)) {
      issues.push(`${path}: expected array`)
      return issues
    }
    const itemSchema = isPlainObject(schema.items) ? schema.items : null
    if (itemSchema) {
      value.slice(0, 5).forEach((item, idx) => {
        issues.push(...validateValueAgainstSchema(item, itemSchema, `${path}[${idx}]`))
      })
    }
    return issues
  }
  if (type === 'object') {
    if (!isPlainObject(value)) {
      issues.push(`${path}: expected object`)
      return issues
    }
    const required = Array.isArray(schema.required)
      ? schema.required.filter((entry): entry is string => typeof entry === 'string')
      : []
    required.forEach(key => {
      if (isMissingValue(value[key])) issues.push(`${path}.${key}: missing required`)
    })
    const properties = isPlainObject(schema.properties) ? schema.properties : {}
    Object.entries(properties).forEach(([key, propSchema]) => {
      if (value[key] === undefined || !isPlainObject(propSchema)) return
      issues.push(...validateValueAgainstSchema(value[key], propSchema, `${path}.${key}`))
    })
  }

  return issues
}

function analyzeToolTrace(segment: TaskSegment, tools?: OpenAITool[]): { trace: ToolTraceSummary; score: number | null; calledTools: string[] } {
  const toolMap = new Map((tools ?? []).map(tool => [tool.function.name, tool]))
  const trace: ToolTraceSummary = {
    totalToolCalls: 0,
    validToolCalls: 0,
    invalidToolCalls: 0,
    unknownTools: 0,
    malformedArguments: 0,
    missingRequiredArguments: 0,
  }
  const calledTools: string[] = []

  for (const turn of segment.turns) {
    if (!turn.tool_calls?.length) continue

    for (const call of turn.tool_calls) {
      const name = call.function.name
      calledTools.push(name)
      trace.totalToolCalls += 1

      const tool = toolMap.get(name)
      if (!tool) {
        trace.invalidToolCalls += 1
        trace.unknownTools += 1
        continue
      }

      let parsedArgs: unknown
      try {
        parsedArgs = JSON.parse(call.function.arguments)
      } catch {
        trace.invalidToolCalls += 1
        trace.malformedArguments += 1
        continue
      }

      const schema = isPlainObject(tool.function.parameters) ? tool.function.parameters : null
      const schemaIssues = schema ? validateValueAgainstSchema(parsedArgs, schema) : []
      // Only use schema-based validation — no domain-specific business ID rules
      const issues = schemaIssues
      if (issues.length === 0) {
        trace.validToolCalls += 1
      } else {
        trace.invalidToolCalls += 1
        trace.missingRequiredArguments += schemaIssues.filter(issue => issue.includes('missing required')).length
        if (schemaIssues.some(issue => issue.includes('expected'))) {
          trace.malformedArguments += 1
        }
      }
    }
  }

  if (trace.totalToolCalls === 0) {
    return { trace, score: null, calledTools }
  }

  const baseScore = (trace.validToolCalls / trace.totalToolCalls) * 100
  const penalty = (trace.unknownTools * 20) + (trace.malformedArguments * 15) + (trace.missingRequiredArguments * 8)
  return {
    trace,
    score: clampScore(baseScore - penalty),
    calledTools,
  }
}

function extractJsonObject(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenced?.[1]) return fenced[1]

  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1)
  }

  return null
}

function safeMetric(value: unknown): number | null {
  if (value === null || value === undefined || value === 'null') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function detectJudgeMetricMultiplier(tasks: JudgeTaskPayload[]): number {
  const values = tasks.flatMap(task => [
    task.completion,
    task.grounding,
    task.clarification,
    task.tool_use,
  ]).filter((value): value is number => value !== null)

  const maxValue = values.length ? Math.max(...values) : 0
  if (maxValue <= 1) return 100
  if (maxValue <= 10) return 10
  return 1
}

export function buildJudgePrompt(segments: TaskSegment[]): string {
  const payload = segments.map(segment => ({
    task_index: segment.index + 1,
    task: segment.task,
    tool_trace: segment.toolTrace,
    called_tools: segment.calledTools,
    prior_context: segment.priorContext ? truncate(segment.priorContext, 900) : null,
    transcript: truncate(segment.transcript, 2200),
  }))

  return `You are evaluating an AI assistant task-by-task.

Score each task using these axes:
- completion (0-100): Did the assistant fully satisfy the user request?
- grounding (0-100): Did the assistant stay faithful to tool outputs and transcript, without inventing facts?
- clarification (0-100 or null): Was clarification behavior appropriate? Use null ONLY if clarification was completely irrelevant to this task.
- tool_use (0-100 or null): Were tool choices and arguments correct and appropriate?

CRITICAL RULE for tool_use — read carefully:
- Use null ONLY when the task is purely conversational and no tools exist or are needed (e.g. task endpoint is explicitly "ask the user for clarification").
- If tools are available AND the task requires data retrieval, lookup, comparison, or any action on real data → tool_use MUST be a number, never null.
  - Assistant called the right tool with correct arguments → tool_use: 80-100
  - Assistant called a tool but with wrong name or wrong arguments → tool_use: 10-40
  - Assistant called no tool at all when a tool was needed → tool_use: 0
- "I cannot do this without more information" when the task already provides enough info = tool_use: 0
- Unnecessary clarification when the assistant could have proceeded = lowers both completion and tool_use

Tool_use scoring examples:
- Task: "Find candidates named X" → assistant calls get_candidates correctly → tool_use: 85
- Task: "Find candidates named X" → assistant asks "which system should I search?" → tool_use: 0
- Task: "Get details for RJ20240115" → assistant calls wrong tool → tool_use: 20
- Task: "Send email to candidate" → no email tool exists → tool_use: null

Additional rules:
- Do NOT reward verbosity or polished writing by itself.
- Asking for clarification is GOOD only when the task genuinely lacks required information that cannot be inferred.
- Prior context is provided separately — use it only as established evidence, not to infer hidden facts.
- Empty tool outputs like {} or [] are not evidence for specific claims or recommendations.
- If the assistant claims it saved/fetched/generated something not in the transcript, grounding must be low.
- Status must be one of: completed, wrong, incomplete, skipped.

Return ONLY valid JSON:
{
  "tasks": [
    {
      "task_index": 1,
      "status": "completed",
      "completion": 85,
      "grounding": 90,
      "clarification": null,
      "tool_use": 80,
      "note": "One concise sentence."
    }
  ],
  "overall_assessment": "2-3 concise sentences."
}

Task packets:
${JSON.stringify(payload, null, 2)}`
}

function parseJudgeResponse(raw: string, expectedTasks: number): JudgeResponse | null {
  const jsonText = extractJsonObject(raw)
  if (!jsonText) return null

  const parsed = JSON.parse(jsonText) as Record<string, unknown>
  if (!Array.isArray(parsed.tasks)) return null

  const byIndex = new Map<number, JudgeTaskPayload>()
  parsed.tasks.forEach(entry => {
    if (!isPlainObject(entry)) return
    const taskIndex = Number(entry.task_index)
    if (!Number.isInteger(taskIndex) || taskIndex < 1 || taskIndex > expectedTasks) return
    const status = String(entry.status)
    if (!['completed', 'wrong', 'incomplete', 'skipped'].includes(status)) return
    byIndex.set(taskIndex, {
      task_index: taskIndex,
      status: status as TaskStatus,
      completion: safeMetric(entry.completion) ?? 0,
      grounding: safeMetric(entry.grounding) ?? 0,
      clarification: safeMetric(entry.clarification),
      tool_use: safeMetric(entry.tool_use),
      note: String(entry.note || ''),
    })
  })

  if (byIndex.size === 0) return null

  const tasks: JudgeTaskPayload[] = []
  for (let i = 1; i <= expectedTasks; i++) {
    tasks.push(byIndex.get(i) ?? {
      task_index: i,
      status: 'incomplete',
      completion: 0,
      grounding: 0,
      clarification: null,
      tool_use: null,
      note: 'Judge response omitted this task.',
    })
  }

  const multiplier = detectJudgeMetricMultiplier(tasks)
  tasks.forEach(task => {
    task.completion = clampScore(task.completion * multiplier)
    task.grounding = clampScore(task.grounding * multiplier)
    task.clarification = task.clarification === null ? null : clampScore(task.clarification * multiplier)
    task.tool_use = task.tool_use === null ? null : clampScore(task.tool_use * multiplier)
  })

  return {
    tasks,
    overall_assessment: String(parsed.overall_assessment || ''),
  }
}

const toolTraceEvaluator: ToolTraceEvaluator = {
  name: 'tool_trace',
  evaluate: (segment, tools) => {
    const { trace, score, calledTools } = analyzeToolTrace(segment, tools)
    segment.calledTools = calledTools
    return { trace, score }
  },
}

const checklistEvaluator: ChecklistEvaluator = {
  name: 'checklist_llm',
  evaluate: async (segments, judgeCfg, signal) => {
    const prompt = buildJudgePrompt(segments)
    let lastRaw = ''

    for (let attempt = 0; attempt < 3; attempt++) {
      const retryTail = attempt === 0
        ? ''
        : '\n\nPrevious response did not parse. Return ONLY the JSON object, no markdown, no explanation.'

      const res = await chatCompletion(
        { ...judgeCfg, maxTokens: 2500, temperature: 0 },
        [{ role: 'user', content: `${prompt}${retryTail}` }],
        signal
      )
      lastRaw = res.choices?.[0]?.message?.content || ''
      const payload = parseJudgeResponse(lastRaw, segments.length)
      if (payload) return { payload, raw: lastRaw }
    }

    return lastRaw ? { payload: null as never, raw: lastRaw } : null
  },
}

const VISUAL_EVALUATORS = {
  toolTrace: toolTraceEvaluator,
  checklistJudge: checklistEvaluator,
}

function combineWeightedScores(breakdown: TaskScoreBreakdown): number {
  const hasTool = breakdown.toolUse !== null || breakdown.toolTrace !== null

  const weighted: Array<{ value: number | null; weight: number }> = hasTool
    ? [
        { value: breakdown.completion,   weight: 0.4  },
        { value: breakdown.grounding,    weight: 0.25 },
        { value: breakdown.clarification,weight: 0.1  },
        { value: breakdown.toolUse,      weight: 0.15 },
        { value: breakdown.toolTrace,    weight: 0.1  },
      ]
    : [
        { value: breakdown.completion,   weight: 0.55 },
        { value: breakdown.grounding,    weight: 0.3  },
        { value: breakdown.clarification,weight: 0.15 },
      ]

  // Only exclude truly-null items (task genuinely doesn't use that axis).
  // value=0 must be included — it means the axis was relevant but scored zero
  // (e.g. model failed to call a required tool → tool_use=0, not null).
  const totalWeight = weighted.reduce((sum, item) => sum + (item.value === null ? 0 : item.weight), 0)
  if (totalWeight === 0) return 0

  const score = weighted.reduce((sum, item) => {
    if (item.value === null) return sum
    return sum + (item.value * item.weight)
  }, 0)

  return clampScore(score / totalWeight)
}

function fallbackAssessment(taskResults: TaskResult[]): string {
  const completed = taskResults.filter(task => task.status === 'completed').length
  const wrong = taskResults.filter(task => task.status === 'wrong').length
  const incomplete = taskResults.filter(task => task.status === 'incomplete').length
  return `Completed ${completed}/${taskResults.length} tasks. Wrong: ${wrong}. Incomplete: ${incomplete}.`
}

// ── Multi-judge helpers ────────────────────────────────────────────────

function medianOfThree(a: number, b: number, c: number): number {
  return [a, b, c].sort((x, y) => x - y)[1]
}

function medianNullable(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null)
  if (nums.length === 0) return null
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid]
}

// Pick the most common status (mode); tie-break toward worse status
function modeStatus(statuses: TaskResult['status'][]): TaskResult['status'] {
  const order: TaskResult['status'][] = ['completed', 'incomplete', 'wrong', 'skipped']
  const counts = new Map<TaskResult['status'], number>()
  for (const s of statuses) counts.set(s, (counts.get(s) ?? 0) + 1)
  const maxCount = Math.max(...counts.values())
  // Among tied statuses pick the worst (last in order)
  const tied = order.filter(s => (counts.get(s) ?? 0) === maxCount)
  return tied[tied.length - 1]
}

// Merge 3 judge payloads into one using median per metric
function mergeJudgePayloads(
  payloads: JudgeResponse[],
  expectedTasks: number
): JudgeResponse {
  const tasks: JudgeTaskPayload[] = []
  for (let i = 0; i < expectedTasks; i++) {
    const entries = payloads.map(p => p.tasks[i]).filter(Boolean)
    if (entries.length === 0) {
      tasks.push({ task_index: i + 1, status: 'incomplete', completion: 0, grounding: 0, clarification: null, tool_use: null, note: 'No judge data.' })
      continue
    }
    const completion  = medianOfThree(...(entries.map(e => e.completion)  as [number, number, number]))
    const grounding   = medianOfThree(...(entries.map(e => e.grounding)   as [number, number, number]))
    const clarification = medianNullable(entries.map(e => e.clarification))
    const tool_use    = medianNullable(entries.map(e => e.tool_use))
    const status      = modeStatus(entries.map(e => e.status))
    // Use note from the median-scoring run
    const scores      = entries.map(e => e.completion + e.grounding)
    const medianRunIdx = scores.indexOf([...scores].sort((a,b) => a-b)[Math.floor(scores.length/2)])
    const note        = entries[medianRunIdx]?.note ?? entries[0].note
    tasks.push({ task_index: i + 1, status, completion, grounding, clarification, tool_use, note })
  }
  // Use assessment from the middle run
  const midAssessment = payloads[Math.floor(payloads.length / 2)]?.overall_assessment ?? ''
  return { tasks, overall_assessment: midAssessment }
}

export async function evaluateVisualSimulation(
  turns: SimulationTurn[],
  judgeCfg: OpenAIConfig,
  signal: AbortSignal,
  options: EvaluateOptions = {}
): Promise<VisualEvaluationResult> {
  const segments = buildTaskSegments(turns, options.tasks)
  if (segments.length === 0) {
    return {
      finalScore: null,
      assessment: 'Evaluation unavailable.',
      status: 'unavailable',
      debug: {
        evaluator: 'hybrid_visual_eval_v1',
        unavailableReason: 'No task segments found in transcript.',
      },
    }
  }

  const traceScores = segments.map(segment => {
    const evaluated = VISUAL_EVALUATORS.toolTrace.evaluate(segment, options.tools)
    segment.toolTrace = evaluated.trace
    return evaluated.score
  })

  // ── Run judge 3 times and take median per metric ──────────────────
  // This eliminates judge variance (e.g. T4: 43 vs 100 on identical transcripts).
  const JUDGE_RUNS = 3
  const successfulPayloads: JudgeResponse[] = []
  const rawResponses: string[] = []

  for (let run = 0; run < JUDGE_RUNS; run++) {
    if (signal.aborted) break
    const judgeResult = await VISUAL_EVALUATORS.checklistJudge.evaluate(segments, judgeCfg, signal)
    if (judgeResult?.raw) rawResponses.push(judgeResult.raw)
    if (judgeResult && 'payload' in judgeResult && judgeResult.payload) {
      successfulPayloads.push(judgeResult.payload)
    }
  }

  if (successfulPayloads.length === 0) {
    return {
      finalScore: null,
      assessment: 'Evaluation unavailable.',
      status: 'unavailable',
      debug: {
        evaluator: 'hybrid_visual_eval_v3_median',
        rawJudgeResponse: rawResponses[0],
        parseError: 'All judge runs failed to return valid JSON.',
        unavailableReason: 'Checklist evaluator failed after 3 attempts.',
      },
    }
  }

  // If only 1-2 runs succeeded, still use what we have
  const mergedPayload = successfulPayloads.length >= 2
    ? mergeJudgePayloads(successfulPayloads, segments.length)
    : successfulPayloads[0]

  const taskResults: TaskResult[] = segments.map((segment, idx) => {
    const judged = mergedPayload.tasks[idx]
    const breakdown: TaskScoreBreakdown = {
      completion: judged.completion,
      grounding: judged.grounding,
      clarification: judged.clarification,
      toolUse: judged.tool_use,
      toolTrace: traceScores[idx],
    }

    return {
      task: segment.task,
      status: judged.status,
      score: combineWeightedScores(breakdown),
      note: judged.note,
      breakdown,
      toolTrace: segment.toolTrace,
    }
  })

  const finalScore = taskResults.length
    ? clampScore(taskResults.reduce((sum, task) => sum + task.score, 0) / taskResults.length)
    : null

  return {
    taskResults,
    finalScore,
    assessment: mergedPayload.overall_assessment || fallbackAssessment(taskResults),
    status: 'scored',
    debug: {
      evaluator: `hybrid_visual_eval_v3_median (${successfulPayloads.length}/${JUDGE_RUNS} runs)`,
      rawJudgeResponse: rawResponses.join('\n\n---JUDGE RUN---\n\n'),
    },
  }
}

// ── Multi-Judge Evaluation (Milestone 2) ─────────────────────────────────
// Runs evaluateVisualSimulation() for each judge in parallel, then computes
// a consensus score using weighted median of all successful verdicts.

export async function multiJudgeEvaluate(
  turns: SimulationTurn[],
  primaryJudgeCfg: OpenAIConfig,
  additionalJudges: Array<{ config: OpenAIConfig }>,
  signal: AbortSignal,
  options: EvaluateOptions
): Promise<MultiJudgeResult> {
  const allJudges: Array<{ cfg: OpenAIConfig; weight: number }> = [
    { cfg: primaryJudgeCfg, weight: 1 },
    ...additionalJudges.map(j => ({ cfg: j.config, weight: 1 })),
  ]

  const t0 = Date.now()
  // Run all judges in parallel — if one fails we still use the others
  const results = await Promise.allSettled(
    allJudges.map(({ cfg }) => evaluateVisualSimulation(turns, cfg, signal, options))
  )

  const verdicts: JudgeVerdict[] = results.map((r, i) => {
    const judge = allJudges[i]
    if (r.status === 'fulfilled') {
      return {
        model: judge.cfg.model,
        baseUrl: judge.cfg.baseUrl,
        finalScore: r.value.finalScore,
        taskResults: r.value.taskResults,
        assessment: r.value.assessment,
        durationMs: Date.now() - t0,
      }
    } else {
      return {
        model: judge.cfg.model,
        baseUrl: judge.cfg.baseUrl,
        finalScore: null,
        assessment: '',
        error: String(r.reason),
        durationMs: Date.now() - t0,
      }
    }
  })

  const successful = verdicts.filter(v => v.finalScore !== null)
  const scores = successful.map(v => v.finalScore as number)

  // Weighted median of successful scores
  let consensusScore: number | null = null
  let consensusAssessment = ''
  if (scores.length > 0) {
    const sorted = [...scores].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    consensusScore = sorted.length % 2 === 0
      ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
      : sorted[mid]
    // Use assessment from the verdict closest to consensus
    const closestIdx = successful.reduce((bestIdx, v, i) =>
      Math.abs((v.finalScore ?? 0) - consensusScore!) <
      Math.abs((successful[bestIdx].finalScore ?? 0) - consensusScore!)
        ? i : bestIdx, 0)
    consensusAssessment = successful[closestIdx].assessment
  }

  // Compute pairwise agreement rate (agree if scores within 15 points)
  let totalPairs = 0
  let agreedPairs = 0
  for (let i = 0; i < scores.length; i++) {
    for (let j = i + 1; j < scores.length; j++) {
      totalPairs++
      if (Math.abs(scores[i] - scores[j]) <= 15) agreedPairs++
    }
  }
  const agreementRate = totalPairs > 0 ? agreedPairs / totalPairs : 1

  return {
    verdicts,
    consensusScore,
    consensusAssessment,
    agreementRate,
    judgeCount: allJudges.length,
    successCount: successful.length,
  }
}

// ── 3-Axis Score (Milestone 2) ────────────────────────────────────────────
// Combines tool trace (programmatic), judge score (semantic), and compliance
// into a transparent 3-axis breakdown alongside the existing combined score.

export function computeThreeAxisScore(
  toolTraceScore: number | null,
  judgeScore: number | null,
  complianceScore: number
): ThreeAxisScore {
  const taskCompletion = clampScore(toolTraceScore ?? judgeScore ?? 0)
  const qualityScore   = clampScore(judgeScore ?? 0)
  const compliance     = clampScore(complianceScore)
  const combined       = clampScore(
    taskCompletion * 0.50 +
    qualityScore   * 0.35 +
    compliance     * 0.15
  )
  return { taskCompletion, qualityScore, complianceScore: compliance, combined }
}

// ── Compliance Checker (Milestone 2) ─────────────────────────────────────
// Config-driven rule evaluation — no hardcoded domain logic.

function getNestedValue(obj: unknown, path: string): unknown {
  return path.split('.').reduce((acc: unknown, key) => {
    if (acc && typeof acc === 'object' && !Array.isArray(acc)) {
      return (acc as Record<string, unknown>)[key]
    }
    return undefined
  }, obj)
}

export function checkCompliance(
  turns: SimulationTurn[],
  rules: ComplianceRule[]
): ComplianceResult {
  if (rules.length === 0) return { score: 100, passedRules: [], failedRules: [] }

  const passedRules: string[] = []
  const failedRules: string[] = []
  let totalWeight = 0
  let passedWeight = 0

  for (const rule of rules) {
    totalWeight += rule.weight
    let passed = true

    switch (rule.check) {
      case 'id_format': {
        // Check that all tool call arguments at fieldPath match the pattern
        const re = new RegExp(rule.pattern ?? '.*')
        const toolTurns = turns.filter(t => t.tool_calls?.length)
        passed = toolTurns.every(t =>
          (t.tool_calls ?? []).every(tc => {
            if (!rule.fieldPath) return true
            try {
              const args = JSON.parse(tc.function.arguments) as unknown
              const val = getNestedValue(args, rule.fieldPath)
              return val === undefined || re.test(String(val))
            } catch { return true }
          })
        )
        break
      }
      case 'must_clarify': {
        // Assistant must ask a clarifying question (contain '?') before first tool call
        const firstToolIdx = turns.findIndex(t => t.tool_calls?.length)
        const askedBefore = turns.slice(0, firstToolIdx).some(
          t => t.role === 'assistant' && t.content.includes('?')
        )
        passed = firstToolIdx === -1 || askedBefore
        break
      }
      case 'no_hallucination': {
        // Check that assistant turns don't claim success for tool calls that returned errors
        const toolResults = turns
          .filter(t => t.role === 'tool')
          .map(t => {
            try { return JSON.parse(t.content) as Record<string, unknown> } catch { return null }
          })
        const hasErrors = toolResults.some(r => r && (r.error || r.success === false))
        if (hasErrors) {
          // At least one tool returned an error — check that assistant acknowledged it
          const lastAssistant = [...turns].reverse().find(t => t.role === 'assistant')
          const content = lastAssistant?.content?.toLowerCase() ?? ''
          passed = content.includes('error') || content.includes('fail') ||
                   content.includes('unable') || content.includes('not found')
        }
        break
      }
      case 'custom_regex': {
        // Apply regex pattern across all assistant turn content
        const re = new RegExp(rule.pattern ?? '.*', 'i')
        const assistantContent = turns
          .filter(t => t.role === 'assistant')
          .map(t => t.content)
          .join('\n')
        passed = re.test(assistantContent)
        break
      }
      default:
        passed = true
    }

    if (passed) {
      passedRules.push(rule.id)
      passedWeight += rule.weight
    } else {
      failedRules.push(rule.id)
    }
  }

  const score = totalWeight > 0 ? clampScore((passedWeight / totalWeight) * 100) : 100

  return { score, passedRules, failedRules }
}
