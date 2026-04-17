// OpenAI-compatible API wrapper

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCallResult[]
  tool_call_id?: string   // required when role = 'tool'
  name?: string           // optional tool name hint
}

export interface ToolCallResult {
  id: string              // always present — needed to match tool response
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface OpenAITool {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
  }
}

export interface OpenAIConfig {
  baseUrl: string
  apiKey: string
  model: string
  maxTokens?: number
  temperature?: number
}

export interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string | null
      tool_calls?: ToolCallResult[]
    }
    finish_reason?: string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export async function chatCompletion(
  config: OpenAIConfig,
  messages: OpenAIMessage[],
  signal?: AbortSignal,
  tools?: OpenAITool[]
): Promise<OpenAIResponse> {
  const url = config.baseUrl.replace(/\/$/, '') + '/chat/completions'

  // Models like gpt-5.x, o1, o3 use max_completion_tokens; legacy use max_tokens.
  // We detect by checking if model name suggests a "reasoning" / new-gen model,
  // AND auto-retry with the other param if the API rejects with unsupported_parameter.
  const prefersCompletionTokens = /^(o1|o3|o4|gpt-5|computer-use)/i.test(config.model)

  const buildBody = (useCompletionTokens: boolean): Record<string, unknown> => {
    const b: Record<string, unknown> = { model: config.model, messages }
    if (config.maxTokens) {
      b[useCompletionTokens ? 'max_completion_tokens' : 'max_tokens'] = config.maxTokens
    }
    // o1/o3/o4 don't support temperature (fixed at 1)
    if (config.temperature !== undefined && !useCompletionTokens) {
      b.temperature = config.temperature
    }
    if (tools?.length) { b.tools = tools; b.tool_choice = 'auto' }
    // Disable thinking mode for Qwen3-style models that return content=null with reasoning field
    b.chat_template_kwargs = { enable_thinking: false }
    return b
  }

  const doFetch = async (body: Record<string, unknown>) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(body),
      signal,
    })
    return r
  }

  let res = await doFetch(buildBody(prefersCompletionTokens))

  // Auto-retry with the opposite token param if rejected for unsupported_parameter
  if (res.status === 400) {
    const clone = res.clone()
    try {
      const errJson = await clone.json()
      const msg: string = errJson?.details?.error?.message || errJson?.error?.message || ''
      if (msg.includes('max_tokens') || msg.includes('max_completion_tokens') || msg.includes('unsupported_parameter')) {
        res = await doFetch(buildBody(!prefersCompletionTokens))
      }
    } catch { /* not JSON, fall through to normal error handling */ }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`API error ${res.status}: ${text}`)
  }

  const json = await res.json()

  // Validate response shape — some APIs return {error:...} with 200 status
  if (!json || !Array.isArray(json.choices) || json.choices.length === 0) {
    const detail = json?.error?.message || json?.message || JSON.stringify(json).slice(0, 200)
    throw new Error(`Invalid API response (no choices): ${detail}`)
  }

  // Qwen3 thinking mode fallback: content=null but response is in reasoning field
  for (const choice of json.choices ?? []) {
    if (choice.message?.content === null && (choice.message as Record<string, unknown>).reasoning) {
      choice.message.content = (choice.message as Record<string, unknown>).reasoning as string
    }
  }

  return json as OpenAIResponse
}

export async function testConnection(config: OpenAIConfig): Promise<boolean> {
  try {
    const url = config.baseUrl.replace(/\/$/, '') + '/models'
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(8000),
    })
    return res.ok
  } catch {
    return false
  }
}

// Local-storage helpers for API keys (persisted across sessions)
export function getApiKey(key: string): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem(key) || ''
}

export function setApiKey(key: string, value: string) {
  if (typeof window === 'undefined') return
  localStorage.setItem(key, value)
}

// ── File-aware message builder ────────────────────────────────────────
// Determines the best way to send a file to the model:
//   1. Plain text extensions → return text content directly
//   2. Image extensions      → base64 inline vision content block
//   3. PDF / DOCX            → try OpenAI Files API (upload → file_id reference)
//                              fallback: return null (caller must parse text instead)

const TEXT_EXTS = ['.txt', '.md', '.markdown', '.csv', '.json']
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif']
const FILE_API_EXTS = ['.pdf', '.docx']

function getExt(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot).toLowerCase() : ''
}

function imageMediaType(ext: string): string {
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  }
  return map[ext] || 'image/png'
}

export type FileMessageContent =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { file_id: string } }

/**
 * Upload a file to OpenAI Files API and return the file_id.
 * Returns null if the API is unavailable or returns an error.
 */
async function uploadFileToOpenAI(
  file: File,
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<string | null> {
  try {
    const url = baseUrl.replace(/\/$/, '') + '/files'
    const form = new FormData()
    form.append('file', file, file.name)
    form.append('purpose', 'assistants')

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal,
    })
    if (!res.ok) return null
    const json = await res.json()
    return (json as { id?: string }).id ?? null
  } catch {
    return null
  }
}

/**
 * Build the content block(s) for a file to be sent to the model.
 * Returns an array of content blocks, or null if the file should be
 * handled by falling back to server-side text extraction.
 *
 * Caller adds a text instruction block before/after as needed.
 */
export async function buildFileMessageContent(
  file: File,
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<FileMessageContent[] | null> {
  const ext = getExt(file.name)

  // Plain text — read as text, return as text block
  if (TEXT_EXTS.includes(ext)) {
    const text = await file.text()
    return [{ type: 'text', text }]
  }

  // Images — base64 inline vision
  if (IMAGE_EXTS.includes(ext)) {
    const buf = await file.arrayBuffer()
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)))
    const mime = imageMediaType(ext)
    return [{
      type: 'image_url',
      image_url: { url: `data:${mime};base64,${b64}` },
    }]
  }

  // PDF / DOCX — try Files API first
  if (FILE_API_EXTS.includes(ext)) {
    const fileId = await uploadFileToOpenAI(file, baseUrl, apiKey, signal)
    if (fileId) {
      return [{ type: 'file', file: { file_id: fileId } }]
    }
    // Files API not supported by this endpoint — signal caller to fall back
    return null
  }

  return null
}
