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

// ── Action verifier ──────────────────────────────────────────────────────────

/**
 * Check if predicted tool calls match expected actions.
 * Logic follows τ-bench: for each expected action, scan all predicted calls for a match.
 * Match = same tool name + required args match (subset check or compareArgs check).
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
      if (!expected.requiredArgs) return true

      const keysToCheck = expected.compareArgs ?? Object.keys(expected.requiredArgs)
      return keysToCheck.every(key => {
        const expectedVal = String(expected.requiredArgs![key] ?? '').toLowerCase().trim()
        const actualVal = String(pc.arguments[key] ?? '').toLowerCase().trim()
        if (!expectedVal) return true // no expected value — name match is enough
        // Flexible match: contains or equals
        return actualVal.includes(expectedVal) || expectedVal.includes(actualVal)
      })
    })

    return {
      actionId: expected.actionId,
      toolName: expected.toolName,
      matched: !!match,
      reason: match
        ? `Matched call to ${expected.toolName}`
        : `No matching call for ${expected.toolName}` +
          (expected.requiredArgs ? ` with args ${JSON.stringify(expected.requiredArgs)}` : ''),
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

  for (const term of expected.contains) {
    const match = expected.isRegex
      ? new RegExp(term, 'i').test(assistantText)
      : assistantText.toLowerCase().includes(term.toLowerCase())
    if (!match) missingTerms.push(term)
  }

  for (const term of expected.notContains ?? []) {
    const match = expected.isRegex
      ? new RegExp(term, 'i').test(assistantText)
      : assistantText.toLowerCase().includes(term.toLowerCase())
    if (match) violatedTerms.push(term)
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
      // Tool was called (returned empty), agent should communicate not found
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
 * Returns deterministic TaskVerification (no LLM calls — those are in verifyNLAssertions).
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

  // Compute final reward = product of applicable rewards (τ-bench style)
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
 * Verify NL assertions using LLM — but only yes/no, not scoring.
 * This is the only part that uses LLM. Returns binary per assertion.
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
