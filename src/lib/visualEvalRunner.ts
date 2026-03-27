import { SimulationTurn, SimulationResult, TaskResult } from '@/types'
import { chatCompletion, OpenAIConfig, OpenAIMessage, OpenAITool, getApiKey } from './openai'
import { useVisualEvalStore, getSimController, abortSim, BatchModelResult } from '@/store/visualEvalStore'
import { evaluateVisualSimulation } from './visualEvalEvaluators'

// ── Sanitize a single JSON Schema property recursively ───────────────
function sanitizeProp(raw: Record<string, unknown>): Record<string, unknown> {
  const type = (raw.type as string) ?? 'string'
  const result: Record<string, unknown> = { type }

  if (raw.description) result.description = String(raw.description)
  if (Array.isArray(raw.enum)) result.enum = raw.enum

  if (type === 'array') {
    // GPT-4.1 + Claude REQUIRE items when type=array
    const rawItems = raw.items as Record<string, unknown> | undefined
    result.items = rawItems && typeof rawItems === 'object'
      ? sanitizeProp(rawItems)
      : { type: 'string' }
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
}

function normalizeReplayScript(messages?: string[]): string[] {
  return (messages ?? []).map(m => m.trim()).filter(Boolean)
}

function stableSortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSortJson)
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
  if (taskReplay.length > 0) return taskReplay

  const userApiKey = getApiKey('visual_user_api_key')
  const userCfg: OpenAIConfig = {
    baseUrl: config.userConfig.baseUrl,
    apiKey: userApiKey,
    model: config.userConfig.model,
    maxTokens: 1500,
    temperature: 0,
  }

  const prompt = `Create a FIXED replay script for benchmarking multiple AI assistants fairly.

Scenario: ${config.scenarioDescription}
Assistant role: ${config.targetSystemPrompt || '(none provided)'}

Return ONLY a JSON array of exactly ${config.maxTurns} concise user messages.

Rules:
- Each message must be self-contained and include any fictional names, IDs, or dates needed.
- Do NOT depend on previous assistant replies.
- Do NOT include explanations, numbering, or markdown.
- Make the messages realistic for the scenario and varied enough to exercise the assistant.
`

  try {
    const res = await chatCompletion(
      userCfg,
      [{ role: 'user', content: prompt }],
      signal
    )
    const text = res.choices?.[0]?.message?.content || ''
    const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || text.match(/(\[[\s\S]*\])/)
    const parsed = JSON.parse(match ? match[1] : text)
    if (!Array.isArray(parsed)) return undefined
    const replay = normalizeReplayScript(parsed.filter((v): v is string => typeof v === 'string'))
    return replay.length > 0 ? replay : undefined
  } catch {
    return undefined
  }
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
    const sharedReplayScript = await buildBatchReplayScript(baseConfig, controller.signal)
    const sharedOracleCache = new Map<string, string>()

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i]
      if (controller.signal.aborted) break

      useVisualEvalStore.getState().nextBatchModel(i, target.model, baseConfig.maxTurns, baseConfig.tasks?.length ?? 0)

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
        await _runSimulation(simConfig, controller.signal, { sharedOracleCache })
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

