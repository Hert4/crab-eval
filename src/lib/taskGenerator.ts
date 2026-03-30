import {
  AtomicSubtask,
  CompositeTask,
  GeneratedTask,
  ComposeOptions,
  EdgeCaseType,
  UserPersona,
  InfoCompleteness,
  ModelConfig,
} from '@/types'
import { chatCompletion, OpenAIMessage, buildFileMessageContent } from './openai'

// ── Retry helper ─────────────────────────────────────────────────────
async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 4,
  baseDelayMs = 1500
): Promise<T> {
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      if (e instanceof DOMException && e.name === 'AbortError') throw e
      const msg = e instanceof Error ? e.message : String(e)
      // Retry on network errors and any 5xx (including 504 Gateway Timeout).
      // The 504 body is HTML so we match on the status code number in the
      // "API error 504:" prefix that openai.ts prepends.
      const isRetryable =
        e instanceof TypeError ||
        /API error (429|5\d\d)/.test(msg) ||
        msg.includes('timeout') ||
        msg.includes('ECONNRESET') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('Gateway Time-out') ||
        msg.includes('upstream_error')
      if (!isRetryable || i === attempts - 1) break
      const delay = baseDelayMs * Math.pow(2, i)   // 1.5 s, 3 s, 6 s
      console.warn(`[taskGenerator] attempt ${i + 1} failed (${msg.slice(0, 80)}), retrying in ${delay}ms`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw last
}

// ── JSON parse with LLM self-repair ──────────────────────────────────
async function parseJsonWithRepair<T>(
  raw: string,
  config: ModelConfig,
  signal?: AbortSignal
): Promise<T> {
  // Strip markdown fences if present
  const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
  try {
    return JSON.parse(cleaned) as T
  } catch {
    // Ask LLM to fix its own output
    const repairMsg: OpenAIMessage[] = [
      {
        role: 'user',
        content: `The following text is supposed to be valid JSON but has a syntax error. Fix it and return ONLY valid JSON, no markdown fences, no preamble:\n\n${cleaned}`,
      },
    ]
    const res = await chatCompletion(
      { baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model },
      repairMsg,
      signal
    )
    const fixed = (res.choices[0]?.message?.content || '')
      .replace(/^```(?:json)?\n?/m, '')
      .replace(/\n?```$/m, '')
      .trim()
    return JSON.parse(fixed) as T
  }
}

// ── Step 1: Extract Atomic Subtasks ──────────────────────────────────

const EXTRACT_SYSTEM = `You are an expert at analyzing AI agent specifications. Your task is to read a document describing an agent's skills and tools, then extract a structured list of ATOMIC SUBTASKS.

An atomic subtask is ONE discrete action a user might ask the agent to perform.

RULES:
- Extract ONLY what is described in the document. Do NOT invent skills or tools.
- Each subtask should map to exactly one skill or one logical user request.
- If a skill supports multiple distinct operations (e.g., "create new" vs "edit existing"), split them into separate subtasks.
- For each subtask, identify:
  - The tools that need to be called (in order)
  - What information the user must provide (required inputs)
  - What information is optional
  - 2-4 assertion criteria (see CRITERIA RULES below)
  - Dependencies on other subtasks (e.g., "must search first to get an ID")
  - A group name for subtasks that are alternatives to each other
- Detect the primary language of the document and include it in your response.
- Generate realistic sample values for each parameter that fit the domain context.
- For intent classification use: information_retrieval, analysis, content_generation, or action.

CRITERIA RULES — VERY IMPORTANT:
These criteria will be used by an LLM judge to evaluate a single-turn AI agent response.
The agent responds with tool calls and/or text — there is NO real tool execution, so criteria must NOT depend on API results.

Write criteria that assess what the AGENT DID, not what the API returned:
GOOD criteria (agent behavior):
  - "Agent calls [tool_name] with [param] set to the value provided by the user"
  - "Agent includes [required_arg] in the tool call arguments"
  - "Agent asks for clarification when [required_input] is missing"
  - "Agent declines and explains it cannot perform this action"
  - "Agent calls tools in the correct order: [tool1] before [tool2]"
BAD criteria (API results — DO NOT use):
  - "A list of results is returned"
  - "The response contains CandidateID and CandidateName"
  - "The API confirms the record was saved"

Respond with a JSON object with this exact shape:
{
  "language": "detected language name, e.g. English",
  "subtasks": [
    {
      "id": "snake_case_unique_id",
      "name": "Short display name",
      "description": "One-line description of what this subtask does",
      "intent": "information_retrieval|analysis|content_generation|action",
      "skillRef": "exact skill name from document",
      "expectedTools": [
        { "toolName": "tool_name", "requiredArgs": ["arg1"], "optionalArgs": ["arg2"], "order": 1 }
      ],
      "requiredInputs": [
        { "name": "param_name", "type": "string|number|date|id", "description": "what it means", "sampleValues": ["example1", "example2"] }
      ],
      "optionalInputs": [],
      "assertionCriteria": ["Agent calls get_candidates with candidate_name set to the provided name", "Agent includes recruitment_name in arguments when the user specifies a job posting"],
      "group": "group_name_for_mutually_exclusive_subtasks",
      "dependsOn": ["subtask_id_that_must_run_first"]
    }
  ]
}

No markdown fences. No preamble. Return only the JSON object.`

// Chunk a document into pieces ≤ maxChars.
// Strategy 1: split at markdown heading boundaries (## / ###).
// Strategy 2 (fallback): split at blank-line paragraph boundaries.
// Strategy 3 (last resort): hard-split at maxChars.
function chunkDocument(content: string, maxChars = 10000): string[] {
  if (content.length <= maxChars) return [content]

  // Try heading boundaries first
  const headingRe = /^#{1,3}\s.+$/gm
  const headingPositions: number[] = [0]
  let m: RegExpExecArray | null
  while ((m = headingRe.exec(content)) !== null) {
    if (m.index > 0) headingPositions.push(m.index)
  }
  headingPositions.push(content.length)

  // Try paragraph boundaries (two or more newlines) as fallback
  const paragraphRe = /\n{2,}/g
  const paraPositions: number[] = [0]
  while ((m = paragraphRe.exec(content)) !== null) {
    paraPositions.push(m.index + m[0].length)
  }
  paraPositions.push(content.length)

  // Pick whichever boundary set gives more split points
  const boundaries = headingPositions.length > 2 ? headingPositions : paraPositions

  const chunks: string[] = []
  let current = ''
  for (let i = 0; i < boundaries.length - 1; i++) {
    const section = content.slice(boundaries[i], boundaries[i + 1])
    if ((current + section).length > maxChars && current.length > 0) {
      chunks.push(current.trim())
      current = section
    } else {
      current += section
    }
    // If a single section is still too large, hard-split it
    if (current.length > maxChars) {
      for (let start = 0; start < current.length; start += maxChars) {
        chunks.push(current.slice(start, start + maxChars).trim())
      }
      current = ''
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks.filter(c => c.length > 0)
}

function validateSubtask(s: unknown): s is AtomicSubtask {
  if (!s || typeof s !== 'object') return false
  const obj = s as Record<string, unknown>
  return (
    typeof obj.id === 'string' &&
    obj.id.length > 0 &&
    typeof obj.name === 'string' &&
    Array.isArray(obj.expectedTools) &&
    (obj.expectedTools as unknown[]).length > 0 &&
    Array.isArray(obj.assertionCriteria) &&
    (obj.assertionCriteria as unknown[]).length > 0
  )
}

function mergeSubtasks(arrays: AtomicSubtask[][]): AtomicSubtask[] {
  const seen = new Set<string>()
  const result: AtomicSubtask[] = []
  for (const arr of arrays) {
    for (const s of arr) {
      if (!seen.has(s.id)) {
        seen.add(s.id)
        result.push(s)
      }
    }
  }
  return result
}

export async function extractAtomicSubtasks(
  documentContent: string,
  config: ModelConfig,
  signal?: AbortSignal,
  onProgress?: (msg: string) => void,
  sourceFile?: File
): Promise<{ subtasks: AtomicSubtask[]; detectedLanguage: string }> {

  // ── File-direct path ──────────────────────────────────────────────────
  if (sourceFile) {
    onProgress?.(`Sending file "${sourceFile.name}" directly to model...`)
    const fileContent = await buildFileMessageContent(
      sourceFile, config.baseUrl, config.apiKey, signal
    )
    if (fileContent) {
      const userContent: unknown[] = [
        { type: 'text', text: 'Agent specification document (see attached file):' },
        ...fileContent,
      ]
      const messages = [
        { role: 'system' as const, content: EXTRACT_SYSTEM },
        { role: 'user' as const, content: userContent as OpenAIMessage['content'] },
      ]
      const raw = await withRetry(async () => {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        const res = await chatCompletion(
          { baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, maxTokens: 8000, temperature: 0 },
          messages,
          signal
        )
        return res.choices[0]?.message?.content || ''
      })
      onProgress?.('Parsing response...')
      const parsed = await parseJsonWithRepair<{ language: string; subtasks: unknown[] }>(raw, config, signal)
      const valid = (parsed.subtasks || []).filter(validateSubtask) as AtomicSubtask[]
      onProgress?.(`Done — ${valid.length} subtasks extracted from file`)
      return { subtasks: valid, detectedLanguage: parsed.language || 'English' }
    }

    // Files API not supported by this endpoint — parse server-side then chunk
    onProgress?.('Files API not supported by this endpoint, parsing file server-side...')
    try {
      const form = new FormData()
      form.append('file', sourceFile, sourceFile.name)
      const res = await fetch('/api/parse-document', { method: 'POST', body: form, signal: signal ?? undefined })
      if (res.ok) {
        const json = await res.json()
        if (json.text) {
          onProgress?.(`Parsed ${json.text.length.toLocaleString()} chars from file, chunking...`)
          // Replace the placeholder with real content then fall through to chunking
          return extractAtomicSubtasks(json.text, config, signal, onProgress)
        }
      }
    } catch {
      // ignore — fall through to chunking with whatever documentContent we have
    }
    onProgress?.('Falling back to text content...')
  }

  // ── Text chunking path ────────────────────────────────────────────────
  const chunks = chunkDocument(documentContent)
  const allSubtaskArrays: AtomicSubtask[][] = []
  let detectedLanguage = 'English'

  onProgress?.(`Document split into ${chunks.length} chunk${chunks.length > 1 ? 's' : ''} (~${Math.round(documentContent.length / chunks.length / 1000)}K chars each)`)

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci]
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    onProgress?.(`Processing chunk ${ci + 1} / ${chunks.length} (${chunk.length} chars)...`)

    const messages: OpenAIMessage[] = [
      { role: 'system', content: EXTRACT_SYSTEM },
      { role: 'user', content: `Document content:\n\n${chunk}` },
    ]

    const raw = await withRetry(async () => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const res = await chatCompletion(
        { baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, maxTokens: 8000, temperature: 0 },
        messages,
        signal
      )
      return res.choices[0]?.message?.content || ''
    })

    const parsed = await parseJsonWithRepair<{ language: string; subtasks: unknown[] }>(raw, config, signal)

    if (parsed.language) detectedLanguage = parsed.language

    const valid = (parsed.subtasks || []).filter(validateSubtask) as AtomicSubtask[]
    const dropped = (parsed.subtasks || []).filter(s => !validateSubtask(s)).length
    if (dropped > 0) {
      console.warn(`[taskGenerator] Dropped ${dropped} invalid subtasks from chunk ${ci + 1}`)
    }
    allSubtaskArrays.push(valid)
    onProgress?.(`Chunk ${ci + 1} done — ${valid.length} subtask${valid.length !== 1 ? 's' : ''} extracted`)
  }

  return {
    subtasks: mergeSubtasks(allSubtaskArrays),
    detectedLanguage,
  }
}

