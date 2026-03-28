import {
  SimulationTurn,
  ExpectedAction,
  ExpectedOutcome,
  ExpectedCommunication,
  TaskVerification,
} from '@/types'
import { chatCompletion, OpenAIConfig } from './openai'

// ── Helpers ─────────────────────────────────────────────────────────────────

function safeParseArgs(argsStr: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof argsStr !== 'string') return argsStr ?? {}
  try {
    return JSON.parse(argsStr)
  } catch {
    return {}
  }
}

/**
 * Extract meaningful words from text for fuzzy key-term matching.
 * Strips stop words (Vietnamese + English) and short words.
 */
function extractKeyTerms(text: string): string[] {
  const stopWords = new Set([
    // Vietnamese stop words
    'của', 'cho', 'với', 'và', 'hoặc', 'trong', 'là', 'có', 'được', 'các',
    'hãy', 'vui', 'lòng', 'mình', 'bạn', 'này', 'đang', 'đã', 'sẽ', 'một',
    'những', 'cần', 'tôi', 'theo', 'như', 'khi', 'rằng', 'lên', 'xuống',
    // English stop words
    'the', 'a', 'an', 'in', 'for', 'and', 'or', 'of', 'to', 'with',
    'from', 'by', 'at', 'on', 'is', 'are', 'was', 'be', 'do', 'has',
    'that', 'this', 'it', 'as', 'all', 'can', 'not', 'but', 'its',
    'get', 'set', 'use', 'new', 'via',
  ])
  return text.toLowerCase()
    .split(/[\s,.:;!?()\[\]"'/\\+]+/)
    .filter(w => w.length >= 3 && !stopWords.has(w))
}

/**
 * Type-aware argument comparison (Fix 1).
 *
 * Strategy:
 *  - ID-like args (contain digits+dashes, or argName contains "id"): strict numeric comparison
 *  - Name args (argName contains "name"): case-insensitive substring match either direction
 *  - Free-text args (Query, Description, etc.): 50% key-term overlap
 */
function matchArg(expectedValue: unknown, actualValue: unknown, argName: string): boolean {
  const expected = String(expectedValue ?? '').trim()
  const actual = String(actualValue ?? '').trim()

  // If expected is empty, any value is acceptable
  if (!expected) return true
  // If actual is empty but expected is not, no match
  if (!actual) return false

  const argLower = argName.toLowerCase()

  // ── ID-like args: strict numeric-portion comparison ─────────────────
  // Heuristic: structured IDs like CAND-2026-01021, REC-2026-031, pure numbers,
  // or arg name explicitly contains "id"
  const isIdLike = /^[A-Z]{2,}[-_]\d{2,}/.test(expected) ||  // PREFIX-digits pattern
                   /^\d+$/.test(expected) ||                    // pure numeric
                   argLower.includes('id') ||                   // arg name has "id"
                   argLower.includes('code') ||                 // arg name has "code"
                   argLower.includes('number')                  // arg name has "number"

  if (isIdLike) {
    // Extract numeric portions and compare — handles format variations
    const expectedNums = expected.replace(/\D/g, '')
    const actualNums = actual.replace(/\D/g, '')
    if (expectedNums.length >= 3 && actualNums.length >= 3) {
      return expectedNums === actualNums ||
             actualNums.includes(expectedNums) ||
             expectedNums.includes(actualNums)
    }
    // Fallback: case-insensitive exact match
    return expected.toLowerCase() === actual.toLowerCase()
  }

  // ── Name args: case-insensitive substring match either direction ────
  if (argLower.includes('name')) {
    const exp = expected.toLowerCase()
    const act = actual.toLowerCase()
    return act.includes(exp) || exp.includes(act)
  }

  // ── Free-text args (Query, Description, etc.): key-term overlap ─────
  // These are paraphrased differently by each model — require 50%+ term overlap
  const expectedTerms = extractKeyTerms(expected)
  const actualTerms = extractKeyTerms(actual)

  if (expectedTerms.length === 0) return true  // nothing meaningful to match

  const matchCount = expectedTerms.filter(et =>
    actualTerms.some(at => at.includes(et) || et.includes(at))
  ).length

  return matchCount / expectedTerms.length >= 0.5
}

// ── Action verifier ──────────────────────────────────────────────────────────

/**
 * Check if predicted tool calls match expected actions.
 * Logic follows τ-bench: for each expected action, scan all predicted calls for a match.
 * Match = same tool name + required args match (type-aware comparison via matchArg).
 */
export function verifyActions(
  turns: SimulationTurn[],
  expectedActions: ExpectedAction[]
): NonNullable<TaskVerification['actionResult']> {
  // Extract all tool calls from turns
  const predictedCalls = turns
    .filter(t => t.tool_calls && t.tool_calls.length > 0)
    .flatMap(t => t.tool_calls!.map(tc => ({
      name: tc.function.name,
      arguments: safeParseArgs(tc.function.arguments),
    })))

  const checks = expectedActions.map(expected => {
    if (expected.mustNotCall) {
      // Negative test: this tool must NOT have been called
      const wasCalled = predictedCalls.some(pc => pc.name === expected.toolName)
      return {
        actionId: expected.actionId,
        toolName: expected.toolName,
        matched: !wasCalled,
        reason: wasCalled ? 'Tool was called but should not have been' : 'Correctly not called',
      }
    }

    // Positive test: find a matching call
    const match = predictedCalls.find(pc => {
      if (pc.name !== expected.toolName) return false
      if (!expected.requiredArgs) return true  // tool name match is enough

      const keysToCheck = expected.compareArgs && expected.compareArgs.length > 0
        ? expected.compareArgs
        : Object.keys(expected.requiredArgs)

      // If compareArgs is explicitly empty, only check tool name
      if (expected.compareArgs && expected.compareArgs.length === 0) return true

      return keysToCheck.every(key => {
        const expectedVal = expected.requiredArgs![key]
        const actualVal = pc.arguments[key]
        if (expectedVal === undefined || expectedVal === null || expectedVal === '') return true
        return matchArg(expectedVal, actualVal, key)
      })
    })

    return {
      actionId: expected.actionId,
      toolName: expected.toolName,
      matched: !!match,
      reason: match
        ? `Matched call to ${expected.toolName}`
        : `No matching call for ${expected.toolName}` +
          (expected.compareArgs?.length
            ? ` (checking: ${expected.compareArgs.join(', ')})`
            : expected.requiredArgs ? ` with args ${JSON.stringify(expected.requiredArgs)}` : ''),
    }
  })

  const allMatched = checks.every(c => c.matched)
  return {
    expectedActions: expectedActions.length,
    matchedActions: checks.filter(c => c.matched).length,
    checks,
    reward: allMatched ? 1 : 0,  // Binary like τ-bench
  }
}

// ── Communication verifier ───────────────────────────────────────────────────

/**
 * Check if agent's response contains/doesn't contain expected terms.
 * Supports containsMode: 'all' (AND, default) | 'any' (OR, for synonym lists).
 */
export function verifyCommunication(
  turns: SimulationTurn[],
  expected: ExpectedCommunication
): NonNullable<TaskVerification['communicationResult']> {
  // Combine all assistant responses in this segment
  const assistantText = turns
    .filter(t => t.role === 'assistant')
    .map(t => t.content)
    .join(' ')

  const missingTerms: string[] = []
  const violatedTerms: string[] = []

  const mode = expected.containsMode ?? 'all'

  if (mode === 'any') {
    // OR logic: at least ONE term must appear (useful for synonym alternatives)
    const anyFound = expected.contains.some(term =>
      expected.isRegex
        ? new RegExp(term, 'i').test(assistantText)
        : assistantText.toLowerCase().includes(term.toLowerCase())
    )
    if (!anyFound && expected.contains.length > 0) {
      missingTerms.push(`(none of: ${expected.contains.join(' | ')})`)
    }
  } else {
    // AND logic (default): ALL terms must appear
    for (const term of expected.contains) {
      const found = expected.isRegex
        ? new RegExp(term, 'i').test(assistantText)
        : assistantText.toLowerCase().includes(term.toLowerCase())
      if (!found) missingTerms.push(term)
    }
  }

  // notContains always uses AND-NOT (every forbidden term must be absent)
  for (const term of expected.notContains ?? []) {
    const found = expected.isRegex
      ? new RegExp(term, 'i').test(assistantText)
      : assistantText.toLowerCase().includes(term.toLowerCase())
    if (found) violatedTerms.push(term)
  }

  return {
    allContained: missingTerms.length === 0,
    noneViolated: violatedTerms.length === 0,
    missingTerms,
    violatedTerms,
    reward: missingTerms.length === 0 && violatedTerms.length === 0 ? 1 : 0,
  }
}

// ── Behavior verifier ────────────────────────────────────────────────────────

/**
 * Check if agent exhibited the expected behavior type.
 */
export function verifyBehavior(
  turns: SimulationTurn[],
  expectedBehavior: ExpectedOutcome['expectedBehavior']
): boolean {
  const hasToolCalls = turns.some(t => t.tool_calls && t.tool_calls.length > 0)
  const assistantText = turns
    .filter(t => t.role === 'assistant')
    .map(t => t.content)
    .join(' ')
  const hasQuestion = assistantText.includes('?')

  switch (expectedBehavior) {
    case 'call_tool':
      return hasToolCalls
    case 'ask_clarification':
      return !hasToolCalls && hasQuestion
    case 'report_not_found':
      // Tool was called (returned empty); agent should communicate not found
      return hasToolCalls
    case 'refuse_invalid':
      return !hasToolCalls
    case 'respond_directly':
      return !hasToolCalls
    default:
      return true
  }
}

// ── Task verifier ────────────────────────────────────────────────────────────

/**
 * Verify a single task against its expected outcome.
 * Deterministic — no LLM calls (those are in verifyNLAssertions).
 */
export function verifyTask(
  taskTurns: SimulationTurn[],
  expected: ExpectedOutcome
): TaskVerification {
  const behaviorCorrect = verifyBehavior(taskTurns, expected.expectedBehavior)

  let actionResult: TaskVerification['actionResult']
  let communicationResult: TaskVerification['communicationResult']

  // Action check
  if (expected.actions && expected.actions.length > 0 && expected.rewardBasis.includes('action')) {
    actionResult = verifyActions(taskTurns, expected.actions)
  }

  // Communication check
  if (expected.communication && expected.rewardBasis.includes('communication')) {
    communicationResult = verifyCommunication(taskTurns, expected.communication)
  }

  // Final reward = product of applicable rewards (τ-bench style)
  const rewards: number[] = []
  if (actionResult) rewards.push(actionResult.reward)
  if (communicationResult) rewards.push(communicationResult.reward)
  // Behavior check always applies
  if (!behaviorCorrect) rewards.push(0)

  const finalReward = rewards.length > 0
    ? rewards.reduce((a, b) => a * b, 1)
    : (behaviorCorrect ? 1 : 0)

  return {
    taskIndex: expected.taskIndex,
    actionResult,
    communicationResult,
    finalReward,
    behaviorCorrect,
  }
}

// ── NL Assertion verifier (LLM, yes/no only) ─────────────────────────────────

/**
 * Verify NL assertions using LLM — binary yes/no per assertion, not scoring.
 * This is the only function here that calls LLM.
 */
export async function verifyNLAssertions(
  taskTurns: SimulationTurn[],
  assertions: string[],
  judgeCfg: OpenAIConfig,
  signal: AbortSignal
): Promise<NonNullable<TaskVerification['nlAssertionResult']>> {
  const transcript = taskTurns
    .map(t => {
      if (t.role === 'tool') return `[tool: ${t.tool_name ?? 'unknown'}]: ${t.content}`
      return `${t.role}: ${t.content}`
    })
    .join('\n')

  const prompt = `Given this conversation transcript, answer YES or NO for each assertion.

Transcript:
${transcript}

Assertions:
${assertions.map((a, i) => `${i + 1}. ${a}`).join('\n')}

Return ONLY a JSON array (no markdown, no explanation):
[{"index": 0, "passed": true, "reason": "brief explanation"}, ...]`

  try {
    const res = await chatCompletion(
      { ...judgeCfg, maxTokens: 1024, temperature: 0 },
      [{ role: 'user', content: prompt }],
      signal
    )
    const text = res.choices?.[0]?.message?.content ?? '[]'
    const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const results = JSON.parse(stripped) as Array<{ index: number; passed: boolean; reason: string }>

    const checks = assertions.map((assertion, i) => {
      const r = results.find(x => x.index === i)
      return {
        assertion,
        passed: r?.passed ?? false,
        reason: r?.reason ?? 'No response',
      }
    })

    return {
      assertions: checks,
      reward: checks.every(c => c.passed) ? 1 : 0,
    }
  } catch {
    return {
      assertions: assertions.map(a => ({ assertion: a, passed: false, reason: 'Judge error' })),
      reward: 0,
    }
  }
}

// ── Verification note builder ────────────────────────────────────────────────

/**
 * Build a human-readable note summarizing the verification result.
 */
export function buildVerificationNote(v: TaskVerification): string {
  const parts: string[] = []

  if (!v.behaviorCorrect) {
    parts.push('Wrong behavior type')
  }

  if (v.actionResult) {
    parts.push(`Actions: ${v.actionResult.matchedActions}/${v.actionResult.expectedActions}`)
    const failed = v.actionResult.checks.filter(c => !c.matched)
    if (failed.length > 0) {
      parts.push(`Missing: ${failed.map(c => c.toolName).join(', ')}`)
    }
  }

  if (v.communicationResult) {
    if (v.communicationResult.missingTerms.length > 0) {
      parts.push(`Missing phrases: ${v.communicationResult.missingTerms.slice(0, 3).join(', ')}`)
    }
    if (v.communicationResult.violatedTerms.length > 0) {
      parts.push(`Forbidden phrases found: ${v.communicationResult.violatedTerms.slice(0, 2).join(', ')}`)
    }
  }

  if (v.nlAssertionResult) {
    const failed = v.nlAssertionResult.assertions.filter(a => !a.passed)
    if (failed.length > 0) {
      parts.push(`NL failed: ${failed.map(f => f.assertion).join('; ')}`)
    }
  }

  return parts.join(' | ') || (v.finalReward === 1 ? 'All checks passed' : 'Failed')
}
