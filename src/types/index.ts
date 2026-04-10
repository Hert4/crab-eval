// ──────────────────────────────────────────────
// Dataset types
// ──────────────────────────────────────────────

export interface DataRecord {
  id: string
  input: string
  output: string
  reference: string
  context?: string | null
  system_prompt?: string | null   // per-record system prompt (tool-calling datasets)
  metadata?: Record<string, unknown>
  tool_calls?: ToolCall[]
  expected_tool_calls?: ToolCall[]
  conversation_history?: ConversationTurn[]
  tools?: unknown[]              // OpenAI tool definitions passed to model on every call
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
  customAttributes?: Record<string, string>
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
  metadata?: Record<string, unknown>
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
  // judge metadata — stored for reproducibility (who scored criteria_score)
  judgeModel?: string
  judgeBaseUrl?: string
  // extended info (not shown in leaderboard but stored)
  taskDetails?: Record<string, TaskRunResult>
}

// ──────────────────────────────────────────────
// Task Generator types
// ──────────────────────────────────────────────

export type TaskIntent =
  | 'information_retrieval'
  | 'analysis'
  | 'content_generation'
  | 'action'

export interface ExpectedToolCall {
  toolName: string
  requiredArgs: string[]
  optionalArgs: string[]
  order: number
}

export interface ParamSpec {
  name: string
  type: string
  description: string
  sampleValues: string[]
}

export interface AtomicSubtask {
  id: string
  name: string
  description: string
  intent: TaskIntent
  skillRef: string
  expectedTools: ExpectedToolCall[]
  requiredInputs: ParamSpec[]
  optionalInputs: ParamSpec[]
  assertionCriteria: string[]
  group: string
  dependsOn: string[]
}

export type UserPersona = 'expert' | 'novice' | 'out_of_scope'
export type InfoCompleteness = 'complete' | 'partial' | 'ambiguous'

export type EdgeCaseType =
  | 'entity_not_found'
  | 'ambiguous_entity'
  | 'missing_required_input'
  | 'malformed_input'
  | 'out_of_scope'
  | 'conflicting_request'
  | null

export interface CompositeTask {
  id: string
  name: string
  subtaskIds: string[]
  difficulty: 'easy' | 'medium' | 'hard' | 'expert'
  numSteps: number
  persona: UserPersona
  infoCompleteness: InfoCompleteness
  edgeCaseType: EdgeCaseType
  assertionCriteria: string[]
}

export interface GeneratedTask {
  id: string
  compositeTaskId: string
  userMessage: string
  userMessageAlt?: string
  persona: UserPersona
  infoCompleteness: InfoCompleteness
  difficulty: string
  expectedToolChain: string[]
  expectedToolCalls?: ToolCall[]        // binary scoring: [] = should clarify, [{...}] = expected calls
  assertionCriteria: string[]
  edgeCaseType: EdgeCaseType
  tags: string[]
}

export interface TaskSetStats {
  totalTasks: number
  byDifficulty: Record<string, number>
  byIntent: Record<string, number>
  byPersona: Record<string, number>
  byEdgeCase: Record<string, number>
  avgStepsPerTask: number
  skillCoverage: number
  toolCoverage: number
}

export interface TaskSet {
  id: string
  name: string
  createdAt: string
  sourceDocumentName: string
  detectedLanguage: string
  atomicSubtasks: AtomicSubtask[]
  compositeTasks: CompositeTask[]
  generatedTasks: GeneratedTask[]
  stats: TaskSetStats
  // task type detection
  detectedTaskType?: 'tool_calling' | 'rag_qa' | 'multi_turn' | 'instruction_following' | 'safety' | 'summarization'
  // QA/RAG mode
  qaPairs?: QAPair[]
  // Multi-turn mode
  multiTurnPairs?: MultiTurnPair[]
  // Instruction following mode
  instructionPairs?: InstructionPair[]
  // Safety / Guardrail mode
  safetyCases?: SafetyCase[]
  // Summarization mode
  summarizationPairs?: SummarizationPair[]
}

// ──────────────────────────────────────────────
// QA / RAG types
// ──────────────────────────────────────────────

export type QAIntent = 'factoid' | 'procedural' | 'definition' | 'comparison'

export interface QAPair {
  id: string
  question: string          // input gửi cho model
  reference: string         // ground-truth answer để so sánh
  context: string           // đoạn chunk chứa câu trả lời (inject vào system message)
  difficulty: 'easy' | 'medium' | 'hard'
  intent: QAIntent
  tags: string[]
}

// ──────────────────────────────────────────────
// Multi-turn Conversation types
// ──────────────────────────────────────────────

export type MultiTurnAspect = 'context_retention' | 'consistency' | 'update_tracking'

export interface MultiTurnPair {
  id: string
  conversation_history: ConversationTurn[]  // các turn trước (role + content)
  final_input: string                        // câu hỏi/yêu cầu cuối để test model
  reference: string                          // expected answer/behavior
  test_aspect: MultiTurnAspect
  difficulty: 'easy' | 'medium' | 'hard'
  tags: string[]
}

// ──────────────────────────────────────────────
// Instruction Following types
// ──────────────────────────────────────────────

export interface InstructionPair {
  id: string
  instruction: string        // prompt với ràng buộc (input gửi cho model)
  reference: string          // mô tả đầu ra đúng
  constraints: string[]      // danh sách ràng buộc cụ thể để judge check
  difficulty: 'easy' | 'medium' | 'hard'
  tags: string[]
}

// ──────────────────────────────────────────────
// Safety / Guardrail types
// ──────────────────────────────────────────────

export type AttackType = 'jailbreak' | 'prompt_injection' | 'pii_extraction' | 'out_of_scope' | 'normal'
export type ExpectedBehavior = 'refuse' | 'comply' | 'clarify'

export interface SafetyCase {
  id: string
  input: string                        // prompt (adversarial hoặc bình thường)
  attack_type: AttackType
  expected_behavior: ExpectedBehavior
  reference: string                    // mô tả hành vi đúng mong đợi
  difficulty: 'easy' | 'medium' | 'hard'
  tags: string[]
}

// ──────────────────────────────────────────────
// Summarization types
// ──────────────────────────────────────────────

export interface SummarizationPair {
  id: string
  source_text: string        // đoạn văn bản nguồn cần tóm tắt (sẽ là context)
  instruction: string        // yêu cầu tóm tắt có thể có ràng buộc (input)
  reference: string          // tóm tắt mẫu (ground truth)
  key_facts: string[]        // các sự kiện/thông tin quan trọng phải có trong tóm tắt
  max_words?: number         // ràng buộc độ dài nếu có
  difficulty: 'easy' | 'medium' | 'hard'
  tags: string[]
}

export interface ComposeOptions {
  maxSteps: number
  includeEdgeCases: boolean
  personas: UserPersona[]
  infoLevels: InfoCompleteness[]
  targetCount: number
  balanceBy: 'difficulty' | 'intent' | 'both'
}

export interface ModelConfig {
  baseUrl: string
  model: string
  apiKey: string
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
// Post-eval Analysis types (LangSmith-inspired)
// ──────────────────────────────────────────────

export interface MetricBreakdownBucket {
  label: string
  count: number
  avgScores: Record<string, number>
}

export interface TaskAnalysis {
  taskName: string
  taskType: string
  metrics: string[]
  totalLogs: number
  byDifficulty: MetricBreakdownBucket[]
  byIntent: MetricBreakdownBucket[]
  byTag: MetricBreakdownBucket[]
}

export interface RunAnalysis {
  runId: string
  model: string
  date: string
  tasks: TaskAnalysis[]
}
