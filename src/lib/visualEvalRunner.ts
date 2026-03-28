import { SimulationTurn, SimulationResult, TaskResult, FrozenToolResponse, FrozenOracleDataset, ToolDefinition, MultiJudgeResult, ComplianceRule } from '@/types'
import { chatCompletion, OpenAIConfig, OpenAIMessage, OpenAITool, getApiKey } from './openai'
import { useVisualEvalStore, getSimController, abortSim, BatchModelResult } from '@/store/visualEvalStore'
import { evaluateVisualSimulation, buildTaskSegments, buildJudgePrompt, multiJudgeEvaluate, checkCompliance, computeThreeAxisScore } from './visualEvalEvaluators'
import { simpleHash } from './hash'

// ── Sanitize a single JSON Schema property recursively ───────────────
// Normalize non-standard type strings that LLMs sometimes generate:
// "array_string", "string_array", "array[string]", "array<string>" → type:array + items:string
// "integer" → keep as integer (valid JSON Schema)
// anything else unknown → fallback to "string"
const VALID_TYPES = new Set(['string','number','integer','boolean','array','object','null'])

function normalizeType(raw: unknown): { type: string; inferredItemType?: string } {
  const t = String(raw ?? 'string').trim().toLowerCase()
  if (VALID_TYPES.has(t)) return { type: t }

  // "array_string", "string_array", "array[string]", "array<string>", "array of string"
  if (/array.*(str|text)/i.test(t) || /str.*array/i.test(t)) return { type: 'array', inferredItemType: 'string' }
  if (/array.*(num|int|float)/i.test(t) || /(num|int).*array/i.test(t)) return { type: 'array', inferredItemType: 'number' }
  if (/array.*(bool)/i.test(t)) return { type: 'array', inferredItemType: 'boolean' }
  if (/array/i.test(t)) return { type: 'array', inferredItemType: 'string' }

  // "int", "float", "double" → number
  if (/^(int|float|double|decimal)$/i.test(t)) return { type: 'number' }
  if (/^bool$/i.test(t)) return { type: 'boolean' }

  return { type: 'string' }  // safe fallback
}

function sanitizeProp(raw: Record<string, unknown>): Record<string, unknown> {
  const { type, inferredItemType } = normalizeType(raw.type)
  const result: Record<string, unknown> = { type }

  if (raw.description) result.description = String(raw.description)
  if (Array.isArray(raw.enum)) result.enum = raw.enum

  if (type === 'array') {
    // GPT-4.1 + Claude REQUIRE items when type=array
    const rawItems = raw.items as Record<string, unknown> | undefined
    result.items = rawItems && typeof rawItems === 'object'
      ? sanitizeProp(rawItems)
      : { type: inferredItemType ?? 'string' }
  }

  if (type === 'object') {
    if (raw.properties && typeof raw.properties === 'object') {
      const props: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(raw.properties as Record<string, unknown>)) {
        props[k] = v && typeof v === 'object' ? sanitizeProp(v as Record<string, unknown>) : { type: 'string' }
      }
      result.properties = props
    } else {
      result.properties = {}
    }
    if (Array.isArray(raw.required) && raw.required.every((x: unknown) => typeof x === 'string')) {
      result.required = raw.required
    }
  }

  return result
}

// ── Sanitize tools → valid JSON Schema for all providers ─────────────
function sanitizeTools(tools: OpenAITool[]): OpenAITool[] {
  return tools.map(tool => {
    const fn = tool.function
    const raw = (fn.parameters ?? {}) as Record<string, unknown>

    const params: Record<string, unknown> = { type: 'object' }

    if (raw.properties && typeof raw.properties === 'object') {
      const sanitizedProps: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(raw.properties as Record<string, unknown>)) {
        sanitizedProps[k] = v && typeof v === 'object'
          ? sanitizeProp(v as Record<string, unknown>)
          : { type: 'string' }
      }
      params.properties = sanitizedProps
    } else {
      params.properties = {}
    }

    if (Array.isArray(raw.required) && raw.required.every((x: unknown) => typeof x === 'string')) {
      params.required = raw.required
    }

    return {
      type: 'function' as const,
      function: {
        name: fn.name,
        ...(fn.description ? { description: fn.description } : {}),
        parameters: params,
      },
    }
  })
}

// ── Config ────────────────────────────────────────────────────────────
export interface SimConfig {
  scenarioName: string
  scenarioDescription: string
  targetSystemPrompt: string
  targetConfig: {
    baseUrl: string
    model: string
    maxTokens: number
    temperature: number
  }
  userConfig: {
    baseUrl: string
    model: string
    maxTokens: number
  }
  oracleConfig?: {
    baseUrl: string
    model: string
    maxTokens: number
  }
  // Judge model — dedicated evaluator separate from User Model.
  // Falls back to userConfig when not provided.
  judgeConfig?: {
    baseUrl: string
    model: string
  }
  // Additional judges for multi-judge consensus (Milestone 2)
  additionalJudges?: Array<{ baseUrl: string; model: string; apiKeyName?: string }>
  // Compliance rules for programmatic checks (Milestone 2)
  complianceRules?: ComplianceRule[]
  // Runs per model for statistical rigor (Milestone 3) — default 1, max 10
  runsPerModel?: number
  // Adaptive Replay — auto-inject confirmation replies when target asks clarification
  adaptiveReplay?: boolean         // default true
  maxClarificationRetries?: number // default 2
  maxTurns: number
  tools?: OpenAITool[]
  mockContext?: string
  // Ordered task list — User Model delivers these one by one to Target Model.
  // When set, User Model is told to ONLY deliver these tasks, nothing else.
  tasks?: string[]
  // Replay script — verbatim user messages from a previous run (skips User Model).
  replayScript?: string[]
}

interface SimulationRuntimeOptions {
  sharedOracleCache?: Map<string, string>
  worldState?: string             // pre-generated fixed mock database for this batch
  frozenOracleDatasetId?: string  // ID of the FrozenOracleDataset used (M1)
  runIndex?: number               // 0-based index within multi-run batch (M3)
  totalRuns?: number              // total runs requested for this model (M3)
}

const EVALUATION_VERSION = '2.0.0'

// ── Oracle schema validation ──────────────────────────────────────────
// Validates tool call arguments against the tool's JSON Schema.
// Returns null if valid, or an error string describing what's wrong.
function validateToolCall(
  toolName: string,
  argsJson: string,
  tools: OpenAITool[] | undefined
): string | null {
  if (!tools || tools.length === 0) return null

  const toolDef = tools.find(t => t.function.name === toolName)
  if (!toolDef) {
    return `Unknown tool "${toolName}". Available tools: ${tools.map(t => t.function.name).join(', ')}.`
  }

  const params = toolDef.function.parameters as Record<string, unknown> | undefined
  if (!params) return null

  let args: Record<string, unknown>
  try {
    args = JSON.parse(argsJson)
    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
      return `Arguments must be a JSON object, got: ${typeof args}`
    }
  } catch {
    return `Malformed JSON arguments: ${argsJson.slice(0, 100)}`
  }

  const required = (params.required as string[] | undefined) ?? []
  const properties = (params.properties as Record<string, Record<string, unknown>> | undefined) ?? {}

  // Check required params
  const missing = required.filter(k => !(k in args) || args[k] === null || args[k] === undefined || args[k] === '')
  if (missing.length > 0) {
    return `Missing required parameter(s): ${missing.join(', ')}. Tool "${toolName}" requires: ${required.join(', ')}.`
  }

  // Check types for provided params
  const typeErrors: string[] = []
  for (const [key, val] of Object.entries(args)) {
    const schema = properties[key]
    if (!schema) continue // unknown extra param — allow (lenient)
    const expectedType = schema.type as string | undefined
    if (!expectedType) continue
    const actualType = Array.isArray(val) ? 'array' : typeof val
    if (expectedType === 'integer' && typeof val === 'number') continue // number OK for integer
    if (actualType !== expectedType) {
      typeErrors.push(`"${key}" should be ${expectedType} but got ${actualType} (value: ${JSON.stringify(val)})`)
    }
  }
  if (typeErrors.length > 0) {
    return `Type mismatch in tool "${toolName}": ${typeErrors.join('; ')}`
  }

  return null // valid
}

function normalizeReplayScript(messages?: string[]): string[] {
  return (messages ?? []).map(m => m.trim()).filter(Boolean)
}

function normalizeTaskText(task: string): string {
  return task.replace(/\s+/g, ' ').trim()
}

function parseStringArrayResponse(text: string): string[] {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || text.match(/(\[[\s\S]*\])/)
  const parsed = JSON.parse(match ? match[1] : text)
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((value): value is string => typeof value === 'string')
    .map(normalizeTaskText)
    .filter(Boolean)
}

function collectTaskListIssues(tasks: string[], expectedCount: number): string[] {
  // Only check structural issues deterministically — count and duplicates.
  // Semantic issues (dependency on prior tasks, bad patterns) are caught by
  // the LLM reviewer in validateTasksWithLLM() — no hardcoded regex needed.
  const issues: string[] = []
  if (tasks.length !== expectedCount) {
    issues.push(`expected exactly ${expectedCount} tasks but got ${tasks.length}`)
  }
  const seen = new Set<string>()
  tasks.forEach((task, idx) => {
    const normalized = task.trim().toLowerCase().replace(/\s+/g, ' ')
    if (seen.has(normalized)) issues.push(`task ${idx + 1} duplicates an earlier task`)
    seen.add(normalized)
  })
  return issues
}