function buildOracleSystemPrompt(mockContext: string, memory: string): string {
  const today = new Date().toISOString().slice(0, 10)
  return `You are a tool response simulator. Your ONLY job is to return realistic mock JSON for tool calls.

TODAY'S DATE: ${today}

${mockContext ? `Context/data hints: ${mockContext}` : ''}

${memory ? `PREVIOUSLY RETURNED DATA — you MUST be fully consistent with this:
${memory}

` : ''}CRITICAL RULES:
- Return ONLY valid JSON. No explanation, no markdown fences, no extra text.
- CONSISTENCY is paramount: if a CandidateID, RecruitmentID, or any entity was already returned above, reuse the EXACT same name/email/fields. Never invent different names for the same ID.
- DATE AWARENESS: When a query includes a date range (e.g. "last 7 days", "from X to Y"), ALL returned records MUST have dates that fall within that range relative to today (${today}). If no range is specified, use recent dates (within the last 30 days).
- Make all new data realistic and internally consistent (Vietnamese names, plausible IDs, ISO dates, scores 0-100).
- Always return a JSON object unless the tool clearly returns a list (then use {"items":[...], "total": N}).
- For fit score tools (e.g. get_candidate_fit_score, get_multiple_candidates_fit_score): always include a "Summary" field with 1–2 sentences describing the candidate's key strengths/gaps relative to the job requirements, and a "CVHighlights" array with 2–3 specific skills or experiences from their CV. This gives the assistant real content to reason about.
- For save/write/create tools (e.g. save_email_template, create_template, save_*): always return {"success": true, "id": "<generated_id>", "message": "Saved successfully"} so the assistant knows the action completed.`
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

      for (const tc of targetToolCalls) {
        if (signal.aborted) break

        const cacheKey = getToolCallCacheKey(tc.name, tc.arguments)
        const cached = runtime.sharedOracleCache?.get(cacheKey)
        let mockResult = cached || '{}'

        if (!cached) {
          // Build memory string from past oracle responses (most recent 20 entries to avoid token bloat)
          const memoryEntries = [...oracleMemory.entries()].slice(-20)
          const memoryStr = memoryEntries.length > 0
            ? memoryEntries.map(([k, v]) => `${k}:\n${v}`).join('\n\n')
            : ''

          // Oracle gets the tool call + memory of all previous responses for consistency
          const oracleMessages: OpenAIMessage[] = [
            { role: 'system', content: buildOracleSystemPrompt(config.mockContext || '', memoryStr) },
            {
              role: 'user',
              content: `Tool called: ${tc.name}\nArguments: ${tc.arguments}\n\nReturn a realistic JSON object this tool would return.`,
            },
          ]

          try {
            const mockRes = await chatCompletion(
              { ...oracleCfg, maxTokens: 1024 },
              oracleMessages,
              signal
            )
            const raw = mockRes.choices?.[0]?.message?.content?.trim() || '{}'
            // Strip markdown fences if model wraps in ```json
            const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
            // Validate JSON — fall back to raw if parse fails
            try { JSON.parse(stripped); mockResult = stripped } catch { mockResult = raw }
          } catch (e) {
            if (e instanceof DOMException && e.name === 'AbortError') throw e
          }

          runtime.sharedOracleCache?.set(cacheKey, mockResult)
        }

        oracleMemory.set(cacheKey, mockResult)

        // Add tool turn to transcript
        store().addTurn({
          turnIndex: turnIndex++,
          role: 'tool',
          content: mockResult,
          tool_name: tc.name,
        })

        // Inject as proper role:'tool' message with matching tool_call_id
        targetMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.name,
          content: mockResult,
        })
      }

      if (signal.aborted) break

      // ── Step 3b: Target Model responds after tool result ──────────
      store().updateStatus(`${progressLabel} — Target Model processing tool result…`)
      const t2 = Date.now()
      try {
        const afterToolRes = await chatCompletion(targetCfg, targetMessages, signal)
        const afterChoice = afterToolRes.choices?.[0]
        const afterText = afterChoice?.message?.content || ''
        if (afterText) {
          store().addTurn({ turnIndex: turnIndex++, role: 'assistant', content: afterText, durationMs: Date.now() - t2 })
          targetMessages.push({ role: 'assistant', content: afterText })
          if (!isReplay) {
            userMessages.push({ role: 'user', content: afterText })
          }
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e
      }
    } else {
      if (!isReplay) {
        // No tool calls — feed assistant reply to User Model (dynamic mode only)
        userMessages.push({ role: 'user', content: targetText || '[No response]' })
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

  if (!signal.aborted && storeTurns.length > 0) {
    store().updateStatus('Evaluating tasks…')
    const evaluation = await evaluateVisualSimulation(storeTurns, userCfg, signal, {
      tasks: config.tasks,
      tools,
    })
    finalScore = evaluation.finalScore
    taskResults = evaluation.taskResults
    evaluationStatus = evaluation.status
    evaluationDebug = evaluation.debug
    finalAssessment = evaluation.assessment || 'Evaluation complete.'
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

  // Auto-generate mockContext — includes today's date so Oracle uses realistic recent dates
  let mockContext = ''
  if (tools.length > 0) {
    const today = new Date().toISOString().slice(0, 10)
    const toolSummaries = tools.slice(0, 10).map(t => {
      const params = Object.keys((t.function.parameters as Record<string, unknown>)?.properties as Record<string, unknown> ?? {}).join(', ')
      return `${t.function.name}(${params})`
    }).join(' | ')
    mockContext = `Today's date: ${today}. Tools: ${toolSummaries}. When faking tool responses, return realistic JSON with plausible Vietnamese names, scores (0-100), dates close to today (ISO format), and short text. For date-range queries (e.g. "last 7 days"), ensure returned records fall within the requested range relative to today. Always return valid JSON.

CRITICAL — ID FORMAT RULES (never deviate):
- CandidateID: always use format "CAND-XXXX" (e.g. "CAND-1023", "CAND-1049"). NEVER use "UV1023", "UV001", or plain numbers like "1023".
- RecruitmentID: always use the exact ID provided in the tool arguments (e.g. "RJ20240115"). Never invent a new one.
- If the same entity appears across multiple tool calls (same name, same ID), reuse EXACTLY the same CandidateID, name, and email every time.`
  }

  if (signal?.aborted) return { targetSystemPrompt, scenarioDescription, tools, mockContext, tasks: [] }

  // ── Call 3: generate evaluation task list ─────────────────────────
  // Tasks are concrete, testable actions the Target Model must perform.
  // They will be delivered one-by-one by the User Model and evaluated by the judge.
  onProgress?.('Generating tasks (3/3)…')
  const toolNames = tools.map(t => t.function.name).join(', ')
  const tasksPrompt = `You are designing an evaluation test for an AI assistant.

Assistant role: ${targetSystemPrompt}
Scenario: ${scenarioDescription}
${toolNames ? `Available tools: ${toolNames}` : ''}

Generate exactly ${numTasks} concrete evaluation tasks. Each task should:
- Be a specific, verifiable action the assistant must complete
- Require using tools where appropriate (not just answering questions)
- Test different capabilities (search, retrieval, comparison, recommendation)
- Be realistic for the scenario — tasks a real user would actually request
- Be completable within 1–3 tool calls

Return ONLY a JSON array of exactly ${numTasks} task strings (no explanation, no markdown):
["Task description 1", "Task description 2", ...]

Example format:
["Tìm ứng viên tên Nguyễn Văn A và liệt kê CandidateID, email, vị trí đã ứng tuyển", "Lấy danh sách ứng viên ở vòng Technical Interview của tin RJ20231201", "So sánh điểm fit của CAND-1042 và CAND-1188 với tin RJ20231201 và đề xuất ai nên vào vòng tiếp theo"]`

  const tasksRes = await chatCompletion(
    { ...userCfg, maxTokens: 1024 },
    [{ role: 'user', content: tasksPrompt }],
    signal
  )
  const tasksText = tasksRes.choices?.[0]?.message?.content || ''
  const tasksRawMatch = tasksText.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || tasksText.match(/(\[[\s\S]*\])/)
  let tasks: string[] = []
  try {
    const parsed = JSON.parse(tasksRawMatch ? tasksRawMatch[1] : tasksText)
    if (Array.isArray(parsed)) tasks = parsed.filter((t): t is string => typeof t === 'string')
  } catch { /* no tasks */ }

  return { targetSystemPrompt, scenarioDescription, tools, mockContext, tasks }
}
