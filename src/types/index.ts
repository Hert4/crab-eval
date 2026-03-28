// ──────────────────────────────────────────────
// Dataset types
// ──────────────────────────────────────────────

export interface DataRecord {
  id: string
  input: string
  output: string
  reference: string
  context?: string | null
  metadata?: Record<string, unknown>
  tool_calls?: ToolCall[]
  expected_tool_calls?: ToolCall[]
  conversation_history?: ConversationTurn[]
}

export interface ToolCall {
  type?: string
  function?: {
    name: string
    arguments: string
  }
}

export interface ConversationTurn {
  role?: string
  content?: string
  user?: string
  bot?: string
}

export interface DatasetMetadata {
  task_name: string
  task_type: string
  description?: string
  gt_metrics?: string[]
  gt_model?: string
  gt_generated_date?: string
  created_date?: string
  sampled_records?: number
  samples_with_reference?: number
  [key: string]: unknown
}

export interface Dataset {
  id: string            // generated uuid on upload
  filename: string
  uploadedAt: string
  metadata: DatasetMetadata
  data: DataRecord[]
}

// ──────────────────────────────────────────────
// Config types
// ──────────────────────────────────────────────

export interface TargetConfig {
  baseUrl: string
  model: string
  maxTokens: number
  temperature: number
  systemPrompt: string  // override; if empty uses record.context
}

export interface JudgeConfig {
  baseUrl: string
  model: string
  enabled: boolean
}

// ──────────────────────────────────────────────
// Eval run / results types
// ──────────────────────────────────────────────

export type RecordStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped'

export interface RecordLog {
  id: string
  status: RecordStatus
  input: string
  reference: string
  output: string
  tool_calls?: Array<{ type: string; function: { name: string; arguments: string } }>
  scores: Record<string, number>
  error?: string
  durationMs?: number
}

export interface TaskRunResult {
  taskName: string
  taskType: string
  description: string
  numSamples: number
  metrics: string[]
  scores: Record<string, number>   // metric → score_pct (0-100)
  logs: RecordLog[]
}

export interface RunResult {
  runId: string
  model: string
  baseUrl: string
  date: string
  durationMs: number
  tasks: Record<string, Record<string, number>>  // taskName → metric → score_pct
  // extended info (not shown in leaderboard but stored)
  taskDetails?: Record<string, TaskRunResult>
}

// ──────────────────────────────────────────────
// Leaderboard types (mirrors leaderboard.html)
// ──────────────────────────────────────────────

export interface TaskGroup {
  id: string
  label: string
  tasks: string[]
}

export interface LeaderboardEntry {
  runId: string
  model: string
  date: string
  tasks: Record<string, Record<string, number>>
}

// ──────────────────────────────────────────────
// Visual Eval (Simulation) types
// ──────────────────────────────────────────────

// Result for a single task evaluated by the holistic judge
export interface ToolTraceSummary {
  totalToolCalls: number
  validToolCalls: number
  invalidToolCalls: number
  unknownTools: number
  malformedArguments: number
  missingRequiredArguments: number
}

export interface TaskScoreBreakdown {
  completion: number
  grounding: number
  clarification: number | null
  toolUse: number | null
  toolTrace: number | null
}

export interface TaskResult {
  task: string          // original task description
  status: 'completed' | 'wrong' | 'incomplete' | 'skipped'
  score: number         // 0–100 for this task
  note: string          // 1-2 sentence explanation
  durationMs?: number   // wall-clock time from task start to completion (optional)
  breakdown?: TaskScoreBreakdown
  toolTrace?: ToolTraceSummary
  threeAxisScore?: ThreeAxisScore  // 3-axis breakdown (Milestone 2)
  verification?: TaskVerification  // τ-bench programmatic verification result
}

export interface SimulationEvaluationDebug {
  evaluator: string
  rawJudgeResponse?: string
  parseError?: string
  unavailableReason?: string
}