// ── Generate Agent System Prompt ──────────────────────────────────────
// Reads the same document and produces a ready-to-use system prompt
// that can be injected into the eval runner so the target model knows
// its role, available tools, and behavioral rules.

const SYSTEM_PROMPT_GEN = `You are an expert at writing AI agent system prompts.
Read the following agent specification document and write a complete, production-ready
system prompt for that agent.

Requirements:
- Written in the same language as the document.
- Starts with a clear role definition ("You are an AI assistant that helps users with...").
- Lists all available tools/skills the agent can use, with a one-line description each.
- States what the agent should do when information is missing (ask for clarification).
- States what the agent should do for out-of-scope requests (politely decline and explain).
- Concise but complete — no filler phrases.

Return ONLY the system prompt text. No preamble, no explanation, no markdown fences.`

export async function generateSystemPrompt(
  documentContent: string,
  config: ModelConfig,
  signal?: AbortSignal,
  sourceFile?: File
): Promise<string> {
  let userContent: unknown

  if (sourceFile) {
    const fileContent = await buildFileMessageContent(sourceFile, config.baseUrl, config.apiKey, signal)
    if (fileContent) {
      userContent = [
        { type: 'text', text: 'Agent specification document (see attached file):' },
        ...fileContent,
      ]
    } else {
      // Files API not supported — try server-side parse for real text
      try {
        const form = new FormData()
        form.append('file', sourceFile, sourceFile.name)
        const res = await fetch('/api/parse-document', { method: 'POST', body: form, signal: signal ?? undefined })
        if (res.ok) {
          const json = await res.json()
          if (json.text) {
            userContent = `Agent specification document:\n\n${(json.text as string).slice(0, 24000)}`
          }
        }
      } catch { /* ignore, fall through to documentContent */ }
    }
  }

  if (!userContent) {
    // Use up to 24K chars (2–3 chunks worth) so the full spec is visible
    const chunk = documentContent.slice(0, 24000)
    if (!chunk) return ''
    userContent = `Agent specification document:\n\n${chunk}`
  }

  const messages: OpenAIMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT_GEN },
    { role: 'user', content: userContent as OpenAIMessage['content'] },
  ]

  const raw = await withRetry(async () => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const res = await chatCompletion(
      { baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, maxTokens: 2000, temperature: 0 },
      messages,
      signal
    )
    return res.choices[0]?.message?.content || ''
  })

  return raw.trim()
}