async function validateTasksWithLLM(
  tasks: string[],
  targetSystemPrompt: string,
  scenarioDescription: string,
  cfg: OpenAIConfig,
  signal: AbortSignal
): Promise<string[]> {
  const prompt = `You are reviewing an evaluation task list for an AI assistant benchmark.

Assistant role: ${targetSystemPrompt}
Scenario: ${scenarioDescription}

Task list:
${tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Check each task for these problems:
- Depends on results from a previous task (not self-contained)
- Requires a future user reply before the task can be completed (mixes clarification + execution in one task)
- Is too vague to be verifiable
- Is a duplicate of another task (same intent, different wording)
- All tasks are happy-path only (no edge cases, no error handling, no clarification tasks)

If the task list is acceptable, return exactly: OK
If there are problems, return a short bullet list of issues (no JSON, no markdown). Be concise.`

  try {
    const res = await chatCompletion(
      { ...cfg, maxTokens: 300, temperature: 0 },
      [{ role: 'user', content: prompt }],
      signal
    )
    const text = res.choices?.[0]?.message?.content?.trim() ?? ''
    if (!text || text.toUpperCase().startsWith('OK')) return []
    // Parse bullet lines as individual issues
    return text.split('\n').map(l => l.replace(/^[-•*]\s*/, '').trim()).filter(Boolean)
  } catch {
    return [] // validation failure is non-fatal — proceed with tasks as-is
  }
}

function buildTasksPrompt(
  targetSystemPrompt: string,
  scenarioDescription: string,
  toolNames: string,
  numTasks: number,
  feedback = ''
): string {
  // Distribute task types across the set for balanced coverage.
  // For N tasks: ~40% happy path, ~30% edge/error cases, ~20% multi-step, ~10% clarification-required.
  const edgeCount = Math.max(1, Math.round(numTasks * 0.3))
  const clarifyCount = Math.max(1, Math.round(numTasks * 0.1))
  const happyCount = numTasks - edgeCount - clarifyCount

  return `You are designing a RIGOROUS evaluation test suite for an AI assistant. The test must expose real capability differences between strong and weak models — not just happy-path scenarios.

Assistant role: ${targetSystemPrompt}
Scenario: ${scenarioDescription}
${toolNames ? `Available tools: ${toolNames}` : ''}

Generate exactly ${numTasks} tasks with the following MANDATORY distribution:

HAPPY PATH tasks (${happyCount} tasks) — normal requests where data exists and tools work:
- Each task must test a DIFFERENT action type — no two tasks may perform the same kind of operation
- Require using the correct tool with correct arguments
- Verifiable from tool output alone

EDGE / ERROR HANDLING tasks (${edgeCount} tasks) — tasks that test robustness:
- Request targets an entity that does NOT exist → assistant must report not found, not hallucinate
- Tool returns empty or null result → assistant must handle gracefully, not invent data
- Request references an ambiguous or slightly malformed identifier → assistant must seek clarification or explain the issue
- Request asks for information the tool does not provide → assistant must acknowledge the limitation
- Each edge task must test a DIFFERENT failure mode

CLARIFICATION-REQUIRED tasks (${clarifyCount} tasks) — tasks where the assistant MUST ask before acting:
- Request is intentionally missing a required piece of information
- The correct behavior is to ask the user for the missing info, NOT to proceed with assumptions

Rules for ALL tasks:
- Be self-contained — no dependency on prior tasks or hidden results
- Be completable within 1-3 tool calls (or 0 tool calls for clarification tasks)
- Use realistic entity identifiers when mentioned (infer format from tool descriptions)
- DIVERSITY IS MANDATORY: no two tasks should trigger the same tool for the same purpose
- Do NOT name or hint at specific tool names in the task description — describe what the user wants, not how to implement it

Avoid bad task patterns:
- Tasks that combine clarification and execution in one request
- Tasks that depend on the result of a previous task
- Multiple tasks that repeat the same operation on different identifiers — that is one task type, not many
- All tasks being straightforward retrievals with data guaranteed to exist

${feedback ? `Previous draft problems that must be fixed:\n${feedback}\n` : ''}
Return ONLY a JSON array of exactly ${numTasks} task strings (no explanation, no markdown):
["Task description 1", "Task description 2", ...]`
}

function postProcessOracleResponse(raw: string): string {
  // Validate JSON and return clean string (no domain-specific ID normalization)
  try {
    const parsed = JSON.parse(raw) as unknown
    return JSON.stringify(parsed)
  } catch {
    // Not valid JSON — return as-is
    return raw
  }
}

function stableSortJson(value: unknown): unknown {  if (Array.isArray(value)) return value.map(stableSortJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, stableSortJson(v)])
    )
  }
  return value
}

function getToolCallCacheKey(name: string, rawArgs: string): string {
  try {
    const parsed = JSON.parse(rawArgs) as unknown
    return `${name}:${JSON.stringify(stableSortJson(parsed))}`
  } catch {
    return `${name}:${rawArgs.trim()}`
  }
}

async function buildBatchReplayScript(
  config: Omit<SimConfig, 'targetConfig'>,
  signal: AbortSignal
): Promise<string[] | undefined> {
  const explicitReplay = normalizeReplayScript(config.replayScript)
  if (explicitReplay.length > 0) return explicitReplay

  const taskReplay = normalizeReplayScript(config.tasks)
  const requestedCount = taskReplay.length > 0 ? taskReplay.length : config.maxTurns

  const userApiKey = getApiKey('visual_user_api_key')
  const userCfg: OpenAIConfig = {
    baseUrl: config.userConfig.baseUrl,
    apiKey: userApiKey,
    model: config.userConfig.model,
    maxTokens: 1500,
    temperature: 0,
  }

  const toolList = config.tools?.length
    ? `Available tools for the assistant:\n${config.tools.map(t => `- ${t.function.name}: ${t.function.description ?? ''}`).join('\n')}`
    : ''

  const prompt = `Create a FIXED replay script for benchmarking multiple AI assistants fairly.

Scenario: ${config.scenarioDescription}
Assistant role: ${config.targetSystemPrompt || '(none provided)'}
${toolList ? toolList + '\n' : ''}${taskReplay.length > 0 ? `Benchmark tasks to rewrite into natural end-user messages (keep order and intent):
${taskReplay.map((task, idx) => `${idx + 1}. ${task}`).join('\n')}` : ''}

Return ONLY a JSON array of exactly ${requestedCount} concise user messages.

Rules:
- If benchmark tasks are provided, rewrite EACH task into one realistic user message.
- Remove benchmark/meta phrasing such as "hãy dùng tool", "gọi tool", "người dùng yêu cầu", or any evaluation instructions.
- Each message must be self-contained and include any fictional names, IDs, or dates needed.
- Each message must be answerable within one assistant response cycle. Do NOT require a future user reply unless the whole goal is to ask for clarification/confirmation.
- Do NOT depend on previous assistant replies or hidden earlier task outputs.
- Keep exact entity identifier formats as they appear in the scenario — never alter IDs or reformatting them
- Do NOT include explanations, numbering, or markdown.
- Make the messages realistic for the scenario and varied enough to exercise the assistant.
${toolList ? `
CRITICAL — Tool Coverage Constraint:
- ONLY generate tasks that can be completed using the tools listed above.
- Before including a task, verify: "Is there a tool in the list that directly supports this action?"
- Do NOT create tasks that require data fields no tool returns (e.g. "get email" when no tool returns emails).
- Do NOT create tasks that require the user to provide IDs the system cannot discover (e.g. "list top 5 candidates" when the tool requires specific CandidateIDs as input).
- If the scenario implies capabilities not covered by the tool list, skip those tasks and use tasks the tools CAN handle.
` : ''}`

  try {
    const res = await chatCompletion(
      userCfg,
      [{ role: 'user', content: prompt }],
      signal
    )
    const text = res.choices?.[0]?.message?.content || ''
    const replay = normalizeReplayScript(parseStringArrayResponse(text))
    return replay.length > 0 ? replay : undefined
  } catch {
    return undefined
  }
}

// ── Task validation against tool schema ──────────────────────────────────
/**
 * Log warnings for replay script messages that request data fields
 * no available tool can provide. Does NOT modify or filter the script —
 * only surfaces potential benchmark quality issues to the console.
 */
function validateTasksAgainstTools(
  replayScript: string[],
  tools: OpenAITool[] | undefined
): void {
  if (!tools?.length) return

  // Fields that tasks commonly request but tools may not support
  const suspectFields = ['email', 'phone', 'address', 'salary', 'photo', 'avatar', 'password']

  for (let i = 0; i < replayScript.length; i++) {
    const msg = replayScript[i].toLowerCase()
    for (const field of suspectFields) {
      if (msg.includes(field)) {
        const toolHasField = tools.some(t => {
          const desc = (t.function.description ?? '').toLowerCase()
          const name = t.function.name.toLowerCase()
          const params = JSON.stringify(t.function.parameters ?? {}).toLowerCase()
          return desc.includes(field) || name.includes(field) || params.includes(field)
        })
        if (!toolHasField) {
          console.warn(
            `[TaskValidation] Task ${i + 1} requests "${field}" but no tool provides it. ` +
            `This may cause correct refusals to be mistaken for failures.`
          )
        }
      }
    }
  }
}

// ── Adaptive Replay helpers ───────────────────────────────────────────────

/**
 * Detect if assistant response is a clarification question rather than task completion.
 * Returns true only when ALL hold:
 *  1. No tool_calls in this response
 *  2. Response contains a '?'
 *  3. Response contains known clarification signals (Vietnamese + English)
 */
function detectClarification(assistantText: string, hadToolCalls: boolean): boolean {
  if (hadToolCalls) return false
  if (!assistantText || assistantText.length < 10) return false
  if (!assistantText.includes('?')) return false

  const clarificationSignals = [
    // Vietnamese
    'xác nhận', 'vui lòng', 'cung cấp', 'cho mình', 'cho tôi',
    'bạn có thể', 'chưa thể', 'chưa đủ', 'thiếu', 'cần thêm',
    'đúng không', 'đúng chưa', 'phải không', 'chính xác',
    'định dạng', 'hợp lệ', 'không hợp lệ',
    // English
    'confirm', 'clarify', 'provide', 'specify', 'verify',
    'could you', 'can you', 'please provide', 'which one',
    'before i can', 'before proceeding', 'need to know',
    'correct format', 'valid', 'invalid', 'what is the',
    'which format', 'please confirm',
  ]

  const lower = assistantText.toLowerCase()
  return clarificationSignals.some(signal => lower.includes(signal))
}

