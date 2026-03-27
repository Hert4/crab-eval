import {
  SimulationEvaluationDebug,
  SimulationTurn,
  TaskResult,
  TaskScoreBreakdown,
  ToolTraceSummary,
} from '@/types'
import { chatCompletion, OpenAIConfig, OpenAITool } from './openai'

type TaskStatus = TaskResult['status']

interface TaskSegment {
  index: number
  task: string
  transcript: string
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

function truncate(text: string, max = 2800): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}

function buildSegmentTranscript(turns: SimulationTurn[]): string {
  return turns.map(turn => {
    if (turn.role === 'tool') {
      return `TOOL[${turn.tool_name}]: ${truncate(turn.content, 400)}`
    }
    const label = turn.role === 'user' ? 'USER' : 'ASSISTANT'
    const toolLine = turn.tool_calls?.length
      ? `\nCALLS: ${turn.tool_calls.map(tc => `${tc.function.name}(${tc.function.arguments})`).join(' | ')}`
      : ''
    return `${label}:${toolLine}\n${turn.content}`
  }).join('\n\n---\n\n')
}

function buildTaskSegments(turns: SimulationTurn[], tasks?: string[]): TaskSegment[] {
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
      const issues = schema ? validateValueAgainstSchema(parsedArgs, schema) : []
      if (issues.length === 0) {
        trace.validToolCalls += 1
      } else {
        trace.invalidToolCalls += 1
        trace.missingRequiredArguments += issues.filter(issue => issue.includes('missing required')).length
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
  return Number.isFinite(parsed) ? clampScore(parsed) : null
}

function buildJudgePrompt(segments: TaskSegment[]): string {
  const payload = segments.map(segment => ({
    task_index: segment.index + 1,
    task: segment.task,
    tool_trace: segment.toolTrace,
    called_tools: segment.calledTools,
    transcript: truncate(segment.transcript, 2600),
  }))

  return `You are evaluating an AI assistant task-by-task.

Score each task using these axes:
- completion: Did the assistant satisfy the user request?
- grounding: Did the assistant stay faithful to the available transcript/tool outputs, without inventing facts/actions?
- clarification: Was any clarification behavior appropriate and efficient? Use null if irrelevant.
- tool_use: Were tool choices and tool-call arguments appropriate? Use null if tools were not relevant.

Rules:
- Do NOT reward verbosity or polished writing by itself.
- Wrong or malformed tool calls should reduce tool_use.
- Asking for clarification is GOOD only when the task truly lacks the needed information.
- If the assistant keeps asking for IDs while it could reasonably continue from available data, lower completion/tool_use.
- If the assistant claims it saved/fetched/generated something not supported by the transcript, grounding must be low.
- Status must be one of: completed, wrong, incomplete, skipped.

Return ONLY valid JSON:
{
  "tasks": [
    {
      "task_index": 1,
      "status": "completed",
      "completion": 0,
      "grounding": 0,
      "clarification": null,
      "tool_use": null,
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
        { value: breakdown.completion, weight: 0.4 },
        { value: breakdown.grounding, weight: 0.25 },
        { value: breakdown.clarification, weight: 0.1 },
        { value: breakdown.toolUse, weight: 0.15 },
        { value: breakdown.toolTrace, weight: 0.1 },
      ]
    : [
        { value: breakdown.completion, weight: 0.55 },
        { value: breakdown.grounding, weight: 0.3 },
        { value: breakdown.clarification, weight: 0.15 },
      ]

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

  const judgeResult = await VISUAL_EVALUATORS.checklistJudge.evaluate(segments, judgeCfg, signal)
  if (!judgeResult || !('payload' in judgeResult) || !judgeResult.payload) {
    return {
      finalScore: null,
      assessment: 'Evaluation unavailable.',
      status: 'unavailable',
      debug: {
        evaluator: 'hybrid_visual_eval_v1',
        rawJudgeResponse: judgeResult?.raw,
        parseError: 'Judge response could not be parsed after retries.',
        unavailableReason: 'Checklist evaluator failed to return valid JSON.',
      },
    }
  }

  const taskResults: TaskResult[] = segments.map((segment, idx) => {
    const judged = judgeResult.payload.tasks[idx]
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
    assessment: judgeResult.payload.overall_assessment || fallbackAssessment(taskResults),
    status: 'scored',
    debug: {
      evaluator: 'hybrid_visual_eval_v1',
      rawJudgeResponse: judgeResult.raw,
    },
  }
}
