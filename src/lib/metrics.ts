// Client-side metric computation (no external libraries)

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').trim()
}

function tokenize(s: string): string[] {
  return normalize(s).split(/\s+/).filter(Boolean)
}

// ─── Exact Match ───────────────────────────────
export function exactMatch(output: string, reference: string): number {
  if (!reference) return 0
  return normalize(output) === normalize(reference) ? 100 : 0
}

// ─── Accuracy (same as exact match for classification) ────
export function accuracy(output: string, reference: string): number {
  if (!reference) return 0
  return normalize(output.trim()) === normalize(reference.trim()) ? 100 : 0
}

// ─── Token F1 (unigram overlap) ─────────────────
export function tokenF1(output: string, reference: string): number {
  const o = tokenize(output)
  const r = tokenize(reference)
  if (!o.length || !r.length) return 0

  const oMap: Record<string, number> = {}
  const rMap: Record<string, number> = {}
  o.forEach(t => { oMap[t] = (oMap[t] || 0) + 1 })
  r.forEach(t => { rMap[t] = (rMap[t] || 0) + 1 })

  let common = 0
  Object.keys(oMap).forEach(t => {
    if (rMap[t]) common += Math.min(oMap[t], rMap[t])
  })

  const precision = common / o.length
  const recall = common / r.length
  if (precision + recall === 0) return 0
  return (2 * precision * recall) / (precision + recall) * 100
}

// ─── BLEU-1 (unigram with brevity penalty) ──────
export function bleu1(output: string, reference: string): number {
  const o = tokenize(output)
  const r = tokenize(reference)
  if (!o.length) return 0

  const rMap: Record<string, number> = {}
  r.forEach(t => { rMap[t] = (rMap[t] || 0) + 1 })

  let match = 0
  const used: Record<string, number> = {}
  o.forEach(t => {
    if ((rMap[t] || 0) > (used[t] || 0)) {
      match++
      used[t] = (used[t] || 0) + 1
    }
  })

  const bp = o.length >= r.length ? 1 : Math.exp(1 - r.length / o.length)
  return bp * (match / o.length) * 100
}