export interface SimulationTurn {
  turnIndex: number
  role: 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: Array<{ type: string; function: { name: string; arguments: string } }>
  tool_name?: string     // when role = 'tool'
  durationMs?: number
}

export interface SimulationResult {
  simId: string
  scenarioName: string
  targetModel: string
  userModel: string
  date: string
  durationMs: number
  turns: SimulationTurn[]
  finalScore: number | null    // 0-100, weighted avg of task scores; null when evaluation unavailable
  finalAssessment: string
  taskResults?: TaskResult[]   // per-task breakdown from holistic judge
  evaluationStatus?: 'scored' | 'unavailable'
  evaluationDebug?: SimulationEvaluationDebug
  status: 'completed' | 'stopped' | 'error'
  // ── Reproducibility metadata ──────────────────────────────────────
  judgeModel?: string          // model name used as evaluator/judge
  judgeBaseUrl?: string        // baseUrl of judge model
  oracleModel?: string         // model name used as oracle (tool faker)
  oracleBaseUrl?: string       // baseUrl of oracle model
  replayScript?: string[]      // fixed user messages used in this run (if replay mode)
  toolsUsed?: Array<{ name: string; description?: string }>  // tools available to target model
  worldState?: string          // pre-generated fixed mock database shared across all batch models
  // ── Evaluation pipeline v2 metadata ──────────────────────────────
  judgePromptHash?: string     // simpleHash of judge prompt text (for reproducibility)
  oracleDatasetId?: string     // FrozenOracleDataset.datasetId used in this run
  toolDefinitions?: ToolDefinition[]  // snapshot of tools used
  evaluationVersion?: string   // version of scoring pipeline e.g. "1.0.0"
  // ── Multi-judge metadata (Milestone 2) ───────────────────────────
  multiJudgeResult?: MultiJudgeResult
  threeAxisScore?: ThreeAxisScore
  complianceResult?: ComplianceResult
  judgeAgreement?: number      // shortcut: multiJudgeResult.agreementRate
  // ── Multi-run statistics (Milestone 3) ───────────────────────────
  runIndex?: number            // 0-based index within multi-run batch
  totalRuns?: number           // total runs requested for this model
  // ── τ-bench programmatic scoring ─────────────────────────────────
  taskSetId?: string           // FrozenTaskSet used (if any)
  programmaticScore?: number   // 0-100, from programmatic verifier
  qualityScore?: number        // 0-100, from LLM judge
  scoringMode?: 'hybrid' | 'programmatic' | 'judge_only'  // which scoring path was used
}

// ──────────────────────────────────────────────
// Frozen Oracle Dataset types (Milestone 1)
// ──────────────────────────────────────────────

export interface FrozenToolResponse {
  cacheKey: string       // output of getToolCallCacheKey(name, args)
  toolName: string
  response: string       // oracle JSON string response
  generatedAt: string    // ISO timestamp
  oracleModel: string
  schemaValid: boolean
}

export interface FrozenOracleDataset {
  datasetId: string      // simpleHash of all cacheKeys joined
  scenarioName: string
  createdAt: string
  oracleModel: string
  oracleBaseUrl: string
  replayScript: string[]
  entries: FrozenToolResponse[]
  version: string        // "1.0"
}

export interface ToolDefinition {
  name: string
  description: string
  parametersSchema: Record<string, unknown>
}

// ──────────────────────────────────────────────
// Multi-Judge + Scoring types (Milestone 2)
// ──────────────────────────────────────────────

export interface MultiJudgeConfig {
  baseUrl: string
  model: string
  apiKeyName: string   // sessionStorage key for this judge's API key
  weight?: number      // default 1.0
}

export interface JudgeVerdict {
  model: string
  baseUrl: string
  finalScore: number | null
  taskResults?: TaskResult[]
  assessment: string
  error?: string
  durationMs: number
}