// ── Generate Tool Definitions ─────────────────────────────────────────
// Reads the document and produces an OpenAI-format tool definitions array
// that can be passed directly to the model on every eval call.

const TOOL_DEFS_GEN = `You are an expert at writing OpenAI function/tool definitions.
Read the following agent specification document and produce a JSON array of tool definitions
in the standard OpenAI tools format.

Requirements:
- One tool object per distinct API function/skill described in the document.
- Each tool must follow this exact shape:
  {
    "type": "function",
    "function": {
      "name": "snake_case_name",
      "description": "One sentence describing what this function does.",
      "parameters": {
        "type": "object",
        "properties": {
          "param_name": {
            "type": "string|number|integer|boolean|array",
            "description": "What this parameter means."
          }
        },
        "required": ["list", "of", "required", "params"]
      }
    }
  }
- Use snake_case for all function and parameter names.
- Use the parameter names and types exactly as described in the document.
- Do NOT invent functions not described in the document.
- Do NOT add markdown fences, preamble, or explanation.

Return ONLY the raw JSON array. No markdown. No preamble.`

// Merge tool arrays, deduplicating by function name (first occurrence wins)
function mergeToolDefs(arrays: unknown[][]): unknown[] {
  const seen = new Set<string>()
  const result: unknown[] = []
  for (const arr of arrays) {
    for (const tool of arr) {
      if (!tool || typeof tool !== 'object') continue
      const t = tool as Record<string, unknown>
      const fn = t.function as Record<string, unknown> | undefined
      const name = fn?.name as string | undefined
      if (!name || seen.has(name)) continue
      seen.add(name)
      result.push(tool)
    }
  }
  return result
}