/**
 * Generate a short confirmation reply to unblock a target model that asked clarification.
 * Uses User Model config to produce a natural 1-2 sentence reply.
 * Falls back to a generic Vietnamese confirmation on any error.
 */
async function generateClarificationReply(
  clarificationText: string,
  conversationContext: OpenAIMessage[],
  userCfg: OpenAIConfig,
  signal: AbortSignal
): Promise<string> {
  const systemPrompt = `You are simulating a user in a testing scenario. The AI assistant just asked you a clarification question.
Your job: give the SHORTEST possible confirmation or answer to unblock the assistant so it can proceed with the task.

Rules:
- Reply in the same language as the conversation (Vietnamese if conversation is in Vietnamese)
- Confirm what the assistant asked — say yes, provide the info they need
- Keep it to 1-2 sentences maximum
- Do NOT ask new questions
- Do NOT introduce new tasks
- If the assistant asks about ID format, confirm whichever format they suggest
- If the assistant asks for missing info, provide a reasonable placeholder

Example: If assistant says "Bạn xác nhận dùng CND-55087 nhé?" → Reply: "Đúng rồi, dùng CND-55087."
Example: If assistant says "Could you confirm the RecruitmentID format?" → Reply: "Yes, use whatever format your system requires."`

  const messages: OpenAIMessage[] = [
    { role: 'system', content: systemPrompt },
    ...conversationContext.slice(-6),
    { role: 'user', content: `The assistant just said:\n"${clarificationText.slice(0, 500)}"\n\nGenerate a short confirmation reply to unblock them.` },
  ]

  try {
    const res = await chatCompletion(
      { ...userCfg, maxTokens: 256, temperature: 0.3 },
      messages,
      signal
    )
    const reply = res.choices?.[0]?.message?.content?.trim() || ''
    return reply || 'Đúng rồi, bạn tiếp tục đi.'
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    return 'Đúng rồi, bạn tiếp tục đi.'
  }
}

/**
 * Handle a list of tool calls against oracle — shared by main loop and adaptive retry loop.
 * Mutates oracleMemory, oracleCache, and appends turns/messages.
 * Returns the updated turnIndex.
 */
async function handleToolCalls(
  toolCalls: Array<{ id: string; name: string; arguments: string }>,
  oracleCfg: OpenAIConfig,
  targetCfg: OpenAIConfig,
  targetMessages: OpenAIMessage[],
  oracleMemory: Map<string, string>,
  runtime: SimulationRuntimeOptions,
  tools: OpenAITool[] | undefined,
  config: SimConfig,
  addTurn: (t: SimulationTurn) => void,
  currentTurnIndex: number,
  signal: AbortSignal
): Promise<{ turnIndex: number; hadAnyCall: boolean }> {
  let turnIndex = currentTurnIndex

  for (const tc of toolCalls) {
    if (signal.aborted) break

    const cacheKey = getToolCallCacheKey(tc.name, tc.arguments)
    const cached = runtime.sharedOracleCache?.get(cacheKey)
    let mockResult = cached || '{}'

    if (!cached) {
      const validationError = validateToolCall(tc.name, tc.arguments, tools)
      if (validationError) {
        mockResult = JSON.stringify({ error: validationError })
      } else {
        const memoryEntries = [...oracleMemory.entries()].slice(-20)
        const memoryStr = memoryEntries.length > 0
          ? memoryEntries.map(([k, v]) => `${k}:\n${v}`).join('\n\n')
          : ''
        const oracleMessages: OpenAIMessage[] = [
          { role: 'system', content: buildOracleSystemPrompt(config.mockContext || '', memoryStr, runtime.worldState) },
          { role: 'user', content: `Tool called: ${tc.name}\nArguments: ${tc.arguments}\n\nReturn a realistic JSON object this tool would return.` },
        ]
        try {
          const mockRes = await chatCompletion({ ...oracleCfg, maxTokens: 1024 }, oracleMessages, signal)
          const raw = mockRes.choices?.[0]?.message?.content?.trim() || '{}'
          const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
          try {
            JSON.parse(stripped)
            mockResult = postProcessOracleResponse(stripped)
          } catch { mockResult = raw }
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') throw e
        }
        runtime.sharedOracleCache?.set(cacheKey, mockResult)
      }
    }

    oracleMemory.set(cacheKey, mockResult)

    addTurn({ turnIndex: turnIndex++, role: 'tool', content: mockResult, tool_name: tc.name })
    targetMessages.push({ role: 'tool', tool_call_id: tc.id, name: tc.name, content: mockResult })
  }

  // Target responds after all tool results
  if (!signal.aborted && toolCalls.length > 0) {
    try {
      const afterRes = await chatCompletion(targetCfg, targetMessages, signal)
      const afterText = afterRes.choices?.[0]?.message?.content || ''
      if (afterText) {
        addTurn({ turnIndex: turnIndex++, role: 'assistant', content: afterText })
        targetMessages.push({ role: 'assistant', content: afterText })
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e
    }
  }

  return { turnIndex, hadAnyCall: toolCalls.length > 0 }
}

// ── Module-level singleton ────────────────────────────────────────────
let _simPromise: Promise<void> | null = null

export function isSimRunning(): boolean {
  return !!_simPromise
}

export async function startSimulation(config: SimConfig): Promise<void> {
  if (_simPromise) return
  const store = useVisualEvalStore.getState()
  store.startSim(config.maxTurns, config.tasks?.length ?? 0)
  const controller = getSimController()
  _simPromise = _runSimulation(config, controller.signal)
    .catch((e) => {
      if (e instanceof DOMException && e.name === 'AbortError') {
        useVisualEvalStore.getState().setError('Stopped by user')
      } else {
        useVisualEvalStore.getState().setError(String(e))
      }
    })
    .finally(() => { _simPromise = null })
}

export function stopSimulation(): void {
  abortSim()
  useVisualEvalStore.getState().setError('Stopped by user')
  _simPromise = null
}

// ── Batch simulation — run multiple target models sequentially ────────
export interface BatchTargetModel {
  baseUrl: string
  model: string
  apiKey?: string
}

export async function startBatchSimulation(
  targets: BatchTargetModel[],
  baseConfig: Omit<SimConfig, 'targetConfig'>
): Promise<void> {
  if (_simPromise) return
  const store = useVisualEvalStore.getState()
  store.startBatch(targets.length, baseConfig.maxTurns, baseConfig.tasks?.length ?? 0)
  store.updateStatus('Preparing fair batch — shared replay + tool cache…')

  _simPromise = (async () => {
    const controller = getSimController()
    const fallbackReplayScript = normalizeReplayScript(baseConfig.tasks)
    const sharedReplayScript = await buildBatchReplayScript(baseConfig, controller.signal)
      ?? (fallbackReplayScript.length > 0 ? fallbackReplayScript : undefined)
    if (!sharedReplayScript || sharedReplayScript.length === 0) {
      throw new Error('Unable to build a shared replay script for fair batch comparison.')
    }
    // Fix 1: Warn about tasks that reference fields no tool can provide
    validateTasksAgainstTools(sharedReplayScript, baseConfig.tools)
    const sharedOracleCache = new Map<string, string>()

    // ── Pre-generate world state (oracle calls this ONCE, all models share it) ──
    const userApiKey = getApiKey('visual_user_api_key')
    const oracleApiKey = getApiKey('visual_oracle_api_key') || userApiKey
    const oracleCfgForWorldState: OpenAIConfig = baseConfig.oracleConfig
      ? { baseUrl: baseConfig.oracleConfig.baseUrl, apiKey: oracleApiKey, model: baseConfig.oracleConfig.model, maxTokens: 8000 }
      : { baseUrl: baseConfig.userConfig.baseUrl, apiKey: oracleApiKey, model: baseConfig.userConfig.model, maxTokens: 8000 }

    useVisualEvalStore.getState().updateStatus('Generating shared world state for fair oracle…')
    const parsedTools: OpenAITool[] | undefined = baseConfig.tools
    console.log('[worldState] oracleCfg model:', oracleCfgForWorldState.model, 'baseUrl:', oracleCfgForWorldState.baseUrl)
    console.log('[worldState] tools count:', parsedTools?.length ?? 0, '| tasks count:', baseConfig.tasks?.length ?? 0, '| replayScript len:', sharedReplayScript.length)
    console.log('[worldState] apiKey present:', !!oracleApiKey)

    // Classify tasks → separate positive (need data) from negative (need data absent)
    // Use oracle cfg for classify call (small, fast)
    const classifierCfg: OpenAIConfig = { ...oracleCfgForWorldState, maxTokens: 200 }
    const classified = baseConfig.tasks && baseConfig.tasks.length > 0
      ? await classifyTasks(baseConfig.tasks, classifierCfg, controller.signal)
      : { positive: sharedReplayScript, negative: [] }

    const worldState = await generateWorldState(
      sharedReplayScript,
      classified.positive.length > 0 ? classified.positive : (baseConfig.tasks ?? sharedReplayScript),
      parsedTools,
      baseConfig.mockContext,
      oracleCfgForWorldState,
      controller.signal,
      classified.negative
    )

    if (worldState) {
      useVisualEvalStore.getState().updateStatus(`World state ready (${worldState.length} chars) — generating frozen oracle…`)
    } else {
      useVisualEvalStore.getState().updateStatus('World state unavailable — generating frozen oracle with live fallback…')
    }

    // ── Generate frozen oracle dataset (M1) ───────────────────────────
    // Oracle runs a dry-run simulation to discover all tool calls, then
    // pre-populates sharedOracleCache so every target model gets identical responses.
    let frozenDataset: FrozenOracleDataset | undefined
    try {
      frozenDataset = await generateFrozenOracle(
        sharedReplayScript,
        oracleCfgForWorldState,
        baseConfig.mockContext ?? '',
        worldState,
        parsedTools,
        baseConfig.scenarioName ?? 'unnamed',
        controller.signal
      )
      // Pre-populate shared cache from frozen dataset
      for (const entry of frozenDataset.entries) {
        sharedOracleCache.set(entry.cacheKey, entry.response)
      }
      useVisualEvalStore.getState().updateStatus(`Frozen oracle ready (${frozenDataset.entries.length} responses) — starting batch…`)
      console.log(`[Oracle] Frozen dataset: ${frozenDataset.datasetId} — ${frozenDataset.entries.length} entries`)
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e
      console.warn('[Oracle] Failed to generate frozen dataset — using live oracle fallback:', e)
      useVisualEvalStore.getState().updateStatus('Frozen oracle failed — using live oracle…')
    }

    const runsPerModel = Math.max(1, Math.min(10, baseConfig.runsPerModel ?? 1))
    const totalBatchSteps = targets.length * runsPerModel
    let stepIndex = 0

    for (let runIdx = 0; runIdx < runsPerModel; runIdx++) {
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i]
        if (controller.signal.aborted) break

        useVisualEvalStore.getState().nextBatchModel(stepIndex, target.model, baseConfig.maxTurns, baseConfig.tasks?.length ?? 0)
        if (runsPerModel > 1) {
          useVisualEvalStore.getState().updateStatus(`[${stepIndex + 1}/${totalBatchSteps}] ${target.model} (run ${runIdx + 1}/${runsPerModel})…`)
        }
        stepIndex++

        const simConfig: SimConfig = {
          ...baseConfig,
          replayScript: sharedReplayScript,
          targetConfig: {
            baseUrl: target.baseUrl,
            model: target.model,
            maxTokens: 4096,
            temperature: 0.3,
          },
        }

        const startTime = Date.now()
        let batchResult: BatchModelResult

        try {
          await _runSimulation(simConfig, controller.signal, {
            sharedOracleCache,
            worldState,
            frozenOracleDatasetId: frozenDataset?.datasetId,
            runIndex: runIdx,
            totalRuns: runsPerModel,
          })
          const state = useVisualEvalStore.getState()
          const fr = state.finalResult

          // Compute avg from taskResults on finalResult
          const taskScores = fr?.taskResults?.map((t: TaskResult) => t.score) ?? []
          const avgScore = taskScores.length
            ? Math.round(taskScores.reduce((a: number, b: number) => a + b, 0) / taskScores.length)
            : fr?.finalScore ?? null

          batchResult = {
            model: target.model,
            finalScore: fr?.finalScore ?? null,
            avgScore,
            durationMs: Date.now() - startTime,
            turns: fr?.turns.length ?? 0,
            status: 'done',
          }
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') break
          batchResult = {
            model: target.model,
            finalScore: null,
            avgScore: null,
            durationMs: Date.now() - startTime,
            turns: 0,
            status: 'error',
            error: String(e),
          }
        }

        useVisualEvalStore.getState().addBatchResult(batchResult)

        // Small pause between models so UI can breathe
        await new Promise(r => setTimeout(r, 800))
      }
      if (controller.signal.aborted) break
    }

    useVisualEvalStore.getState().finishBatch()
  })()
    .catch((e) => {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        useVisualEvalStore.getState().setError(String(e))
      }
    })
    .finally(() => { _simPromise = null })
}


