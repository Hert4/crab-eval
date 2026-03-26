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

// Session-storage helpers for API keys (not persisted to localStorage)
export function getApiKey(key: string): string {
  if (typeof window === 'undefined') return ''
  return sessionStorage.getItem(key) || ''
}

export function setApiKey(key: string, value: string) {
  if (typeof window === 'undefined') return
  sessionStorage.setItem(key, value)
}