export async function generateToolDefinitions(
  documentContent: string,
  config: ModelConfig,
  signal?: AbortSignal,
  sourceFile?: File,
  onProgress?: (msg: string) => void
): Promise<unknown[]> {
  // File-direct path: send file to model if supported
  if (sourceFile) {
    const fileContent = await buildFileMessageContent(sourceFile, config.baseUrl, config.apiKey, signal)
    if (fileContent) {
      const userContent = [
        { type: 'text', text: 'Agent specification document (see attached file):' },
        ...fileContent,
      ]
      const messages: OpenAIMessage[] = [
        { role: 'system', content: TOOL_DEFS_GEN },
        { role: 'user', content: userContent as OpenAIMessage['content'] },
      ]
      const raw = await withRetry(async () => {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        const res = await chatCompletion(
          { baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, maxTokens: 6000, temperature: 0 },
          messages,
          signal
        )
        return res.choices[0]?.message?.content || ''
      })
      try {
        const parsed = await parseJsonWithRepair<unknown[]>(raw, config, signal)
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    }
  }

  // Text chunking path: chunk the full document and merge results
  const text = documentContent.trim()
  if (!text) return []

  const chunks = chunkDocument(text, 10000)
  const allToolArrays: unknown[][] = []

  onProgress?.(`Extracting tools from ${chunks.length} chunk${chunks.length > 1 ? 's' : ''}...`)

  for (let ci = 0; ci < chunks.length; ci++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const chunk = chunks[ci]
    onProgress?.(`Tool extraction: chunk ${ci + 1} / ${chunks.length}...`)
    const messages: OpenAIMessage[] = [
      { role: 'system', content: TOOL_DEFS_GEN },
      { role: 'user', content: `Agent specification document (part ${ci + 1} of ${chunks.length}):\n\n${chunk}` },
    ]
    try {
      const raw = await withRetry(async () => {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        const res = await chatCompletion(
          { baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, maxTokens: 6000, temperature: 0 },
          messages,
          signal
        )
        return res.choices[0]?.message?.content || ''
      })
      const parsed = await parseJsonWithRepair<unknown[]>(raw, config, signal)
      if (Array.isArray(parsed)) {
        allToolArrays.push(parsed)
        onProgress?.(`  chunk ${ci + 1} → ${parsed.length} tool${parsed.length !== 1 ? 's' : ''} found`)
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e
      console.warn(`[taskGenerator] Tool defs chunk ${ci + 1} failed:`, e)
    }
  }

  return mergeToolDefs(allToolArrays)
}
function buildDependencyGraph(subtasks: AtomicSubtask[]): {
  deps: Map<string, Set<string>>       // id → set of ids it depends on
  revDeps: Map<string, Set<string>>    // id → set of ids that depend on it
} {
  const deps = new Map<string, Set<string>>()
  const revDeps = new Map<string, Set<string>>()

  for (const s of subtasks) {
    if (!deps.has(s.id)) deps.set(s.id, new Set())
    if (!revDeps.has(s.id)) revDeps.set(s.id, new Set())
  }

  for (const s of subtasks) {
    for (const depId of s.dependsOn || []) {
      deps.get(s.id)!.add(depId)
      if (!revDeps.has(depId)) revDeps.set(depId, new Set())
      revDeps.get(depId)!.add(s.id)
    }
  }

  return { deps, revDeps }
}

function detectCycle(subtasks: AtomicSubtask[]): string | null {
  const { deps } = buildDependencyGraph(subtasks)
  const visited = new Set<string>()
  const stack = new Set<string>()

  function dfs(id: string): string | null {
    if (stack.has(id)) return id
    if (visited.has(id)) return null
    stack.add(id)
    visited.add(id)
    for (const dep of deps.get(id) || []) {
      const cycle = dfs(dep)
      if (cycle) return cycle
    }
    stack.delete(id)
    return null
  }

  for (const s of subtasks) {
    const cycle = dfs(s.id)
    if (cycle) return cycle
  }
  return null
}

// Find all valid paths of length min..max using DFS
function findPaths(
  subtasks: AtomicSubtask[],
  maxSteps: number
): string[][] {
  const { deps } = buildDependencyGraph(subtasks)
  const subtaskMap = new Map(subtasks.map(s => [s.id, s]))
  const roots = subtasks.filter(s => (s.dependsOn || []).length === 0).map(s => s.id)

  const paths: string[][] = []

  function dfs(path: string[], usedGroups: Set<string>) {
    const current = path[path.length - 1]
    const currentSubtask = subtaskMap.get(current)
    if (!currentSubtask) return

    if (path.length >= 2) {
      paths.push([...path])
    }

    if (path.length >= maxSteps) return

    // Expand: find subtasks that depend on current (children in dep graph)
    for (const s of subtasks) {
      if (path.includes(s.id)) continue
      if (!deps.get(s.id)?.has(current) && (s.dependsOn || []).length > 0) {
        // This subtask depends on something, and current is not in its deps
        // Only allow if ALL its deps are already in the path
        const allDepsMet = (s.dependsOn || []).every(d => path.includes(d))
        if (!allDepsMet) continue
      } else if ((s.dependsOn || []).length === 0 && !roots.includes(current)) {
        // Independent subtask: only chain from roots
        continue
      } else if (deps.get(s.id)?.has(current)) {
        // s depends on current — valid chain
      } else {
        continue
      }

      // Group constraint: no two subtasks from same group
      if (s.group && usedGroups.has(s.group)) continue

      const newGroups = new Set(usedGroups)
      if (s.group) newGroups.add(s.group)
      dfs([...path, s.id], newGroups)
    }
  }

  for (const root of roots) {
    const rootSubtask = subtaskMap.get(root)
    const initGroups = new Set<string>()
    if (rootSubtask?.group) initGroups.add(rootSubtask.group)
    dfs([root], initGroups)
  }

  return paths
}

function assignDifficulty(
  numSteps: number,
  persona: UserPersona,
  infoCompleteness: InfoCompleteness,
  edgeCaseType: EdgeCaseType
): CompositeTask['difficulty'] {
  let level: 0 | 1 | 2 | 3 = 0

  if (numSteps === 1 && persona === 'expert' && infoCompleteness === 'complete') {
    level = 0 // easy
  } else if (numSteps === 1) {
    level = 1 // medium
  } else if (numSteps <= 3) {
    level = 1 // medium base
    if (persona === 'novice' || infoCompleteness !== 'complete') level = 2
  } else {
    level = 2 // hard base
    if (persona === 'novice' || infoCompleteness !== 'complete') level = 3
  }

  // Edge case bumps difficulty by 1
  if (edgeCaseType !== null) {
    level = Math.min(3, level + 1) as 0 | 1 | 2 | 3
  }

  const map: Record<number, CompositeTask['difficulty']> = {
    0: 'easy',
    1: 'medium',
    2: 'hard',
    3: 'expert',
  }
  return map[level]
}

function mergeAssertionCriteria(
  subtasks: AtomicSubtask[],
  subtaskIds: string[],
  infoCompleteness?: string,
  edgeCaseType?: string | null
): string[] {
  const subtaskMap = new Map(subtasks.map(s => [s.id, s]))

  // partial / missing_required_input → replace all criteria with clarification criteria
  if (infoCompleteness === 'partial' || edgeCaseType === 'missing_required_input') {
    const steps = subtaskIds.map(id => subtaskMap.get(id)).filter(Boolean) as AtomicSubtask[]
    const missingParams = steps.flatMap(s => s.requiredInputs.map(p => p.name))
    const toolNames = steps.flatMap(s => s.expectedTools.map(t => t.toolName))
    return [
      `Agent asks the user for the missing required information (${missingParams.slice(0, 3).join(', ')}) before proceeding`,
      `Agent does NOT call ${toolNames[0] ?? 'any tool'} without the required inputs`,
      `Agent response is a clarification question, not a tool call`,
    ]
  }

  // out_of_scope → replace with refusal criteria
  if (edgeCaseType === 'out_of_scope') {
    return [
      `Agent declines to perform the request and explains it is outside its capabilities`,
      `Agent does not attempt to call any tool`,
    ]
  }

  // ambiguous_entity → ask for clarification about which entity
  if (edgeCaseType === 'ambiguous_entity') {
    const steps = subtaskIds.map(id => subtaskMap.get(id)).filter(Boolean) as AtomicSubtask[]
    const toolNames = steps.flatMap(s => s.expectedTools.map(t => t.toolName))
    return [
      `Agent recognizes the ambiguity and asks the user to clarify which specific entity they mean`,
      `Agent does not blindly call ${toolNames[0] ?? 'any tool'} with the ambiguous input`,
    ]
  }

  // normal / complete — use original criteria + required args check per step
  const merged: string[] = []
  for (const id of subtaskIds) {
    const s = subtaskMap.get(id)
    if (!s) continue
    merged.push(...s.assertionCriteria)
    // Add explicit required-args criterion so judge penalizes incomplete tool calls
    for (const tool of s.expectedTools) {
      const required = tool.requiredArgs ?? s.requiredInputs.map(p => p.name)
      if (required.length > 0) {
        merged.push(
          `Agent's call to ${tool.toolName} includes all required arguments: ${required.join(', ')}`
        )
      }
    }
  }
  return [...new Set(merged)]
}

// Stratified subsample: ensure coverage constraints are met
function stratifiedSample(
  tasks: CompositeTask[],
  subtasks: AtomicSubtask[],
  targetCount: number,
  balanceBy: ComposeOptions['balanceBy']
): CompositeTask[] {
  if (tasks.length <= targetCount) return tasks

  // Must-keep: tasks that ensure each skill appears at least twice
  const skillCount = new Map<string, number>()
  const subtaskMap = new Map(subtasks.map(s => [s.id, s]))
  const mustKeep = new Set<string>()

  // Ensure each edge case type has at least 2 tasks
  const edgeCaseTypes: EdgeCaseType[] = [
    'entity_not_found', 'ambiguous_entity', 'missing_required_input',
    'malformed_input', 'out_of_scope', 'conflicting_request'
  ]
  for (const ecType of edgeCaseTypes) {
    const matching = tasks.filter(t => t.edgeCaseType === ecType)
    matching.slice(0, 2).forEach(t => mustKeep.add(t.id))
  }

  // Build skill frequency
  for (const t of tasks) {
    for (const sid of t.subtaskIds) {
      const s = subtaskMap.get(sid)
      if (s) {
        skillCount.set(s.skillRef, (skillCount.get(s.skillRef) || 0) + 1)
      }
    }
  }

  // Ensure min 2 per skill
  for (const [skillRef] of skillCount) {
    const matching = tasks.filter(t =>
      t.subtaskIds.some(sid => subtaskMap.get(sid)?.skillRef === skillRef)
    )
    matching.slice(0, 2).forEach(t => mustKeep.add(t.id))
  }

  const kept = tasks.filter(t => mustKeep.has(t.id))
  const remaining = tasks.filter(t => !mustKeep.has(t.id))

  const need = Math.max(0, targetCount - kept.length)
  if (need === 0) return kept.slice(0, targetCount)

  // Target distribution
  const target = { easy: 0.30, medium: 0.30, hard: 0.25, expert: 0.15 }
  const byDiff = new Map<string, CompositeTask[]>()
  for (const t of remaining) {
    if (!byDiff.has(t.difficulty)) byDiff.set(t.difficulty, [])
    byDiff.get(t.difficulty)!.push(t)
  }

  const selected: CompositeTask[] = []
  for (const [diff, frac] of Object.entries(target)) {
    const quota = Math.round(need * frac)
    const pool = byDiff.get(diff) || []
    selected.push(...pool.slice(0, quota))
  }

  // Fill remaining slots if needed
  const shortfall = need - selected.length
  if (shortfall > 0) {
    const selectedIds = new Set(selected.map(t => t.id))
    const extras = remaining.filter(t => !selectedIds.has(t.id))
    selected.push(...extras.slice(0, shortfall))
  }

  return [...kept, ...selected]
}

let _compositeCounter = 0

function makeCompositeId(): string {
  return `ct_${Date.now()}_${++_compositeCounter}`
}

export function composeCompositeTasks(
  subtasks: AtomicSubtask[],
  options: ComposeOptions
): CompositeTask[] {
  if (subtasks.length === 0) return []

  // Validate no cycles
  const cycle = detectCycle(subtasks)
  if (cycle) throw new Error(`Dependency cycle detected involving subtask: ${cycle}`)

  const subtaskMap = new Map(subtasks.map(s => [s.id, s]))
  const results: CompositeTask[] = []

  // Phase 2: Single-step tasks
  for (const s of subtasks) {
    for (const persona of options.personas) {
      if (persona === 'out_of_scope') continue // handled in edge cases

      for (const infoLevel of options.infoLevels) {
        // Skip trivial: single-step + expert + complete → skip (too trivial with default)
        // We keep them but mark as easy (per spec: "create 1 CompositeTask, covers easy tier")
        // Only skip if it's overly trivial and there are few required inputs
        const s_obj = subtaskMap.get(s.id)
        const hasEnoughInputs = (s_obj?.requiredInputs?.length || 0) >= 2

        if (!hasEnoughInputs && infoLevel !== 'complete') {
          // Partial/ambiguous info only apply if ≥2 required inputs
          continue
        }

        const ct: CompositeTask = {
          id: makeCompositeId(),
          name: `${s.name} (${persona}, ${infoLevel})`,
          subtaskIds: [s.id],
          difficulty: assignDifficulty(1, persona, infoLevel, null),
          numSteps: 1,
          persona,
          infoCompleteness: infoLevel,
          edgeCaseType: null,
          assertionCriteria: mergeAssertionCriteria(subtasks, [s.id], infoLevel, null),
        }
        results.push(ct)
      }
    }
  }

  // Phase 3: Multi-step chains
  const paths = findPaths(subtasks, options.maxSteps)
  for (const path of paths) {
    if (path.length < 2) continue

    const names = path.map(id => subtaskMap.get(id)?.name || id)

    for (const persona of options.personas) {
      if (persona === 'out_of_scope') continue

      for (const infoLevel of options.infoLevels) {
        // Partial/ambiguous: check that combined required inputs ≥ 2
        const totalRequired = path.reduce((sum, id) => {
          return sum + (subtaskMap.get(id)?.requiredInputs?.length || 0)
        }, 0)
        if (totalRequired < 2 && infoLevel !== 'complete') continue

        const ct: CompositeTask = {
          id: makeCompositeId(),
          name: names.join(' → '),
          subtaskIds: path,
          difficulty: assignDifficulty(path.length, persona, infoLevel, null),
          numSteps: path.length,
          persona,
          infoCompleteness: infoLevel,
          edgeCaseType: null,
          assertionCriteria: mergeAssertionCriteria(subtasks, path, infoLevel, null),
        }
        results.push(ct)
      }
    }
  }

  // Phase 5: Edge case tasks
  if (options.includeEdgeCases) {
    const lookupTools = ['get', 'list', 'search', 'find', 'fetch', 'retrieve', 'query']
    const isLookupSubtask = (s: AtomicSubtask) =>
      s.expectedTools.some(t => lookupTools.some(kw => t.toolName.toLowerCase().includes(kw)))

    const hasNameInput = (s: AtomicSubtask) =>
      s.requiredInputs.some(p =>
        ['name', 'title', 'label', 'query'].some(kw => p.name.toLowerCase().includes(kw))
      )

    const hasManyRequiredInputs = (s: AtomicSubtask) => (s.requiredInputs?.length || 0) >= 2

    const hasDateOrNumberInput = (s: AtomicSubtask) =>
      s.requiredInputs.some(p => ['date', 'number', 'id', 'int', 'float'].includes(p.type.toLowerCase()))

    const edgeCases: Array<{ type: EdgeCaseType; filter: (s: AtomicSubtask) => boolean }> = [
      { type: 'entity_not_found', filter: isLookupSubtask },
      { type: 'ambiguous_entity', filter: hasNameInput },
      { type: 'missing_required_input', filter: hasManyRequiredInputs },
      { type: 'malformed_input', filter: hasDateOrNumberInput },
      { type: 'out_of_scope', filter: () => true },
      { type: 'conflicting_request', filter: () => true },
    ]

    for (const { type, filter } of edgeCases) {
      const eligible = subtasks.filter(filter)
      const sample = eligible.slice(0, 3)
      for (const s of sample) {
        const ct: CompositeTask = {
          id: makeCompositeId(),
          name: `[${type}] ${s.name}`,
          subtaskIds: [s.id],
          difficulty: assignDifficulty(1, 'novice', 'partial', type),
          numSteps: 1,
          persona: type === 'out_of_scope' ? 'out_of_scope' : 'novice',
          infoCompleteness: type === 'missing_required_input' ? 'partial' : 'complete',
          edgeCaseType: type,
          assertionCriteria: mergeAssertionCriteria(subtasks, [s.id], type === 'missing_required_input' ? 'partial' : 'complete', type),
        }
        results.push(ct)
      }
    }
  }

  // Phase 6+7: Subsample
  return stratifiedSample(results, subtasks, options.targetCount, options.balanceBy)
}

// ── Step 3: Generate NL Questions ────────────────────────────────────

function buildVerbalizationSystemPrompt(language: string): string {
  return `You are simulating a real user of an AI agent. You will receive task specifications and must write natural, conversational requests that a real user would type — in ${language}.

RULES:
1. Write as a real person chatting, NOT as a test engineer writing test cases.
2. Adapt tone to the persona:
   - "expert": Uses correct domain terminology. Provides all necessary info upfront. Professional and concise.
   - "novice": Vague, casual language. May use incorrect terms. Omits details the agent would need, forcing it to ask follow-up.
   - "out_of_scope": Asks for something the agent cannot do. The request should sound reasonable but falls outside the agent's capabilities.
3. For info_completeness:
   - "complete": All required inputs are present in the message.
   - "partial": Deliberately omit 1-2 required inputs. The agent should ask for clarification.
   - "ambiguous": Use wording that could be interpreted multiple ways.
4. For multi-step tasks: Write ONE single message that contains all the intents. Do NOT split into multiple messages.
5. Use realistic names, dates, IDs that fit the domain context. Pull from the sample values provided in the subtask specs.
6. For edge cases:
   - entity_not_found: Reference an entity that plausibly doesn't exist.
   - ambiguous_entity: Use a common name that might match multiple records.
   - missing_required_input: Simply don't mention the required info.
   - malformed_input: Provide info in a wrong or ambiguous format.
   - out_of_scope: Ask for a reasonable but unsupported capability.
   - conflicting_request: Include contradictory requirements.

For each task, respond with JSON (one object per task, in a JSON array):
[
  {
    "taskId": "...",
    "userMessage": "the primary question/request",
    "userMessageAlt": "an alternative phrasing (different wording, same intent)",
    "tags": ["relevant", "tags"]
  }
]

No markdown fences. No preamble. Return only the JSON array.`
}

function buildTaskSpec(
  ct: CompositeTask,
  subtasks: AtomicSubtask[]
): string {
  const subtaskMap = new Map(subtasks.map(s => [s.id, s]))
  const steps = ct.subtaskIds.map(id => subtaskMap.get(id)).filter(Boolean) as AtomicSubtask[]

  const lines: string[] = [
    `Task ID: ${ct.id}`,
    `Name: ${ct.name}`,
    `Persona: ${ct.persona}`,
    `Info completeness: ${ct.infoCompleteness}`,
    `Edge case: ${ct.edgeCaseType || 'none'}`,
    `Steps (${steps.length}):`,
  ]

  for (const [i, s] of steps.entries()) {
    lines.push(`  ${i + 1}. ${s.name} — ${s.description}`)
    if (s.requiredInputs.length > 0) {
      lines.push(`     Required inputs: ${s.requiredInputs.map(p => `${p.name} (e.g. ${p.sampleValues.slice(0, 2).join(', ')})`).join('; ')}`)
    }
    if (s.optionalInputs.length > 0) {
      lines.push(`     Optional: ${s.optionalInputs.map(p => p.name).join(', ')}`)
    }
    lines.push(`     Success: ${s.assertionCriteria.join('; ')}`)
  }

  return lines.join('\n')
}

function tokenOverlap(a: string, b: string): number {
  const tokA = new Set(a.toLowerCase().split(/\s+/))
  const tokB = new Set(b.toLowerCase().split(/\s+/))
  let overlap = 0
  for (const t of tokA) if (tokB.has(t)) overlap++
  return overlap / Math.max(tokA.size, tokB.size, 1)
}

export async function generateNaturalLanguageQuestions(
  compositeTasks: CompositeTask[],
  subtasks: AtomicSubtask[],
  language: string,
  config: ModelConfig,
  signal?: AbortSignal,
  onProgress?: (done: number, total: number) => void
): Promise<GeneratedTask[]> {
  const subtaskMap = new Map(subtasks.map(s => [s.id, s]))
  const systemPrompt = buildVerbalizationSystemPrompt(language)
  const batchSize = 6
  const results: GeneratedTask[] = []
  const messages: Array<string> = []

  for (let i = 0; i < compositeTasks.length; i += batchSize) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const batch = compositeTasks.slice(i, i + batchSize)
    const specsText = batch.map(ct => buildTaskSpec(ct, subtasks)).join('\n\n---\n\n')

    const userMsg = `Generate natural language questions for the following ${batch.length} task(s). Return a JSON array with exactly ${batch.length} objects, one per task, in the same order.\n\n${specsText}`

    const apiMessages: OpenAIMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMsg },
    ]

    const raw = await withRetry(async () => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const res = await chatCompletion(
        { baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, maxTokens: 4000, temperature: 0.7 },
        apiMessages,
        signal
      )
      return res.choices[0]?.message?.content || ''
    })

    type VerbResult = { taskId: string; userMessage: string; userMessageAlt?: string; tags: string[] }
    const parsed = await parseJsonWithRepair<VerbResult[]>(raw, config, signal)

    for (let j = 0; j < batch.length; j++) {
      const ct = batch[j]
      const r = parsed[j] || {}
      const userMessage = (r.userMessage || '').slice(0, 800)
      const userMessageAlt = r.userMessageAlt ? r.userMessageAlt.slice(0, 800) : undefined

      // Validate non-empty
      if (!userMessage) {
        console.warn(`[taskGenerator] Empty userMessage for task ${ct.id}`)
        continue
      }

      // Deduplication check
      const isDuplicate = messages.some(m => tokenOverlap(m, userMessage) > 0.8)
      if (isDuplicate) {
        console.warn(`[taskGenerator] Duplicate message for task ${ct.id}, skipping`)
        continue
      }
      messages.push(userMessage)

      const steps = ct.subtaskIds.map(id => subtaskMap.get(id)).filter(Boolean) as AtomicSubtask[]
      const toolChain = steps.flatMap(s => s.expectedTools.map(t => t.toolName))

      results.push({
        id: `gt_${ct.id}`,
        compositeTaskId: ct.id,
        userMessage,
        userMessageAlt,
        persona: ct.persona,
        infoCompleteness: ct.infoCompleteness,
        difficulty: ct.difficulty,
        expectedToolChain: toolChain,
        assertionCriteria: ct.assertionCriteria,
        edgeCaseType: ct.edgeCaseType,
        tags: Array.isArray(r.tags) ? r.tags : [],
      })
    }

    onProgress?.(Math.min(i + batchSize, compositeTasks.length), compositeTasks.length)
  }

  return results
}