// ── User Model system prompt — task delivery mode ─────────────────────
// User Model's ONLY job: deliver tasks one by one in natural language.
// No scoring, no evaluation, no improvisation beyond the task list.
function buildUserSystemPrompt(config: SimConfig): string {
  const taskList = config.tasks?.length
    ? config.tasks.map((t, i) => `  ${i + 1}. ${t}`).join('\n')
    : '  (no specific tasks — explore the scenario freely)'

  return `You are roleplaying as a HUMAN USER interacting with an AI assistant.

SCENARIO: ${config.scenarioDescription}

YOUR TASKS (deliver them in order, one per message):
${taskList}

RULES:
1. Stay in character as a human user at all times. Never break character.
2. Deliver the tasks in the listed order. Start with task 1 immediately.
3. For each task, provide realistic fictional data as needed (names, IDs, dates). Never say "I don't have this info" — invent plausible data on the spot.
4. After the assistant responds, move on to the next task. If the assistant asks a clarifying question, answer briefly then continue.
5. Do NOT evaluate, score, or comment on the assistant's performance. Just be the user.
6. After ALL tasks have been delivered and responded to, write exactly: [DONE]

Keep messages natural and concise. You are a busy professional — get to the point.`
}

function buildOracleSystemPrompt(mockContext: string, memory: string, worldState?: string): string {
  const today = new Date().toISOString().slice(0, 10)

  // Extract __absent section from worldState for explicit enforcement
  let absentRule = ''
  if (worldState) {
    try {
      const ws = JSON.parse(worldState) as Record<string, unknown>
      if (ws.__absent && typeof ws.__absent === 'object') {
        const absent = ws.__absent as Record<string, unknown>
        const ids = Array.isArray(absent.ids) ? (absent.ids as string[]) : []
        const names = Array.isArray(absent.names) ? (absent.names as string[]) : []
        if (ids.length > 0 || names.length > 0) {
          absentRule = `\nABSENT ENTITIES — If the tool query matches any of these, return {"items":[],"total":0} or {"error":"Not found"} immediately. NEVER generate data for them:
${ids.length > 0 ? `- IDs: ${ids.join(', ')}` : ''}
${names.length > 0 ? `- Names: ${names.join(', ')}` : ''}
`
        }
      }
    } catch { /* ignore parse error */ }
  }

  return `You are a tool response simulator. Your ONLY job is to return realistic mock JSON for tool calls.

TODAY'S DATE: ${today}

${worldState ? `WORLD STATE — this is the FIXED ground truth for this benchmark session. You MUST use ONLY the entities defined here. Never invent new IDs, names, or records that contradict this world state:
${worldState}
${absentRule}
` : mockContext ? `Context/data hints: ${mockContext}

` : ''}${memory && !worldState ? `PREVIOUSLY RETURNED DATA — you MUST be fully consistent with this:
${memory}

` : ''}CRITICAL RULES:
- Return ONLY valid JSON. No explanation, no markdown fences, no extra text.
- CONSISTENCY is paramount: any entity (ID, name, fields) that was already returned must be reused EXACTLY the same every time it appears. Never invent different values for the same entity.
- DATE AWARENESS: When a query includes a date range, ALL returned records MUST have dates that fall within that range relative to today (${today}). If no range is specified, use recent dates (within the last 30 days).
- Make all new data realistic and internally consistent (plausible names, IDs in the format the tools expect, ISO dates, numeric scores 0-100).
- Always return a JSON object unless the tool clearly returns a list (then use {"items":[...], "total": N}).
- For scoring or evaluation tools: always include a narrative "Summary" field with 1-2 sentences and a "Highlights" array with 2-3 specific details — this gives the assistant real content to reason about.
- For write/save/create tools: always return {"success": true, "id": "<generated_id>", "message": "Saved successfully"} so the assistant knows the action completed.`
}

