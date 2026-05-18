// Verify the multi-turn tool_call_id fix: build a synthetic conversation with
// two assistant turns each making tool calls, then assert that the resulting
// messages array has globally unique tool_call_id values that match the
// corresponding assistant message's tool_calls[].id.
//
// Mirrors the logic in src/lib/evalRunner.ts buildMessages(). If you change
// that function, also change the copy here (or export it from evalRunner.ts
// and import here).

type ToolCall = { type?: string; function?: { name: string; arguments: string } }
type Turn = {
  role?: string
  content?: string
  user?: string
  bot?: string
  tool_calls?: ToolCall[]
  expected_tool_calls?: ToolCall[]
}
type Message = {
  role: string
  content?: string | null
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>
  tool_call_id?: string
}

function buildMessages(history: Turn[], systemPrompt: string, finalInput: string): Message[] {
  const messages: Message[] = []
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })

  for (let turnIdx = 0; turnIdx < history.length; turnIdx++) {
    const turn = history[turnIdx]
    if (turn.role === 'assistant' && turn.tool_calls?.length) {
      messages.push({
        role: 'assistant',
        content: turn.content || null,
        tool_calls: turn.tool_calls.map((tc, idx) => ({
          id: `call_${turnIdx}_${idx}`,
          type: 'function',
          function: { name: tc.function?.name ?? '', arguments: tc.function?.arguments ?? '{}' },
        })),
      })
      for (let i = 0; i < turn.tool_calls.length; i++) {
        messages.push({
          role: 'tool',
          tool_call_id: `call_${turnIdx}_${i}`,
          content: '{}',
        })
      }
    } else if (turn.role && turn.content) {
      messages.push({ role: turn.role, content: turn.content })
    }
  }

  messages.push({ role: 'user', content: finalInput })
  return messages
}

// ── Test fixture ──────────────────────────────────────────────────────
// Realistic multi-turn tool conversation: 2 assistant turns each with
// tool_calls. Pre-fix this produced duplicate `call_0` IDs.
const history: Turn[] = [
  { role: 'user', content: 'Tìm khách hàng tên Nguyen' },
  {
    role: 'assistant',
    tool_calls: [
      { type: 'function', function: { name: 'search_customer', arguments: '{"name":"Nguyen"}' } },
    ],
  },
  { role: 'user', content: 'Lấy đơn hàng gần nhất của họ' },
  {
    role: 'assistant',
    tool_calls: [
      { type: 'function', function: { name: 'get_recent_orders', arguments: '{"customer_id":"c123","limit":1}' } },
      { type: 'function', function: { name: 'get_payment_status', arguments: '{"customer_id":"c123"}' } },
    ],
  },
]

const messages = buildMessages(history, 'You are a CRM assistant.', 'Tóm tắt thông tin')

// ── Assertions ────────────────────────────────────────────────────────
const allCallIds: string[] = []
const toolCallIds: string[] = []

for (const m of messages) {
  if (m.role === 'assistant' && m.tool_calls) {
    for (const tc of m.tool_calls) allCallIds.push(tc.id)
  }
  if (m.role === 'tool' && m.tool_call_id) toolCallIds.push(m.tool_call_id)
}

let pass = true
const errors: string[] = []

// 1. Unique IDs across the request
const idSet = new Set(allCallIds)
if (idSet.size !== allCallIds.length) {
  pass = false
  const dupes = allCallIds.filter((id, i) => allCallIds.indexOf(id) !== i)
  errors.push(`Duplicate tool_call.id values: ${[...new Set(dupes)].join(', ')}`)
}

// 2. Every tool_call_id has a matching assistant tool_call.id
for (const tcid of toolCallIds) {
  if (!idSet.has(tcid)) {
    pass = false
    errors.push(`Orphan tool_call_id (no matching assistant id): ${tcid}`)
  }
}

// 3. Counts match (every assistant tool_call has exactly one tool response)
if (allCallIds.length !== toolCallIds.length) {
  pass = false
  errors.push(`Count mismatch: ${allCallIds.length} tool_calls but ${toolCallIds.length} tool responses`)
}

console.log('Messages assembled:')
for (const m of messages) {
  if (m.role === 'assistant' && m.tool_calls) {
    console.log(`  assistant -> tool_calls: [${m.tool_calls.map(tc => `${tc.id}:${tc.function.name}`).join(', ')}]`)
  } else if (m.role === 'tool') {
    console.log(`  tool      -> tool_call_id: ${m.tool_call_id}, content: ${m.content}`)
  } else {
    const preview = typeof m.content === 'string' ? m.content.slice(0, 60) : '(null)'
    console.log(`  ${m.role.padEnd(9)} -> ${preview}`)
  }
}

console.log()
console.log(`tool_call.id set:      ${[...idSet].join(', ')}`)
console.log(`tool_call_id refs:     ${toolCallIds.join(', ')}`)
console.log()

if (pass) {
  console.log('PASS — IDs unique, all tool_call_id values match an assistant tool_call.id, counts equal.')
  process.exit(0)
} else {
  console.log('FAIL:')
  for (const e of errors) console.log(`  - ${e}`)
  process.exit(1)
}