// ── Expected Tool Call Arguments ───────────────────────────────────────

// Build a compact text spec for LLM: tool name + required param names + sample values.
// toolDefsMap: toolName → required param names from the OpenAI tool definitions JSON (snake_case).
// Falls back to et.requiredArgs if tool not found in map.
function buildToolCallSpec(
  ct: CompositeTask,
  subtasks: AtomicSubtask[],
  toolDefsMap: Map<string, string[]>
): string {
  const subtaskMap = new Map(subtasks.map(s => [s.id, s]))
  const steps = ct.subtaskIds.map(id => subtaskMap.get(id)).filter(Boolean) as AtomicSubtask[]

  const lines: string[] = [
    `Task ID: ${ct.id}`,
    `Edge case: ${ct.edgeCaseType || 'none'}`,
    `Steps:`,
  ]

  for (const [i, s] of steps.entries()) {
    const paramByName = new Map([...s.requiredInputs, ...s.optionalInputs].map(p => [p.name.toLowerCase(), p]))

    for (const et of s.expectedTools) {
      lines.push(`  ${i + 1}. tool="${et.toolName}"`)
      // Use param names from tool definitions JSON (snake_case) if available, else fall back to requiredArgs
      const defParams = toolDefsMap.get(et.toolName)
      const requiredParams = defParams ?? et.requiredArgs
      for (const argName of requiredParams) {
        const spec = paramByName.get(argName.toLowerCase())
        const samples = spec ? spec.sampleValues.slice(0, 2).join(', ') : ''
        lines.push(`     required_param="${argName}"${samples ? ` examples=[${samples}]` : ''}`)
      }
      // Optional params: exclude from output
      if (et.optionalArgs.length > 0 && !defParams) {
        lines.push(`     (optional, exclude from output: ${et.optionalArgs.join(', ')})`)
      }
    }
  }

  return lines.join('\n')
}