// ── Frozen Oracle Generation (Milestone 1) ───────────────────────────────
// Runs a dry-run simulation where oracle acts as target to discover all tool
// calls organically from the replay script. Saves responses to disk so every
// target model in a batch gets identical mock responses.
async function generateFrozenOracle(
  replayScript: string[],
  oracleCfg: OpenAIConfig,
  mockContext: string,
  worldState: string | undefined,
  tools: OpenAITool[] | undefined,
  scenarioName: string,
  signal: AbortSignal
): Promise<FrozenOracleDataset> {
  const seen = new Set<string>()
  const entries: FrozenToolResponse[] = []
  const oracleMemory = new Map<string, string>()

  // Oracle acts as target — it has system prompt with tools context
  const dryMessages: OpenAIMessage[] = []

  for (const userMsg of replayScript) {
    if (signal.aborted) break

    dryMessages.push({ role: 'user', content: userMsg })

    // Call oracle as "target" with tools so it may emit tool_calls
    let assistantRes
    try {
      assistantRes = await chatCompletion(oracleCfg, dryMessages, signal, tools)
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e
      break
    }

    const assistantMsg = assistantRes.choices?.[0]?.message
    if (!assistantMsg) break

    const rawContent = assistantMsg.content ?? ''
    const toolCalls: Array<{ id: string; name: string; arguments: string }> =
      (assistantMsg.tool_calls ?? []).map((tc: { id?: string; function: { name: string; arguments: string } }) => ({
        id: tc.id ?? `dry_${Date.now()}`,
        name: tc.function.name,
        arguments: tc.function.arguments,
      }))

    // Push assistant message (with tool_calls if any)
    dryMessages.push({
      role: 'assistant',
      content: rawContent || null,
      tool_calls: toolCalls.length > 0
        ? toolCalls.map(tc => ({ id: tc.id, type: 'function' as const, function: { name: tc.name, arguments: tc.arguments } }))
        : undefined,
    })

    // For each tool call, generate oracle response and save
    for (const tc of toolCalls) {
      if (signal.aborted) break
      const cacheKey = getToolCallCacheKey(tc.name, tc.arguments)

      if (!seen.has(cacheKey)) {
        // Fix 2: Validate tool exists before generating oracle response.
        // If oracle (acting as target during dry-run) calls a non-existent tool,
        // record an error response — prevents fake-success entries in frozen dataset.
        const dryRunValidation = validateToolCall(tc.name, tc.arguments, tools)
        if (dryRunValidation) {
          const errorResponse = JSON.stringify({ error: dryRunValidation })
          entries.push({
            cacheKey,
            toolName: tc.name,
            response: errorResponse,
            generatedAt: new Date().toISOString(),
            oracleModel: oracleCfg.model,
            schemaValid: false,
          })
          seen.add(cacheKey)
          oracleMemory.set(cacheKey, errorResponse)
          dryMessages.push({ role: 'tool', tool_call_id: tc.id, name: tc.name, content: errorResponse })
          continue
        }

        // Build oracle memory string
        const memEntries = [...oracleMemory.entries()].slice(-20)
        const memoryStr = memEntries.map(([k, v]) => `${k}:\n${v}`).join('\n\n')

        const oracleMessages: OpenAIMessage[] = [
          { role: 'system', content: buildOracleSystemPrompt(mockContext, memoryStr, worldState) },
          { role: 'user', content: `Tool called: ${tc.name}\nArguments: ${tc.arguments}\n\nReturn a realistic JSON object this tool would return.` },
        ]

        let mockResult = '{}'
        let schemaValid = false
        try {
          const mockRes = await chatCompletion({ ...oracleCfg, maxTokens: 1024 }, oracleMessages, signal)
          const raw = mockRes.choices?.[0]?.message?.content?.trim() || '{}'
          const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
          try {
            JSON.parse(stripped)
            mockResult = postProcessOracleResponse(stripped)
            schemaValid = true
          } catch { mockResult = raw }
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') throw e
        }

        entries.push({
          cacheKey,
          toolName: tc.name,
          response: mockResult,
          generatedAt: new Date().toISOString(),
          oracleModel: oracleCfg.model,
          schemaValid,
        })
        seen.add(cacheKey)
        oracleMemory.set(cacheKey, mockResult)
      }

      // Inject tool response back into dry-run conversation
      const frozenResponse = oracleMemory.get(cacheKey) ?? '{}'
      dryMessages.push({
        role: 'tool',
        tool_call_id: tc.id,
        name: tc.name,
        content: frozenResponse,
      })
    }

    // If there were tool calls, get oracle's follow-up after tool results
    if (toolCalls.length > 0 && !signal.aborted) {
      try {
        const followUp = await chatCompletion(oracleCfg, dryMessages, signal, tools)
        const followContent = followUp.choices?.[0]?.message?.content ?? ''
        if (followContent) {
          dryMessages.push({ role: 'assistant', content: followContent })
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e
      }
    }
  }

  const datasetId = `oracle_${simpleHash(entries.map(e => e.cacheKey).join('|') || `empty_${Date.now()}`)}`

  const dataset: FrozenOracleDataset = {
    datasetId,
    scenarioName,
    createdAt: new Date().toISOString(),
    oracleModel: oracleCfg.model,
    oracleBaseUrl: oracleCfg.baseUrl,
    replayScript,
    entries,
    version: '1.0',
  }

  // Save to disk (best-effort — if it fails, we still use the in-memory dataset)
  try {
    await fetch('/api/visual-eval/oracle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dataset),
    })
  } catch (e) {
    console.warn('[Oracle] Failed to save frozen dataset to disk:', e)
  }

  return dataset
}

// ── Task classification ────────────────────────────────────────────────
// Classify tasks into positive (data must exist) vs negative (data must be absent/error).
// Used to prevent worldState from including entities that adversarial tasks require absent.
interface ClassifiedTasks {
  positive: string[]   // happy-path tasks — need data to exist
  negative: string[]   // edge/error tasks — need data to be absent or return errors
}

async function classifyTasks(
  tasks: string[],
  cfg: OpenAIConfig,
  signal: AbortSignal
): Promise<ClassifiedTasks> {
  if (!tasks || tasks.length === 0) return { positive: [], negative: [] }

  const prompt = `Classify each task below as either "positive" or "negative":
- "positive": the task expects data to EXIST and be returned (search, lookup, compare, calculate, generate)
- "negative": the task expects data to be ABSENT, NOT FOUND, or an error — the assistant should respond with not found, gracefully handle empty results, or explain a limitation

Tasks:
${tasks.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Return ONLY a JSON array of strings, one per task, each either "positive" or "negative":
["positive", "negative", ...]`

  try {
    const res = await chatCompletion(
      { ...cfg, maxTokens: 200, temperature: 0 },
      [{ role: 'user', content: prompt }],
      signal
    )
    const raw = res.choices?.[0]?.message?.content?.trim() ?? ''
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(stripped)
    if (!Array.isArray(parsed) || parsed.length !== tasks.length) throw new Error('length mismatch')

    const positive: string[] = []
    const negative: string[] = []
    tasks.forEach((t, i) => {
      if (String(parsed[i]).toLowerCase().includes('negative')) negative.push(t)
      else positive.push(t)
    })
    console.log('[worldState] classified tasks — positive:', positive.length, 'negative:', negative.length)
    return { positive, negative }
  } catch (err) {
    console.warn('[worldState] classifyTasks failed, treating all as positive:', err)
    return { positive: tasks, negative: [] }
  }
}