// ─── ROUGE-L (LCS-based) ────────────────────────
export function rougeL(output: string, reference: string): number {
  const o = tokenize(output)
  const r = tokenize(reference)
  if (!o.length || !r.length) return 0

  // LCS DP
  const dp: number[][] = Array(o.length + 1)
    .fill(0)
    .map(() => Array(r.length + 1).fill(0))

  for (let i = 1; i <= o.length; i++) {
    for (let j = 1; j <= r.length; j++) {
      dp[i][j] = o[i - 1] === r[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  const lcs = dp[o.length][r.length]
  const precision = lcs / o.length
  const recall = lcs / r.length
  if (precision + recall === 0) return 0
  return (2 * precision * recall) / (precision + recall) * 100
}

// ─── AST Accuracy (tool calling) ────────────────
export function astAccuracy(
  toolCalls: Array<{ function?: { name: string; arguments: string } }> | null | undefined,
  expectedToolCalls: Array<{ function?: { name: string; arguments: string } }> | null | undefined
): number {
  if (!expectedToolCalls?.length) return 0
  if (!toolCalls?.length) return 0

  const exp = expectedToolCalls[0]?.function
  const got = toolCalls[0]?.function
  if (!exp || !got) return 0

  const nameMatch = got.name === exp.name ? 1 : 0

  let argsScore = 0
  try {
    const expArgs = JSON.parse(exp.arguments || '{}')
    const gotArgs = JSON.parse(got.arguments || '{}')
    const expKeys = Object.keys(expArgs)
    if (!expKeys.length) {
      argsScore = 1
    } else {
      const matched = expKeys.filter(k => k in gotArgs).length
      argsScore = matched / expKeys.length
    }
  } catch {
    argsScore = 0
  }

  return (nameMatch * 0.6 + argsScore * 0.4) * 100
}

// ─── Task success rate (for tool calling) ───────
export function taskSuccessRate(
  toolCalls: Array<{ function?: { name: string; arguments: string } }> | null | undefined,
  expectedToolCalls: Array<{ function?: { name: string; arguments: string } }> | null | undefined
): number {
  if (!expectedToolCalls?.length) return 0
  if (!toolCalls?.length) return 0
  const exp = expectedToolCalls[0]?.function
  const got = toolCalls[0]?.function
  if (!exp || !got) return 0
  return got.name === exp.name ? 100 : 0
}

// ─── Tool Call Exact (binary, 0 or 100) ─────────────
// PASS (100): agent's tool calls exactly match expected (name + required param keys)
// FAIL (0): any mismatch, or wrong number of calls
//
// Special case: expectedToolCalls === [] means the agent should clarify (not call tools).
//   - toolCalls === []  → PASS (agent correctly did not call a tool)
//   - toolCalls has items → FAIL (agent called tool when it should have asked)
export function toolCallExact(
  toolCalls: Array<{ function?: { name: string; arguments: string } }> | null | undefined,
  expectedToolCalls: Array<{ function?: { name: string; arguments: string } }> | null | undefined
): number {
  // If expectedToolCalls is undefined/null → metric not applicable, skip (return 0)
  if (expectedToolCalls === undefined || expectedToolCalls === null) return 0

  const gotCalls = toolCalls ?? []

  // Case: partial task — agent should clarify, not call any tool
  if (expectedToolCalls.length === 0) {
    return gotCalls.length === 0 ? 100 : 0
  }

  // Case: agent should have called tool(s) but didn't
  if (gotCalls.length === 0) return 0

  // Compare each expected call in order
  if (gotCalls.length !== expectedToolCalls.length) return 0

  for (let i = 0; i < expectedToolCalls.length; i++) {
    const exp = expectedToolCalls[i]?.function
    const got = gotCalls[i]?.function
    if (!exp || !got) return 0

    // Tool name must match exactly
    if (got.name !== exp.name) return 0

    // All required param keys must be present in got arguments
    // Key comparison is case-insensitive to avoid penalizing models that use
    // different casing conventions (e.g. CandidateID vs candidateId vs candidate_id)
    try {
      const expArgs = JSON.parse(exp.arguments || '{}')
      const gotArgs = JSON.parse(got.arguments || '{}')
      const expKeys = Object.keys(expArgs)
      const gotKeysLower = new Set(Object.keys(gotArgs).map(k => k.toLowerCase()))
      // Every expected key must appear in the actual call (case-insensitive)
      const allKeysPresent = expKeys.every(k => gotKeysLower.has(k.toLowerCase()))
      if (!allKeysPresent) return 0
    } catch {
      return 0
    }
  }

  return 100
}

// ─── Criteria Score (LLM-as-judge, handled by evalRunner) ───────────
// Placeholder so the metric name is recognized by the dispatcher.
// Actual scoring is done in evalRunner.ts when judge is enabled.
// The reference field holds newline-separated assertion criteria.
// Score = (criteria passed / total criteria) * 100
export function criteriaScore(): number {
  return 0  // computed by LLM judge in evalRunner, not here
}

// ─── Dispatcher ─────────────────────────────────
export interface DataRecordForMetrics {
  output: string
  reference: string
  tool_calls?: Array<{ function?: { name: string; arguments: string } }>
  expected_tool_calls?: Array<{ function?: { name: string; arguments: string } }>
}

export function computeMetrics(
  record: DataRecordForMetrics,
  newOutput: string,
  metricNames: string[]
): Record<string, number> {
  const scores: Record<string, number> = {}
  const ref = record.reference || ''

  for (const metric of metricNames) {
    switch (metric) {
      case 'exact_match':
        scores[metric] = exactMatch(newOutput, ref)
        break
      case 'accuracy':
        scores[metric] = accuracy(newOutput, ref)
        break
      case 'token_f1':
        scores[metric] = tokenF1(newOutput, ref)
        break
      case 'bleu':
      case 'bleu1':
        scores[metric] = bleu1(newOutput, ref)
        break
      case 'rouge':
      case 'rouge_l':
        scores[metric] = rougeL(newOutput, ref)
        break
      case 'ast_accuracy':
        scores[metric] = astAccuracy(record.tool_calls, record.expected_tool_calls)
        break
      case 'task_success_rate':
        scores[metric] = taskSuccessRate(record.tool_calls, record.expected_tool_calls)
        break
      case 'tool_call_exact':
        scores[metric] = toolCallExact(record.tool_calls, record.expected_tool_calls)
        break
      // faithfulness & answer_relevancy are LLM-as-judge — handled by evalRunner
      case 'faithfulness':
      case 'answer_relevancy':
      // criteria_score is LLM-as-judge — handled by evalRunner
      case 'criteria_score':
        break
      default:
        // Fallback: token_f1
        scores[metric] = tokenF1(newOutput, ref)
    }
  }

  return scores
}

// ─── Average metrics ─────────────────────────────
export function avgScores(records: Record<string, number>[]): Record<string, number> {
  if (!records.length) return {}
  const totals: Record<string, number> = {}
  const counts: Record<string, number> = {}
  for (const rec of records) {
    for (const [k, v] of Object.entries(rec)) {
      totals[k] = (totals[k] || 0) + v
      counts[k] = (counts[k] || 0) + 1
    }
  }
  const result: Record<string, number> = {}
  for (const k of Object.keys(totals)) {
    result[k] = parseFloat((totals[k] / counts[k]).toFixed(2))
  }
  return result
}