export interface MultiJudgeResult {
  verdicts: JudgeVerdict[]
  consensusScore: number | null   // weighted median of successful verdicts
  consensusAssessment: string
  agreementRate: number           // 0-1, fraction of pairs agreeing within 15 pts
  judgeCount: number
  successCount: number
}

export interface ThreeAxisScore {
  taskCompletion: number    // 0-100, programmatic (tool trace based)
  qualityScore: number      // 0-100, LLM judge semantic quality
  complianceScore: number   // 0-100, rule-based compliance
  combined: number          // weighted: 50% + 35% + 15%
}

export interface ComplianceRule {
  id: string
  description: string
  check: 'id_format' | 'must_clarify' | 'no_hallucination' | 'custom_regex'
  pattern?: string    // regex string
  fieldPath?: string  // dot-path into tool args JSON
  weight: number      // 0-1
}

export interface ComplianceResult {
  score: number         // 0-100
  passedRules: string[] // rule IDs
  failedRules: string[]
}

// ──────────────────────────────────────────────
// τ-bench Style Expected Outcomes
// ──────────────────────────────────────────────

/** Expected tool call for a task — what tool should be called with what args */
export interface ExpectedAction {
  actionId: string                          // unique within task, e.g. "t1_action_0"
  toolName: string                          // expected tool name
  requiredArgs?: Record<string, unknown>    // args that MUST match (subset check, not exact)
  compareArgs?: string[]                    // only check these arg keys (like τ-bench compare_args)
  mustNotCall?: boolean                     // if true, this tool must NOT be called (negative test)
}

/** Expected info the agent should communicate to user */
export interface ExpectedCommunication {
  id: string
  contains: string[]        // response must contain ALL of these strings/patterns
  notContains?: string[]    // response must NOT contain any of these
  isRegex?: boolean         // treat contains/notContains as regex patterns
}

/** Expected behavior classification */
export type ExpectedBehavior =
  | 'call_tool'           // agent should call a specific tool
  | 'ask_clarification'   // agent should ask user for more info (not call tool)
  | 'report_not_found'    // agent should report empty/not found after tool returns empty
  | 'refuse_invalid'      // agent should refuse due to invalid input
  | 'respond_directly'    // agent should answer without tools

/** Complete expected outcome for one task */
export interface ExpectedOutcome {
  taskIndex: number
  userMessage: string                   // the replay script message
  expectedBehavior: ExpectedBehavior
  actions?: ExpectedAction[]            // expected tool calls (when behavior = 'call_tool')
  communication?: ExpectedCommunication // what agent should say
  nlAssertions?: string[]               // free-text assertions for LLM judge (yes/no)
  rewardBasis: ('action' | 'communication' | 'nl_assertion')[]  // which checks count
}

/** Frozen task set = replay script + expected outcomes */
export interface FrozenTaskSet {
  taskSetId: string
  scenarioName: string
  createdAt: string
  generatedBy: string       // model that generated this
  tasks: ExpectedOutcome[]
  version: string           // "1.0"
}

/** Programmatic verification result for one task */
export interface TaskVerification {
  taskIndex: number
  // Action check
  actionResult?: {
    expectedActions: number
    matchedActions: number
    checks: Array<{
      actionId: string
      toolName: string
      matched: boolean
      reason?: string
    }>
    reward: number          // 0 or 1 (binary like τ-bench)
  }
  // Communication check
  communicationResult?: {
    allContained: boolean
    noneViolated: boolean
    missingTerms: string[]
    violatedTerms: string[]
    reward: number          // 0 or 1
  }
  // NL assertion check (LLM judged, but yes/no only)
  nlAssertionResult?: {
    assertions: Array<{ assertion: string; passed: boolean; reason: string }>
    reward: number          // 0 or 1 (all must pass)
  }
  // Combined
  finalReward: number       // product of applicable rewards (τ-bench style)
  behaviorCorrect: boolean  // did model exhibit expectedBehavior?
}
