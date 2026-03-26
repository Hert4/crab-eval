import { SimulationTurn, SimulationResult } from '@/types'
import { chatCompletion, OpenAIConfig, OpenAIMessage, OpenAITool, getApiKey } from './openai'
import { useVisualEvalStore, getSimController, abortSim } from '@/store/visualEvalStore'

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
  scenarioDescription: string     // shown to User Model as context
  targetSystemPrompt: string      // system prompt for Target Model
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
  maxTurns: number
  tools?: OpenAITool[]            // tools available to Target Model
  mockContext?: string            // hints for User Model when faking tool responses
}

// ── Module-level singleton ────────────────────────────────────────────
let _simPromise: Promise<void> | null = null

export function isSimRunning(): boolean {
  return !!_simPromise
}

export async function startSimulation(config: SimConfig): Promise<void> {
  if (_simPromise) return
  const store = useVisualEvalStore.getState()
  store.startSim(config.maxTurns)
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

// ── User Model system prompt ──────────────────────────────────────────
function buildUserSystemPrompt(config: SimConfig): string {
  const toolNames = config.tools?.map(t => t.function.name).join(', ') || ''
  return `You are roleplaying as a REAL HUMAN USER interacting with an AI assistant. You are NOT an AI, NOT an evaluator — you ARE the user for the duration of this simulation.

SCENARIO: ${config.scenarioDescription}
${toolNames ? `\nThe assistant has access to these tools: ${toolNames}` : ''}
${config.mockContext ? `\nContext/data hints for realistic responses: ${config.mockContext}` : ''}

CRITICAL RULES — read carefully:
1. **You ARE the user.** Stay in character 100%. Never break character, never ask the assistant to roleplay, never say "I'm an AI" or "I can't provide data".
2. **Always provide concrete data when asked.** If the assistant asks for a name, ID, job title, email — INVENT realistic fictional data and provide it immediately. Example: if asked "what candidate?", reply "Nguyễn Văn Anh, applying for Senior Backend Engineer". Never say "I don't have this info" — you are a human user with real needs.
3. **Drive the conversation forward.** Start with a clear request. If the assistant asks a clarifying question, answer it with specific (invented if needed) data and push toward the goal.
4. **Score each assistant reply** (on a new line after your message): [SCORE R:X A:X H:X] — X is 1-10:
   - R = Relevancy (does it address what you asked?)
   - A = Accuracy (is the info correct/reasonable?)
   - H = Helpfulness (did it actually help you complete the task?)
5. **If the assistant calls a TOOL**, respond with realistic mock JSON matching the tool's expected output. Use the tool name and arguments to infer realistic data.
6. After ${config.maxTurns} turns OR when the scenario goal is fully achieved, write [DONE] then:
   \`\`\`json
   {"overall": <1-10>, "assessment": "<2-3 sentences on how well the assistant performed the scenario>"}
   \`\`\`

REMEMBER: You have real data, real needs. Provide it. Move the conversation forward. Never get stuck asking for clarification about your own data.`
}

// ── Parse scores from User Model response ────────────────────────────
function parseScoreTag(text: string): { relevancy: number; accuracy: number; helpfulness: number } | null {
  const m = text.match(/\[SCORE\s+R:(\d+(?:\.\d+)?)\s+A:(\d+(?:\.\d+)?)\s+H:(\d+(?:\.\d+)?)\]/i)
  if (!m) return null
  return {
    relevancy: Math.min(10, Math.max(1, parseFloat(m[1]))),
    accuracy: Math.min(10, Math.max(1, parseFloat(m[2]))),
    helpfulness: Math.min(10, Math.max(1, parseFloat(m[3]))),
  }
}

function stripScoreTag(text: string): string {
  return text.replace(/\[SCORE\s+R:\d+(?:\.\d+)?\s+A:\d+(?:\.\d+)?\s+H:\d+(?:\.\d+)?\]/gi, '').trim()
}

function parseFinalJson(text: string): { overall: number; assessment: string } | null {
  try {
    const m = text.match(/```json\s*([\s\S]*?)\s*```/)
    const jsonStr = m ? m[1] : text.slice(text.lastIndexOf('{'))
    const obj = JSON.parse(jsonStr)
    if (typeof obj.overall === 'number' && typeof obj.assessment === 'string') return obj
  } catch { /* ignore */ }
  return null
}

// ── Main simulation loop ──────────────────────────────────────────────
async function _runSimulation(config: SimConfig, signal: AbortSignal): Promise<void> {
  const store = useVisualEvalStore.getState
  const targetApiKey = getApiKey('target_api_key')
  const userApiKey = getApiKey('visual_user_api_key')

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

  // Message histories (kept separate, merged for each API call)
  const targetMessages: OpenAIMessage[] = []
  if (config.targetSystemPrompt) {
    targetMessages.push({ role: 'system', content: config.targetSystemPrompt })
  }

  const userMessages: OpenAIMessage[] = [
    { role: 'system', content: buildUserSystemPrompt(config) },
    // Kick-off prompt: force User Model to immediately start as the user, not ask meta-questions
    { role: 'user', content: 'Begin the simulation now. Send your first message as the user. Use specific fictional data if needed. Do not explain or meta-comment — just start the conversation.' },
  ]

  const simId = crypto.randomUUID()
  const startTime = Date.now()
  const allScores: { relevancy: number; accuracy: number; helpfulness: number }[] = []
  let turnIndex = 0
  let finalAssessment = ''
  let finalOverall = 0

  // ── Turn loop ─────────────────────────────────────────────────────
  for (let turn = 0; turn < config.maxTurns; turn++) {
    if (signal.aborted) break

    // ── Step 1: User Model generates next question ─────────────────
    store().updateStatus(`Turn ${turn + 1}/${config.maxTurns} — User Model thinking…`)
    const t0 = Date.now()

    let userText = ''
    try {
      const userRes = await chatCompletion(userCfg, userMessages, signal)
      userText = userRes.choices?.[0]?.message?.content || ''
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e
      store().setError(`User Model error: ${e}`)
      break
    }

    // Check for [DONE]
    const isDone = /\[DONE\]/i.test(userText)

    // Parse scores (from previous turn evaluation embedded in this message)
    const scores = parseScoreTag(userText)
    if (scores) allScores.push(scores)

    // Strip score tag and [DONE] for the clean message
    const cleanUserText = stripScoreTag(userText).replace(/\[DONE\]/gi, '').trim()

    // If [DONE], parse final JSON and break before sending more messages
    if (isDone) {
      const final = parseFinalJson(userText)
      finalOverall = final ? final.overall * 10 : computeAvgScore(allScores)
      finalAssessment = final?.assessment || 'Simulation completed.'

      // Add final user turn to transcript (without [DONE] noise)
      if (cleanUserText) {
        const finalTurn: SimulationTurn = {
          turnIndex: turnIndex++,
          role: 'user',
          content: cleanUserText,
          scores: scores ?? undefined,
          durationMs: Date.now() - t0,
        }
        store().addTurn(finalTurn)
        userMessages.push({ role: 'assistant', content: userText })
        targetMessages.push({ role: 'user', content: cleanUserText })
      }
      break
    }

    // Add user turn to transcript
    const userTurn: SimulationTurn = {
      turnIndex: turnIndex++,
      role: 'user',
      content: cleanUserText,
      scores: scores ?? undefined,
      durationMs: Date.now() - t0,
    }
    store().addTurn(userTurn)
    userMessages.push({ role: 'assistant', content: userText })
    targetMessages.push({ role: 'user', content: cleanUserText })

    if (signal.aborted) break

    // ── Step 2: Target Model responds ────────────────────────────────
    store().updateStatus(`Turn ${turn + 1}/${config.maxTurns} — Target Model responding…`)
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
    const assistantTurn: SimulationTurn = {
      turnIndex: turnIndex++,
      role: 'assistant',
      content: targetText,
      tool_calls: targetToolCalls.length > 0
        ? targetToolCalls.map(tc => ({ type: 'function' as const, function: { name: tc.name, arguments: tc.arguments } }))
        : undefined,
      durationMs: Date.now() - t1,
    }
    store().addTurn(assistantTurn)

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
      // Ask User Model to fake ALL tool responses in one batch request
      store().updateStatus(`Turn ${turn + 1}/${config.maxTurns} — User Model faking ${targetToolCalls.length} tool(s)…`)

      const toolBatchPrompt = targetToolCalls.map(tc =>
        `Tool: "${tc.name}"\nArguments: ${tc.arguments}\nReturn a realistic JSON object this tool would return.`
      ).join('\n\n---\n\n')

      userMessages.push({
        role: 'user',
        content: `The assistant called ${targetToolCalls.length} tool(s). For each, return ONLY a JSON object on a line starting with the tool name:\n\n${toolBatchPrompt}\n\nFormat your response as:\n${targetToolCalls.map(tc => `${tc.name}: {...}`).join('\n')}`,
      })

      let batchResponse = ''
      try {
        const mockRes = await chatCompletion(userCfg, userMessages, signal)
        batchResponse = mockRes.choices?.[0]?.message?.content || ''
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e
        batchResponse = ''
      }
      userMessages.push({ role: 'assistant', content: batchResponse })

      // Parse individual tool responses from batch
      for (const tc of targetToolCalls) {
        if (signal.aborted) break

        // Try to extract this tool's JSON from the batch response
        let mockResult = '{}'
        const patterns = [
          // "tool_name: {...}" or "tool_name:\n{...}"
          new RegExp(`${tc.name}[:\\s]+(\{[\\s\\S]*?\})(?=\\n[\\w_]+:|$)`, 'i'),
          // Any standalone JSON object near the tool name
          new RegExp(`${tc.name}[^{]*(\{[\\s\\S]*?\})`, 'i'),
        ]
        for (const pat of patterns) {
          const m = batchResponse.match(pat)
          if (m) { mockResult = m[1].trim(); break }
        }
        // Fallback: if only one tool, try extracting any JSON object
        if (mockResult === '{}' && targetToolCalls.length === 1) {
          const jsonMatch = batchResponse.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || batchResponse.match(/(\{[\s\S]*\})/)
          if (jsonMatch) mockResult = jsonMatch[1]
        }

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
      store().updateStatus(`Turn ${turn + 1}/${config.maxTurns} — Target Model processing tool result…`)
      const t2 = Date.now()
      try {
        const afterToolRes = await chatCompletion(targetCfg, targetMessages, signal)
        const afterChoice = afterToolRes.choices?.[0]
        const afterText = afterChoice?.message?.content || ''
        if (afterText) {
          const afterTurn: SimulationTurn = {
            turnIndex: turnIndex++,
            role: 'assistant',
            content: afterText,
            durationMs: Date.now() - t2,
          }
          store().addTurn(afterTurn)
          targetMessages.push({ role: 'assistant', content: afterText })
          // Feed final target reply to User Model for evaluation
          userMessages.push({ role: 'user', content: afterText })
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') throw e
      }
    } else {
      // No tool calls — feed assistant reply to User Model
      userMessages.push({ role: 'user', content: targetText || '[No response]' })
    }
  }

  if (signal.aborted) {
    // Partial result — still save what we have
    finalOverall = computeAvgScore(allScores)
    finalAssessment = 'Simulation stopped by user.'
  }

  // ── Build final result ────────────────────────────────────────────
  const result: SimulationResult = {
    simId,
    scenarioName: config.scenarioName,
    targetModel: config.targetConfig.model,
    userModel: config.userConfig.model,
    date: new Date().toISOString().replace('T', ' ').slice(0, 19),
    durationMs: Date.now() - startTime,
    turns: useVisualEvalStore.getState().turns,
    finalScore: Math.round(finalOverall),
    finalAssessment,
    status: signal.aborted ? 'stopped' : 'completed',
  }

  // Save to disk
  try {
    await fetch('/api/visual-eval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    })
  } catch (e) {
    console.warn('[visualEvalRunner] Failed to save to disk:', e)
  }

  // Push to results store (leaderboard)
  const avgScoresByMetric = {
    overall: Math.round(finalOverall),
    relevancy: Math.round(avg(allScores.map(s => s.relevancy)) * 10),
    accuracy: Math.round(avg(allScores.map(s => s.accuracy)) * 10),
    helpfulness: Math.round(avg(allScores.map(s => s.helpfulness)) * 10),
  }
  try {
    const { useResultsStore } = await import('@/store/resultsStore')
    useResultsStore.getState().addRun({
      runId: simId,
      model: config.targetConfig.model,
      baseUrl: config.targetConfig.baseUrl,
      date: result.date,
      durationMs: result.durationMs,
      tasks: { [config.scenarioName]: avgScoresByMetric },
    })
  } catch (e) {
    console.warn('[visualEvalRunner] Failed to push to leaderboard:', e)
  }

  useVisualEvalStore.getState().setDone(result)
}

// ── Helpers ───────────────────────────────────────────────────────────
function avg(arr: number[]): number {
  if (!arr.length) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function computeAvgScore(scores: { relevancy: number; accuracy: number; helpfulness: number }[]): number {
  if (!scores.length) return 0
  const total = scores.reduce((s, x) => s + (x.relevancy + x.accuracy + x.helpfulness) / 3, 0)
  return (total / scores.length) * 10  // scale to 0-100
}

// ── Scenario generation helper ────────────────────────────────────────
export async function generateScenario(
  description: string,
  userCfg: OpenAIConfig,
  signal?: AbortSignal,
  onProgress?: (msg: string) => void
): Promise<{ targetSystemPrompt: string; scenarioDescription: string; tools: OpenAITool[]; mockContext: string }> {

  // ── Call 1: generate scenario (uses first ~8k chars for context) ──
  onProgress?.('Generating scenario (1/2)…')
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

  if (signal?.aborted) return { targetSystemPrompt, scenarioDescription, tools: [], mockContext: '' }

  // ── Call 2: extract ALL tools from full document ──────────────────
  onProgress?.('Extracting tools (2/2)…')
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
- If the document already defines tool names and parameters, reproduce them EXACTLY.
- If no tools are described, return [].
- Return ONLY the JSON array, no explanation, no markdown fences.`

  const toolsRes = await chatCompletion(
    { ...userCfg, maxTokens: 8000 },
    [{ role: 'user', content: toolsPrompt }],
    signal
  )
  const toolsText = toolsRes.choices?.[0]?.message?.content || ''
  // Strip markdown if present
  const toolsMatch = toolsText.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || toolsText.match(/(\[[\s\S]*\])/)
  let tools: OpenAITool[] = []
  try {
    const parsed = JSON.parse(toolsMatch ? toolsMatch[1] : toolsText)
    if (Array.isArray(parsed)) tools = parsed
  } catch { /* no tools */ }

  // Auto-generate mockContext: brief sample output hints for each tool
  // so User Model knows what realistic fake data to return
  let mockContext = ''
  if (tools.length > 0) {
    const toolSummaries = tools.slice(0, 10).map(t => {
      const params = Object.keys((t.function.parameters as Record<string, unknown>)?.properties as Record<string, unknown> ?? {}).join(', ')
      return `${t.function.name}(${params})`
    }).join(' | ')
    mockContext = `Tools: ${toolSummaries}. When faking tool responses, return realistic JSON with plausible Vietnamese names, IDs (e.g. CandidateID: "UV001"), scores (0-100), dates (ISO format), and short text. Always return valid JSON.`
  }

  return { targetSystemPrompt, scenarioDescription, tools, mockContext }
}