// Extract entity names/IDs that negative tasks expect to be absent.
// Returns a compact object for the __absent section of worldState.
function extractAbsentEntities(negativeTasks: string[]): Record<string, string[]> {
  if (negativeTasks.length === 0) return {}

  const names: string[] = []
  const ids: string[] = []

  for (const task of negativeTasks) {
    // Extract quoted strings — likely names or IDs
    const quoted = task.match(/["']([^"']+)["']/g)?.map(s => s.replace(/["']/g, '')) ?? []
    // Extract patterns that look like structured IDs (PREFIX-digits)
    const idPatterns = task.match(/\b[A-Z]{2,}-\d{3,}\b/g) ?? []
    // Extract plain words that look like person names (capitalized, 3+ chars, not common words)
    const namePatterns = task.match(/\b[A-Z][a-z]{2,}\b/g)?.filter(w =>
      !['Search', 'Find', 'Get', 'List', 'Check', 'Retrieve', 'Calculate', 'Compare',
        'Create', 'Generate', 'The', 'For', 'And', 'With', 'That', 'This', 'From'].includes(w)
    ) ?? []

    ids.push(...idPatterns)
    names.push(...quoted.filter(s => !s.match(/^[A-Z]{2,}-\d/)), ...namePatterns)
  }

  const result: Record<string, string[]> = {}
  const uniqueIds = [...new Set(ids)]
  const uniqueNames = [...new Set(names)]
  if (uniqueIds.length > 0) result.ids = uniqueIds
  if (uniqueNames.length > 0) result.names = uniqueNames
  return result
}

// ── World state pre-generation ────────────────────────────────────────
// Called ONCE before batch starts. Oracle generates a fixed JSON "database"
// covering all entities referenced in the replay script + tasks.
// Every model in the batch then queries this same world state → deterministic.
async function generateWorldState(
  replayScript: string[],
  tasks: string[] | undefined,
  tools: OpenAITool[] | undefined,
  mockContext: string | undefined,
  oracleCfg: OpenAIConfig,
  signal: AbortSignal,
  negativeTasks?: string[]   // tasks that require data to be ABSENT
): Promise<string | undefined> {
  const today = new Date().toISOString().slice(0, 10)

  const toolSummary = tools && tools.length > 0
    ? tools.map(t => {
        const params = t.function.parameters as Record<string, unknown> | undefined
        const props = params?.properties as Record<string, unknown> | undefined
        const paramNames = props ? Object.keys(props).join(', ') : ''
        return `- ${t.function.name}(${paramNames}): ${t.function.description ?? ''}`
      }).join('\n')
    : '(no tools defined)'

  // Only use positive tasks for world state generation.
  // Negative tasks (expecting no results / errors) must NOT have entities generated for them.
  const positiveTasks = tasks && tasks.length > 0 ? tasks : replayScript.slice(0, 10)
  const taskContext = positiveTasks.join('\n')

  // Extract absent entities from negative tasks
  const absentEntities = negativeTasks && negativeTasks.length > 0
    ? extractAbsentEntities(negativeTasks)
    : {}
  const absentSection = Object.keys(absentEntities).length > 0
    ? `\nABSENT ENTITIES — Do NOT generate any records matching these in the world state:
${JSON.stringify(absentEntities, null, 2)}\n`
    : ''

  const prompt = `You are generating a FIXED mock database (world state) for a benchmark simulation. This world state will be used consistently across ALL model runs to ensure fair comparison.

TODAY: ${today}
${mockContext ? `\nDOMAIN CONTEXT:\n${mockContext}\n` : ''}
AVAILABLE TOOLS:
${toolSummary}

TASKS THAT NEED DATA (generate entities to satisfy these):
${taskContext}
${absentSection}
Generate a compact JSON world state containing all entities needed to answer the tasks above. The world state should include:
- All entity types the tools operate on (infer from the tool definitions and task descriptions)
- Enough records to make tasks interesting (3-8 records per entity type)
- Realistic, internally consistent data (IDs, names, dates, scores)
- IDs in whatever format the tool descriptions specify (infer from parameter names and descriptions)
${Object.keys(absentEntities).length > 0 ? `- An "__absent" key listing entities that must NOT appear in any tool response (for adversarial test cases)` : ''}

Rules:
- Return ONLY a valid JSON object. No explanation, no markdown fences.
- Structure as: { "entityType": [...records], ..., "__absent": {...} }
- The "__absent" key (if needed) must contain: { "note": "...", "ids": [...], "names": [...] }
- NEVER generate records for any name or ID listed in __absent.
- Keep it compact — this will be injected into every oracle prompt.
- Do NOT include more than ~50 total records across all entity types.
- Dates must be recent relative to today (${today}).`

  try {
    // Use higher maxTokens for reasoning models (gpt-5.x, o1, o3) which consume
    // tokens on reasoning before generating output. Temperature omitted — openai.ts
    // already drops it for reasoning models automatically.
    const isReasoningModel = /^(o1|o3|o4|gpt-5|computer-use)/i.test(oracleCfg.model)
    const res = await chatCompletion(
      { ...oracleCfg, maxTokens: isReasoningModel ? 8000 : 3000, temperature: isReasoningModel ? undefined : 0 },
      [{ role: 'user', content: prompt }],
      signal
    )
    const raw = res.choices?.[0]?.message?.content?.trim() ?? ''
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    try {
      const parsed = JSON.parse(stripped) as Record<string, unknown>
      // If __absent not already in worldState but we have absent entities, inject it
      if (Object.keys(absentEntities).length > 0 && !parsed.__absent) {
        parsed.__absent = {
          note: 'These entities must NOT appear in any tool response — required absent for adversarial test cases.',
          ...absentEntities,
        }
      }
      const final = JSON.stringify(parsed)
      console.log('[worldState] generated OK, length:', final.length, '| absent entities:', Object.keys(absentEntities).length > 0 ? JSON.stringify(absentEntities) : 'none')
      return final
    } catch {
      try { JSON.parse(raw); return raw } catch {
        console.warn('[worldState] JSON parse failed, raw preview:', raw.slice(0, 200))
        return undefined
      }
    }
  } catch (err) {
    console.error('[worldState] generateWorldState failed:', err)
    return undefined
  }
}

// ── Main simulation loop ──────────────────────────────────────────────
async function _runSimulation(
  config: SimConfig,
  signal: AbortSignal,
  runtime: SimulationRuntimeOptions = {}
): Promise<void> {
  const store = useVisualEvalStore.getState
  const targetApiKey = getApiKey('target_api_key')
  const userApiKey = getApiKey('visual_user_api_key')
  const oracleApiKey = getApiKey('visual_oracle_api_key') || userApiKey
  const judgeApiKey = getApiKey('visual_judge_api_key') || userApiKey

  const isReplay = config.replayScript && config.replayScript.length > 0

  // Sanitize tools to ensure valid JSON Schema for all providers (Claude, OpenAI, etc.)
  const tools = config.tools ? sanitizeTools(config.tools) : undefined

  const targetCfg: OpenAIConfig = {
    baseUrl: config.targetConfig.baseUrl,
    apiKey: targetApiKey,
    model: config.targetConfig.model,
    maxTokens: config.targetConfig.maxTokens,
    temperature: config.targetConfig.temperature,
  }
  const userCfg: OpenAIConfig = {
    baseUrl: config.userConfig.baseUrl,
    apiKey: userApiKey,
    model: config.userConfig.model,
    maxTokens: config.userConfig.maxTokens,
  }
  // Oracle: dedicated tool-faker. Falls back to userCfg if not configured
  const oracleCfg: OpenAIConfig = config.oracleConfig
    ? {
        baseUrl: config.oracleConfig.baseUrl,
        apiKey: oracleApiKey,
        model: config.oracleConfig.model,
        maxTokens: config.oracleConfig.maxTokens,
        temperature: 0,
      }
    : { ...userCfg, apiKey: oracleApiKey, temperature: 0 }

  // Judge: dedicated evaluator. Falls back to userCfg if not configured.
  const judgeCfg: OpenAIConfig = config.judgeConfig
    ? {
        baseUrl: config.judgeConfig.baseUrl,
        apiKey: judgeApiKey,
        model: config.judgeConfig.model,
        maxTokens: 2500,
        temperature: 0,
      }
    : { ...userCfg, apiKey: judgeApiKey, temperature: 0 }

  // Message histories (kept separate, merged for each API call)
  const targetMessages: OpenAIMessage[] = []
  if (config.targetSystemPrompt) {
    targetMessages.push({ role: 'system', content: config.targetSystemPrompt })
  }

  const userMessages: OpenAIMessage[] = isReplay ? [] : [
    { role: 'system', content: buildUserSystemPrompt(config) },
    // Kick-off prompt: force User Model to immediately start as the user, not ask meta-questions
    { role: 'user', content: 'Begin the simulation now. Send your first message as the user. Use specific fictional data if needed. Do not explain or meta-comment — just start the conversation.' },
  ]

  const simId = crypto.randomUUID()
  const startTime = Date.now()
  let turnIndex = 0
  let finalAssessment = ''

  // Oracle memory: remembers previous tool responses to stay consistent.
  const oracleMemory = new Map<string, string>()

  // Replay script: list of user messages to send verbatim (skips User Model calls)
  const taskTotal = config.tasks?.length ?? 0
  const replayQueue = isReplay ? [...config.replayScript!] : null
  const effectiveTurns = isReplay
    ? config.replayScript!.length
    : taskTotal > 0
      ? taskTotal
      : config.maxTurns

  // ── Turn loop ─────────────────────────────────────────────────────
  for (let turn = 0; turn < effectiveTurns; turn++) {
    if (signal.aborted) break

    const progressLabel = taskTotal > 0
      ? `Task ${Math.min(turn + 1, taskTotal)}/${taskTotal}`
      : `${isReplay ? 'Replay' : 'Turn'} ${turn + 1}/${effectiveTurns}`

    if (taskTotal > 0) {
      store().setTaskProgress(Math.min(turn + 1, taskTotal))
    }

    // ── Step 1: Get next user message ─────────────────────────────
    let cleanUserText = ''
    const t0 = Date.now()

    if (isReplay) {
      // Replay mode: use pre-recorded user message verbatim (no User Model call)
      cleanUserText = replayQueue![turn] || ''
      if (!cleanUserText) break
      store().updateStatus(`${progressLabel} — sending user message…`)
    } else {
      // Dynamic mode: call User Model to generate next message
      store().updateStatus(`${progressLabel} — User Model thinking…`)

      let userText = ''
      try {
        const userRes = await chatCompletion(userCfg, userMessages, signal)
        userText = userRes.choices?.[0]?.message?.content || ''
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e
        store().setError(`User Model error: ${e}`)
        break
      }

      // Check for [DONE] — User Model signals all tasks delivered
      const isDone = /\[DONE\]/i.test(userText)
      cleanUserText = userText.replace(/\[DONE\]/gi, '').trim()

      if (isDone) {
        if (cleanUserText) {
          store().addTurn({ turnIndex: turnIndex++, role: 'user', content: cleanUserText, durationMs: Date.now() - t0 })
          targetMessages.push({ role: 'user', content: cleanUserText })
          userMessages.push({ role: 'assistant', content: userText })
        }
        break
      }

      userMessages.push({ role: 'assistant', content: userText })
    }

    // Add user turn to transcript
    store().addTurn({ turnIndex: turnIndex++, role: 'user', content: cleanUserText, durationMs: Date.now() - t0 })
    targetMessages.push({ role: 'user', content: cleanUserText })

    if (signal.aborted) break

    // ── Step 2: Target Model responds ────────────────────────────────
    store().updateStatus(`${progressLabel} — Target Model responding…`)
    const t1 = Date.now()

    let targetText = ''
    let targetToolCalls: Array<{ id: string; name: string; arguments: string }> = []
    try {
      const targetRes = await chatCompletion(targetCfg, targetMessages, signal, tools)
      const choice = targetRes.choices?.[0]
      targetText = choice?.message?.content || ''
      // Preserve the actual tool_call IDs from the response — critical for Claude
      targetToolCalls = choice?.message?.tool_calls?.map(tc => ({
        id: tc.id || `call_${tc.function.name}_${Date.now()}`,
        name: tc.function.name,
        arguments: tc.function.arguments,
      })) || []
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e
      const errTurn: SimulationTurn = {
        turnIndex: turnIndex++,
        role: 'assistant',
        content: `[Error: ${e}]`,
        durationMs: Date.now() - t1,
      }
      store().addTurn(errTurn)
      break
    }

    // Add assistant turn to transcript
    store().addTurn({
      turnIndex: turnIndex++,
      role: 'assistant',
      content: targetText,
      tool_calls: targetToolCalls.length > 0
        ? targetToolCalls.map(tc => ({ type: 'function' as const, function: { name: tc.name, arguments: tc.arguments } }))
        : undefined,
      durationMs: Date.now() - t1,
    })

    // Push assistant message with proper tool_calls format (id required by Claude)
    targetMessages.push({
      role: 'assistant',
      content: targetText || null,
      tool_calls: targetToolCalls.length > 0
        ? targetToolCalls.map(tc => ({ id: tc.id, type: 'function' as const, function: { name: tc.name, arguments: tc.arguments } }))
        : undefined,
    })

    // ── Step 3: Handle tool calls ─────────────────────────────────────
    if (targetToolCalls.length > 0 && !signal.aborted) {
      store().updateStatus(`${progressLabel} — Oracle faking ${targetToolCalls.length} tool(s)…`)

      const handled = await handleToolCalls(
        targetToolCalls,
        oracleCfg,
        targetCfg,
        targetMessages,
        oracleMemory,
        runtime,
        tools,
        config,
        (t) => store().addTurn(t),
        turnIndex,
        signal
      )
      turnIndex = handled.turnIndex

      // Feed after-tool response to User Model in dynamic mode
      if (!isReplay && targetMessages.length > 0) {
        const lastMsg = targetMessages[targetMessages.length - 1]
        if (lastMsg.role === 'assistant' && lastMsg.content) {
          userMessages.push({ role: 'user', content: lastMsg.content })
        }
      }
    } else {
      if (!isReplay) {
        // No tool calls — feed assistant reply to User Model (dynamic mode only)
        userMessages.push({ role: 'user', content: targetText || '[No response]' })
      } else if (config.adaptiveReplay !== false && isReplay) {
        // ── Adaptive Replay: handle clarification in replay mode ────────
        const isClarification = detectClarification(targetText, false)

        if (isClarification) {
          const maxRetries = config.maxClarificationRetries ?? 2
          let resolved = false

          for (let retry = 0; retry < maxRetries && !signal.aborted; retry++) {
            store().updateStatus(`${progressLabel} — handling clarification (${retry + 1}/${maxRetries})…`)

            // Generate a short confirmation reply to unblock the model
            const clarReply = await generateClarificationReply(
              targetText,
              targetMessages,
              userCfg,
              signal
            )

            // Add as user turn — prefix marks it as auto-generated
            store().addTurn({
              turnIndex: turnIndex++,
              role: 'user',
              content: `[adaptive] ${clarReply}`,
              durationMs: 0,
            })
            targetMessages.push({ role: 'user', content: clarReply })

            // Let target respond again
            const tRetry = Date.now()
            let retryText = ''
            let retryToolCalls: Array<{ id: string; name: string; arguments: string }> = []
            try {
              const retryRes = await chatCompletion(targetCfg, targetMessages, signal, tools)
              const retryChoice = retryRes.choices?.[0]
              retryText = retryChoice?.message?.content || ''
              retryToolCalls = (retryChoice?.message?.tool_calls ?? []).map(
                (tc: { id?: string; function: { name: string; arguments: string } }) => ({
                  id: tc.id || `call_${tc.function.name}_${Date.now()}`,
                  name: tc.function.name,
                  arguments: tc.function.arguments,
                })
              )
            } catch (e) {
              if (e instanceof DOMException && e.name === 'AbortError') throw e
              break
            }

            // Record assistant response
            store().addTurn({
              turnIndex: turnIndex++,
              role: 'assistant',
              content: retryText,
              tool_calls: retryToolCalls.length > 0
                ? retryToolCalls.map(tc => ({ type: 'function' as const, function: { name: tc.name, arguments: tc.arguments } }))
                : undefined,
              durationMs: Date.now() - tRetry,
            })
            targetMessages.push({
              role: 'assistant',
              content: retryText || null,
              tool_calls: retryToolCalls.length > 0
                ? retryToolCalls.map(tc => ({ id: tc.id, type: 'function' as const, function: { name: tc.name, arguments: tc.arguments } }))
                : undefined,
            })

            if (retryToolCalls.length > 0) {
              // Model finally called tools — handle them
              store().updateStatus(`${progressLabel} — Oracle faking ${retryToolCalls.length} tool(s) after clarification…`)
              const handled = await handleToolCalls(
                retryToolCalls,
                oracleCfg,
                targetCfg,
                targetMessages,
                oracleMemory,
                runtime,
                tools,
                config,
                (t) => store().addTurn(t),
                turnIndex,
                signal
              )
              turnIndex = handled.turnIndex
              resolved = true
              break
            }

            // Still no tool call — check if still clarifying or gave a plain answer
            if (!detectClarification(retryText, false)) {
              // Plain answer without tools — accept and move on
              resolved = true
              break
            }

            targetText = retryText  // update for next retry context
          }

          if (!resolved) {
            console.warn(`[Adaptive] Clarification unresolved after ${maxRetries} retries — continuing replay`)
          }
        }
        // Non-clarification response (plain answer, no tools) in replay → do nothing, next turn
      }
    }
  }

  if (signal.aborted) {
    finalAssessment = 'Simulation stopped by user.'
  }

  // ── Hybrid evaluation — per-task checklist + tool trace ──────────
  const storeTurns = useVisualEvalStore.getState().turns
  let finalScore: number | null = null
  let taskResults: TaskResult[] | undefined
  let evaluationStatus: SimulationResult['evaluationStatus'] = 'unavailable'
  let evaluationDebug: SimulationResult['evaluationDebug'] | undefined
  let multiJudgeResult: MultiJudgeResult | undefined
  let complianceResultForResult: SimulationResult['complianceResult']
  let threeAxisScoreForResult: SimulationResult['threeAxisScore']

  if (!signal.aborted && storeTurns.length > 0) {
    store().updateStatus('Evaluating tasks…')

    const evalOptions = { tasks: config.tasks, tools }

    // Build additional judge configs (M2)
    const additionalJudgeConfigs = (config.additionalJudges ?? []).map(j => ({
      config: {
        baseUrl: j.baseUrl,
        apiKey: getApiKey(j.apiKeyName ?? 'visual_judge_api_key') || judgeApiKey,
        model: j.model,
        maxTokens: 2500,
        temperature: 0,
      } as OpenAIConfig,
    }))

    if (additionalJudgeConfigs.length > 0) {
      // Multi-judge path
      store().updateStatus(`Evaluating with ${1 + additionalJudgeConfigs.length} judges…`)
      try {
        multiJudgeResult = await multiJudgeEvaluate(
          storeTurns,
          judgeCfg,
          additionalJudgeConfigs,
          signal,
          evalOptions
        )
        finalScore = multiJudgeResult.consensusScore
        finalAssessment = multiJudgeResult.consensusAssessment || 'Evaluation complete.'
        taskResults = multiJudgeResult.verdicts[0]?.taskResults
        evaluationStatus = multiJudgeResult.successCount > 0 ? 'scored' : 'unavailable'
        evaluationDebug = {
          evaluator: `multi_judge_v2 (${multiJudgeResult.successCount}/${multiJudgeResult.judgeCount} judges)`,
          rawJudgeResponse: multiJudgeResult.verdicts.map(v => `[${v.model}] score=${v.finalScore ?? 'null'}`).join('\n'),
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e
        console.warn('[visualEvalRunner] Multi-judge failed — falling back to single judge:', e)
        const evaluation = await evaluateVisualSimulation(storeTurns, judgeCfg, signal, evalOptions)
        finalScore = evaluation.finalScore
        taskResults = evaluation.taskResults
        evaluationStatus = evaluation.status
        evaluationDebug = evaluation.debug
        finalAssessment = evaluation.assessment || 'Evaluation complete.'
      }
    } else {
      // Single-judge path (backward compatible)
      const evaluation = await evaluateVisualSimulation(storeTurns, judgeCfg, signal, evalOptions)
      finalScore = evaluation.finalScore
      taskResults = evaluation.taskResults
      evaluationStatus = evaluation.status
      evaluationDebug = evaluation.debug
      finalAssessment = evaluation.assessment || 'Evaluation complete.'
    }

    // Compliance check (M2) — config-driven, no hardcoded domain rules
    const complianceRules = config.complianceRules ?? []
    const complianceResult = checkCompliance(storeTurns, complianceRules)
    complianceResultForResult = complianceResult

    // Attach 3-axis score to each task result (M2)
    if (taskResults?.length) {
      taskResults = taskResults.map(tr => ({
        ...tr,
        threeAxisScore: computeThreeAxisScore(
          tr.breakdown?.toolTrace ?? null,
          tr.score,
          complianceResult.score
        ),
      }))
    }

    // Top-level 3-axis score (average of task scores)
    const toolTraceAvg = taskResults?.length
      ? (taskResults.reduce((s, t) => s + (t.breakdown?.toolTrace ?? 0), 0) / taskResults.length)
      : null
    threeAxisScoreForResult = computeThreeAxisScore(toolTraceAvg, finalScore, complianceResult.score)
  }

  if (signal.aborted) {
    finalAssessment = 'Simulation stopped by user.'
  } else if (!finalAssessment) {
    finalAssessment = 'Evaluation unavailable.'
  }

  // ── Build tasks metrics for leaderboard ──────────────────────────
  // Each task gets its own score; leaderboard shows per-task breakdown.
  const leaderboardTasks: Record<string, Record<string, number>> = {}
  if (taskResults?.length) {
    // One entry per task, keyed by short task name
    taskResults.forEach((tr, i) => {
      const key = tr.task.slice(0, 50).replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_') || `task_${i + 1}`
      leaderboardTasks[key] = { overall: tr.score }
    })
  } else if (finalScore !== null) {
    // No task results — single scenario entry
    leaderboardTasks[config.scenarioName] = { overall: finalScore }
  }

  // ── Compute judge prompt hash for reproducibility (M1) ───────────
  let judgePromptHash: string | undefined
  try {
    const segments = buildTaskSegments(storeTurns, config.tasks)
    if (segments.length > 0) {
      judgePromptHash = simpleHash(buildJudgePrompt(segments))
    }
  } catch { /* non-critical — skip hash on error */ }

  // ── Build final result ────────────────────────────────────────────
  const endDate = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const endDuration = Date.now() - startTime

  const result: SimulationResult = {
    simId,
    scenarioName: config.scenarioName,
    targetModel: config.targetConfig.model,
    userModel: isReplay ? `replay:${config.replayScript!.length}turns` : config.userConfig.model,
    date: endDate,
    durationMs: endDuration,
    turns: storeTurns,
    finalScore,
    finalAssessment,
    taskResults,
    evaluationStatus,
    evaluationDebug,
    status: signal.aborted ? 'stopped' : 'completed',
    // ── Reproducibility metadata ────────────────────────────────────
    judgeModel: judgeCfg.model,
    judgeBaseUrl: judgeCfg.baseUrl,
    oracleModel: oracleCfg.model,
    oracleBaseUrl: oracleCfg.baseUrl,
    replayScript: isReplay ? config.replayScript : undefined,
    toolsUsed: tools?.map(t => ({ name: t.function.name, description: t.function.description })),
    worldState: runtime.worldState,
    // ── Evaluation pipeline v2 metadata (M1) ────────────────────────
    judgePromptHash,
    oracleDatasetId: runtime.frozenOracleDatasetId,
    toolDefinitions: tools?.map(t => ({
      name: t.function.name,
      description: t.function.description ?? '',
      parametersSchema: (t.function.parameters ?? {}) as Record<string, unknown>,
    })) satisfies ToolDefinition[] | undefined,
    evaluationVersion: EVALUATION_VERSION,
    // ── Multi-judge metadata (M2) ────────────────────────────────────
    multiJudgeResult,
    threeAxisScore: threeAxisScoreForResult,
    complianceResult: complianceResultForResult,
    judgeAgreement: multiJudgeResult?.agreementRate,
    // ── Multi-run statistics (M3) ────────────────────────────────────
    runIndex: runtime.runIndex,
    totalRuns: runtime.totalRuns,
  }

  // Save to disk
  try {
    await fetch('/api/visual-eval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...result, tasks: leaderboardTasks }),
    })
  } catch (e) {
    console.warn('[visualEvalRunner] Failed to save to disk:', e)
  }

  // Push to leaderboard store
  try {
    if (Object.keys(leaderboardTasks).length > 0) {
      const { useResultsStore } = await import('@/store/resultsStore')
      useResultsStore.getState().upsertRun({
        runId:      simId,
        model:      config.targetConfig.model,
        baseUrl:    config.targetConfig.baseUrl,
        date:       endDate,
        durationMs: endDuration,
        tasks:      leaderboardTasks,
      })
    }
  } catch (e) {
    console.warn('[visualEvalRunner] Failed to push to leaderboard:', e)
  }

  useVisualEvalStore.getState().setDone(result)
}

// ── Scenario generation helper ────────────────────────────────────────
export async function generateScenario(
  description: string,
  userCfg: OpenAIConfig,
  signal?: AbortSignal,
  onProgress?: (msg: string) => void,
  numTasks = 4
): Promise<{ targetSystemPrompt: string; scenarioDescription: string; tools: OpenAITool[]; mockContext: string; tasks: string[] }> {

  // ── Call 1: generate scenario ──────────────────────────────────────
  onProgress?.('Generating scenario (1/3)…')
  const scenarioPrompt = `Based on the following business document, generate a simulation scenario for evaluating an AI assistant.

Document:
"""
${description.slice(0, 8000)}
"""

Return a JSON object with EXACTLY these fields (no markdown, no explanation):
{
  "targetSystemPrompt": "<system prompt for the AI assistant — 2-4 sentences: role, capabilities, constraints>",
  "scenarioDescription": "<for the user simulator — what kind of user, what they want to achieve, 2-3 specific test goals>"
}`

  const scenarioRes = await chatCompletion(
    { ...userCfg, maxTokens: 1024 },
    [{ role: 'user', content: scenarioPrompt }],
    signal
  )
  const scenarioText = scenarioRes.choices?.[0]?.message?.content || ''
  const scenarioMatch = scenarioText.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || scenarioText.match(/(\{[\s\S]*\})/)
  let targetSystemPrompt = ''
  let scenarioDescription = description.slice(0, 200)
  try {
    const obj = JSON.parse(scenarioMatch ? scenarioMatch[1] : scenarioText)
    targetSystemPrompt = obj.targetSystemPrompt || ''
    scenarioDescription = obj.scenarioDescription || scenarioDescription
  } catch { /* keep defaults */ }

  if (signal?.aborted) return { targetSystemPrompt, scenarioDescription, tools: [], mockContext: '', tasks: [] }

  // ── Call 2: extract ALL tools from full document ──────────────────
  onProgress?.('Extracting tools (2/3)…')
  const toolsPrompt = `Extract ALL function/tool definitions from the following document. Return ONLY a JSON array of OpenAI function-calling tool objects.

Document:
"""
${description.slice(0, 24000)}
"""

Each tool must follow this schema exactly:
{
  "type": "function",
  "function": {
    "name": "snake_case_name",
    "description": "what this tool does",
    "parameters": {
      "type": "object",
      "properties": {
        "paramName": { "type": "string", "description": "..." }
      },
      "required": ["paramName"]
    }
  }
}

Rules:
- Include EVERY tool/function mentioned in the document — do NOT limit count.
- If a tool name appears multiple times across different skills/sections, include it ONCE with all its parameters merged.
- If the document already defines tool names and parameters, reproduce them EXACTLY (same snake_case names).
- If no tools are described, return [].
- Return ONLY the JSON array, no explanation, no markdown fences.`

  const toolsRes = await chatCompletion(
    { ...userCfg, maxTokens: 8000 },
    [{ role: 'user', content: toolsPrompt }],
    signal
  )
  const toolsText = toolsRes.choices?.[0]?.message?.content || ''
  const toolsMatch = toolsText.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || toolsText.match(/(\[[\s\S]*\])/)
  let tools: OpenAITool[] = []
  try {
    const parsed = JSON.parse(toolsMatch ? toolsMatch[1] : toolsText)
    if (Array.isArray(parsed)) tools = parsed
  } catch { /* no tools */ }

  // Dedup by function name — keep first occurrence (most complete definition)
  const seen = new Set<string>()
  tools = tools.filter(t => {
    const name = t.function?.name
    if (!name || seen.has(name)) return false
    seen.add(name)
    return true
  })

  // Enrich parameter descriptions with format hints inferred from the parameter name itself.
  // This is general — no domain hard-coding. The format hint is derived purely from the
  // parameter name: if a param looks like an "entity ID" (ends with "id" or "ids"), we
  // look at its existing description or sibling params to infer the expected string format,
  // then append a hint so target models know to pass a string, not a number.
  tools = tools.map(tool => {
    const params = tool.function.parameters as Record<string, unknown> | undefined
    if (!params || typeof params !== 'object') return tool

    const props = params.properties as Record<string, Record<string, unknown>> | undefined
    if (!props) return tool

    const enrichedProps: Record<string, Record<string, unknown>> = {}
    for (const [paramName, propSchema] of Object.entries(props)) {
      const lower = paramName.toLowerCase()
      const isIdParam = lower.endsWith('id') || lower.endsWith('ids')
      const hasStringType = propSchema.type === 'string'
      const alreadyHasFormatHint = typeof propSchema.description === 'string' &&
        (propSchema.description.includes('format') || propSchema.description.includes('e.g.') || propSchema.description.includes('example'))

      if (isIdParam && !alreadyHasFormatHint) {
        // Infer a generic hint: "must be a string identifier" — if description exists, append; otherwise create one.
        const existing = typeof propSchema.description === 'string' ? propSchema.description.trimEnd() : ''
        const hint = existing
          ? `${existing}. Must be a string identifier, never a plain number.`
          : `String identifier for this entity. Never pass a plain number.`
        enrichedProps[paramName] = { ...propSchema, type: 'string', description: hint }
      } else if (isIdParam && !hasStringType) {
        // At minimum force type to string so JSON schema validation passes
        enrichedProps[paramName] = { ...propSchema, type: 'string' }
      } else {
        enrichedProps[paramName] = propSchema
      }
    }

    return {
      ...tool,
      function: {
        ...tool.function,
        parameters: { ...params, properties: enrichedProps },
      },
    }
  })

  // Auto-generate mockContext — includes today's date so Oracle uses realistic recent dates
  let mockContext = ''
  if (tools.length > 0) {
    const today = new Date().toISOString().slice(0, 10)
    const toolSummaries = tools.slice(0, 10).map(t => {
      const params = Object.keys((t.function.parameters as Record<string, unknown>)?.properties as Record<string, unknown> ?? {}).join(', ')
      return `${t.function.name}(${params})`
    }).join(' | ')
    mockContext = `Today's date: ${today}. Tools: ${toolSummaries}. When faking tool responses, return realistic JSON with plausible names, scores (0-100), dates close to today (ISO format), and short text. For date-range queries, ensure returned records fall within the requested range relative to today. Always return valid JSON.

CRITICAL — ID FORMAT RULES (never deviate):
- Use the EXACT ID format that appears in the tool schema descriptions and parameters. Infer the format from the tool definitions — never invent a different format.
- If the same entity appears across multiple tool calls (same name, same ID), reuse EXACTLY the same identifier, name, and fields every time.
- Never pass or return plain numbers where the schema expects a string identifier.`
  }

  if (signal?.aborted) return { targetSystemPrompt, scenarioDescription, tools, mockContext, tasks: [] }

  // ── Call 3: generate evaluation task list ─────────────────────────
  // Tasks are concrete, testable actions the Target Model must perform.
  // They will be delivered one-by-one by the User Model and evaluated by the judge.
  onProgress?.('Generating tasks (3/3)…')
  const toolNames = tools.map(t => t.function.name).join(', ')
  let tasks: string[] = []
  let feedback = ''

  for (let attempt = 0; attempt < 3; attempt++) {
    const tasksPrompt = buildTasksPrompt(targetSystemPrompt, scenarioDescription, toolNames, numTasks, feedback)
    const tasksRes = await chatCompletion(
      { ...userCfg, maxTokens: 2048 },
      [{ role: 'user', content: tasksPrompt }],
      signal
    )
    const tasksText = tasksRes.choices?.[0]?.message?.content || ''

    try {
      const candidateTasks = parseStringArrayResponse(tasksText)
      const structuralIssues = collectTaskListIssues(candidateTasks, numTasks)
      tasks = candidateTasks
      if (structuralIssues.length > 0) {
        feedback = structuralIssues.join('\n')
        continue
      }
      // LLM semantic validation — only on final attempt or if structurally OK
      const semanticIssues = await validateTasksWithLLM(candidateTasks, targetSystemPrompt, scenarioDescription, userCfg, signal ?? new AbortController().signal)
      if (semanticIssues.length === 0) break
      feedback = semanticIssues.join('\n')
    } catch {
      feedback = 'Return ONLY a valid JSON array of task strings.'
    }
  }

  if (tasks.length > numTasks) tasks = tasks.slice(0, numTasks)
  if (tasks.length === numTasks) return { targetSystemPrompt, scenarioDescription, tools, mockContext, tasks }

  const tasksPrompt = buildTasksPrompt(targetSystemPrompt, scenarioDescription, toolNames, numTasks)

  const tasksRes = await chatCompletion(
    { ...userCfg, maxTokens: 1024 },
    [{ role: 'user', content: tasksPrompt }],
    signal
  )
  const tasksText = tasksRes.choices?.[0]?.message?.content || ''
  const tasksRawMatch = tasksText.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || tasksText.match(/(\[[\s\S]*\])/)
  if (tasks.length === 0) {
    try {
      const parsed = JSON.parse(tasksRawMatch ? tasksRawMatch[1] : tasksText)
      if (Array.isArray(parsed)) tasks = parsed.filter((t): t is string => typeof t === 'string')
    } catch { /* no tasks */ }
  }

  return { targetSystemPrompt, scenarioDescription, tools, mockContext, tasks }
}
