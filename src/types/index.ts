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
}
