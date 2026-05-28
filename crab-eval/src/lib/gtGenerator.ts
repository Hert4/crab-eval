import { Dataset, DataRecord } from '@/types'
import { chatCompletion, OpenAIConfig, getApiKey } from './openai'

export interface GTConfig {
  baseUrl: string
  model: string
  systemPromptTemplate: string
  delayMs: number
}

export interface GTProgress {
  index: number
  total: number
  recordId: string
  status: 'running' | 'done' | 'error'
  reference?: string
  error?: string
}

export type GTProgressCallback = (p: GTProgress) => void

export const DEFAULT_GT_PROMPT = `You are an expert AI evaluator. Given the context and user input below, provide the ideal reference answer.

{{#if context}}Context:
{{context}}

{{/if}}User Input:
{{input}}

Provide only the answer. Be concise and accurate. No explanation.`

function buildGTMessages(record: DataRecord, template: string) {
  const systemContent = template
    .replace('{{#if context}}\n', record.context ? '' : '\0START_REMOVE\0')
    .replace('\n{{/if}}\n', record.context ? '\n' : '\0END_REMOVE\0')
    .replace(/\0START_REMOVE\0[\s\S]*?\0END_REMOVE\0/g, '')
    .replace('{{context}}', record.context || '')
    .replace('{{input}}', record.input)

  return [{ role: 'user' as const, content: systemContent }]
}

export async function generateGT(
  dataset: Dataset,
  recordIds: string[],
  config: GTConfig,
  onProgress: GTProgressCallback,
  abortSignal: AbortSignal
): Promise<Map<string, string>> {
  const apiKey = getApiKey('gt_api_key')
  const openaiConfig: OpenAIConfig = {
    baseUrl: config.baseUrl,
    apiKey,
    model: config.model,
  }

  const results = new Map<string, string>()
  const records = dataset.data.filter(r => recordIds.includes(r.id))

  for (let i = 0; i < records.length; i++) {
    if (abortSignal.aborted) break

    const record = records[i]

    onProgress({
      index: i,
      total: records.length,
      recordId: record.id,
      status: 'running',
    })

    try {
      const messages = buildGTMessages(record, config.systemPromptTemplate)
      const res = await chatCompletion(openaiConfig, messages, abortSignal)
      const reference = res.choices[0]?.message?.content || ''
      results.set(record.id, reference)

      onProgress({
        index: i + 1,
        total: records.length,
        recordId: record.id,
        status: 'done',
        reference,
      })
    } catch (e) {
      onProgress({
        index: i + 1,
        total: records.length,
        recordId: record.id,
        status: 'error',
        error: String(e),
      })
    }

    // Rate limit delay
    if (i < records.length - 1 && config.delayMs > 0) {
      await new Promise(r => setTimeout(r, config.delayMs))
    }
  }

  return results
}