/**
 * Generate expected tool call arguments for each GeneratedTask.
 *
 * LLM reads the actual userMessage and decides:
 *   - If the message provides all required params → generate tool_calls with argument values
 *   - If the message is missing required params / out-of-scope / ambiguous → tool_calls: []
 *     (meaning the correct agent behavior is to ask for clarification, not call a tool)
 *
 * Returns an updated copy of `generatedTasks` with `expectedToolCalls` populated.
 */
export async function generateExpectedToolCalls(
  generatedTasks: GeneratedTask[],
  compositeTasks: CompositeTask[],
  subtasks: AtomicSubtask[],
  config: ModelConfig,
  signal?: AbortSignal,
  onProgress?: (done: number, total: number) => void,
  toolDefinitions?: Array<{ type?: string; function?: { name: string; parameters?: { required?: string[] } } }>
): Promise<GeneratedTask[]> {
  const ctMap = new Map(compositeTasks.map(c => [c.id, c]))
  const results: GeneratedTask[] = generatedTasks.map(gt => ({ ...gt }))

  // Build toolName → required param names from OpenAI tool definitions JSON (snake_case ground truth)
  const toolDefsMap = new Map<string, string[]>()
  if (toolDefinitions) {
    for (const td of toolDefinitions) {
      const fn = td.function
      if (fn?.name && fn.parameters?.required) {
        toolDefsMap.set(fn.name, fn.parameters.required)
      }
    }
  }
  const allIndices = results.map((_, i) => i)

  const systemPrompt = `You are generating expected tool call arguments for AI agent evaluation tasks.
For each task you will receive: the tool spec (tool name + required params) and the user's actual message.

Decision rules:
1. Read the user message carefully. If ALL required_param values are explicitly stated in the message → generate tool_calls with those exact values.
2. If ANY required_param value is missing, implied but not explicit, or ambiguous → set tool_calls: [] (the correct agent behavior is to ask for clarification).
3. Include ONLY required_param arguments — do NOT include optional params.
4. Argument names MUST exactly match the required_param names as given in the spec.
5. Use ONLY values explicitly present in the user message. Do NOT infer, calculate, or derive values (e.g. do not convert "tháng 7 năm 2024" into date ranges — that counts as missing).
6. Exception: date range params (from_date/to_date) MAY be derived only if the user message gives an unambiguous complete period (e.g. "từ 01/07/2024 đến 31/07/2024" → explicit; "tháng 7 năm 2024" → NOT explicit → tool_calls: []).
7. If the task spec says "partial" or "ambiguous" info completeness, lean toward tool_calls: [] unless ALL params are unmistakably explicit.

Output schema — return a JSON array, one object per task, in the same order:
[
  {
    "taskId": "...",
    "tool_calls": [
      { "name": "tool_name", "arguments": { "param": "value" } }
    ]
  }
]
tool_calls: [] means the agent should clarify, not call a tool.
No markdown fences. No preamble. Return only the JSON array.`

  const batchSize = 6

  for (let bi = 0; bi < allIndices.length; bi += batchSize) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const batchIndices = allIndices.slice(bi, bi + batchSize)
    const batchItems = batchIndices.map(idx => results[idx])

    const specsText = batchItems.map(gt => {
      const ct = ctMap.get(gt.compositeTaskId)
      const spec = ct ? buildToolCallSpec(ct, subtasks, toolDefsMap) : `Task ID: ${gt.compositeTaskId}`
      const infoHint = gt.infoCompleteness !== 'complete'
        ? `Info completeness: ${gt.infoCompleteness}${gt.edgeCaseType ? ` (${gt.edgeCaseType})` : ''}`
        : ''
      return `${spec}${infoHint ? '\n' + infoHint : ''}\nUser message: "${gt.userMessage}"`
    }).join('\n\n---\n\n')

    const userMsg = `Generate expected tool call arguments for the following ${batchItems.length} task(s). Return a JSON array with exactly ${batchItems.length} objects in the same order.\n\n${specsText}`

    const apiMessages: OpenAIMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMsg },
    ]

    type ArgResult = { taskId: string; tool_calls: Array<{ name: string; arguments: Record<string, unknown> }> }

    const raw = await withRetry(async () => {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      const res = await chatCompletion(
        { baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model, maxTokens: 2000, temperature: 0 },
        apiMessages,
        signal
      )
      return res.choices[0]?.message?.content || ''
    })

    let parsed: ArgResult[]
    try {
      parsed = await parseJsonWithRepair<ArgResult[]>(raw, config, signal)
    } catch (e) {
      console.warn('[generateExpectedToolCalls] Failed to parse batch response, skipping batch:', e)
      parsed = []
    }

    for (let j = 0; j < batchIndices.length; j++) {
      const idx = batchIndices[j]
      const r = parsed[j]
      if (!r) continue

      const toolCalls: import('@/types').ToolCall[] = (r.tool_calls || []).map(tc => ({
        type: 'function',
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments ?? {}),
        },
      }))
      results[idx].expectedToolCalls = toolCalls
    }

    onProgress?.(Math.min(bi + batchSize, allIndices.length), allIndices.length)
  }

  return results
}

