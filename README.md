# Crab Eval

LLM evaluation studio — benchmark AI agents on tool calling, QA/RAG, and agentic simulation tasks.

## Features

- **Task Generator** — upload a business document (spec or FAQ/policy), auto-detect document type, generate a benchmark dataset
  - **Tool-calling mode**: extract subtasks → compose tasks → generate natural language questions → generate `expected_tool_calls`
  - **QA/RAG mode**: chunk document → generate QA pairs with reference answers and context → export with judge metrics
- **Datasets** — manage benchmark datasets, merge ground-truth references, preview records
- **GT Generator** — batch-generate reference answers using an LLM
- **Agents** — define model profiles (base URL, API key, model name, temperature) for reuse across all pages
- **Config** — configure target model and judge model for a run
- **Run Eval** — run inference on a dataset, compute metrics, save results
- **Leaderboard** — compare models with per-task scores, radar charts, and merge mode
- **Visual Eval** — agentic simulation where two LLMs hold a conversation (User Model vs Target Model) with frozen oracle tool responses and programmatic verification

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Project Layout

```
datasets/          ← benchmark JSON files (committed to repo)
results/           ← eval outputs (git-ignored, created at runtime)
public/
└── animations/    ← pixel-art Clawd mascot SVG animations
src/
├── app/
│   ├── datasets/          ← upload & manage datasets
│   ├── gt-generator/      ← batch GT generation
│   ├── agents/            ← model profile management
│   ├── config/            ← target + judge model config
│   ├── run/               ← run eval, live log, progress
│   ├── task-generator/    ← dataset creation wizard (tool-calling & QA/RAG)
│   ├── leaderboard/       ← scores, radar charts, model comparison
│   ├── visual-eval/       ← agentic simulation eval
│   └── api/               ← Next.js route handlers
├── components/
│   ├── layout/Sidebar.tsx
│   └── ui/                ← shadcn/ui primitives + CrawdAnim mascot component
├── lib/
│   ├── openai.ts          ← OpenAI-compatible fetch wrapper
│   ├── metrics.ts         ← client-side metric computation
│   ├── evalRunner.ts      ← inference + scoring pipeline
│   ├── gtGenerator.ts     ← LLM-based GT batch generation
│   ├── taskGenerator.ts   ← subtask extraction, QA pair generation, tool call gen
│   └── visualEvalRunner.ts← agentic simulation engine
├── store/                 ← Zustand stores (persist to localStorage)
└── types/index.ts         ← shared TypeScript types
```

## Dataset Format

```json
{
  "metadata": {
    "task_name": "My Benchmark",
    "task_type": "tool_calling",
    "gt_metrics": ["tool_call_exact", "criteria_score"],
    "gt_model": "gpt-4o",
    "description": "..."
  },
  "data": [
    {
      "id": "task_001",
      "input": "User message sent to the model",
      "reference": "Ground-truth answer or assertion criteria",
      "output": "",
      "context": "Optional RAG context injected as system message",
      "tools": [...],
      "expected_tool_calls": [{"name": "...", "arguments": {...}}]
    }
  ]
}
```

### Supported Metrics

| Metric | Type | Used for |
|--------|------|----------|
| `tool_call_exact` | Programmatic (binary) | Tool-calling — exact match on tool name + required param keys |
| `criteria_score` | LLM-as-judge | Tool-calling — assertion-based partial credit |
| `faithfulness` | LLM-as-judge | QA/RAG — answer grounded in context |
| `answer_relevancy` | LLM-as-judge | QA/RAG — answer relevant to question |
| `token_f1` | Programmatic | Summarization / open QA |
| `rouge_l` | Programmatic | Summarization |
| `bleu1` | Programmatic | Translation |
| `exact_match` / `accuracy` | Programmatic | Classification |
| `ast_accuracy` | Programmatic | Tool calling (60% name + 40% arg keys) |

## QA/RAG Pipeline

When you upload a FAQ, policy, or guide document to Task Generator:

1. The app auto-detects the document type (`rag_qa` vs `tool_calling`)
2. The document is chunked and the LLM generates QA pairs (question, reference answer, source context)
3. You review and edit the pairs in Step 2
4. Export creates a dataset with `task_type: "rag_qa"` and `gt_metrics: ["faithfulness", "answer_relevancy"]`
5. Run Eval sends `context` as the system message and scores with LLM-as-judge

## API Keys

- Stored in **sessionStorage** (cleared when tab closes) — never in localStorage or Zustand
- Set via the Config page or Agent edit form
- Key names: `target_api_key`, `judge_api_key`, `visual_user_api_key`, and per-agent keys (`agent_{timestamp}_key`)

## Scripts

```bash
npm run dev          # development server on :3000
npm run build        # production build
npx tsc --noEmit     # type check (should be 0 errors)
```