// ── Stats computation ─────────────────────────────────────────────────

export function computeTaskSetStats(
  atomicSubtasks: AtomicSubtask[],
  compositeTasks: CompositeTask[],
  generatedTasks: GeneratedTask[]
): import('@/types').TaskSetStats {
  const byDifficulty: Record<string, number> = {}
  const byIntent: Record<string, number> = {}
  const byPersona: Record<string, number> = {}
  const byEdgeCase: Record<string, number> = {}

  const subtaskMap = new Map(atomicSubtasks.map(s => [s.id, s]))
  const allSkills = new Set(atomicSubtasks.map(s => s.skillRef))
  const allTools = new Set(atomicSubtasks.flatMap(s => s.expectedTools.map(t => t.toolName)))

  const coveredSkills = new Set<string>()
  const coveredTools = new Set<string>()

  for (const ct of compositeTasks) {
    byDifficulty[ct.difficulty] = (byDifficulty[ct.difficulty] || 0) + 1
    byPersona[ct.persona] = (byPersona[ct.persona] || 0) + 1
    if (ct.edgeCaseType) byEdgeCase[ct.edgeCaseType] = (byEdgeCase[ct.edgeCaseType] || 0) + 1

    for (const sid of ct.subtaskIds) {
      const s = subtaskMap.get(sid)
      if (s) {
        byIntent[s.intent] = (byIntent[s.intent] || 0) + 1
        coveredSkills.add(s.skillRef)
        s.expectedTools.forEach(t => coveredTools.add(t.toolName))
      }
    }
  }

  const avgSteps = compositeTasks.length > 0
    ? compositeTasks.reduce((s, t) => s + t.numSteps, 0) / compositeTasks.length
    : 0

  return {
    totalTasks: generatedTasks.length,
    byDifficulty,
    byIntent,
    byPersona,
    byEdgeCase,
    avgStepsPerTask: Math.round(avgSteps * 10) / 10,
    skillCoverage: allSkills.size > 0 ? coveredSkills.size / allSkills.size : 0,
    toolCoverage: allTools.size > 0 ? coveredTools.size / allTools.size : 0,
  }
}
