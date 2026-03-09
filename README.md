# Startup Validator MVP

A CLI tool that stress-tests your startup idea using a two-agent LangGraph pipeline with a human-in-the-loop interrogation step. It asks you three brutal due-diligence questions, waits for your answers, then delivers a blunt "roast report" written by a cynical CTO persona.

---

## How It Works

The tool runs a linear two-node LangGraph graph with a `interrupt()` pause between the nodes:

```
__start__
    │
interrogator  ◄── LLM generates 3 hard-hitting questions, then PAUSES here
    │              (you answer in the CLI)
 roaster       ◄── LLM reads your answers and delivers the roast report
    │
 __end__
```

### Phase-by-phase walkthrough

| Phase | What happens |
|-------|-------------|
| **0 — Idea input** | You type your startup idea into the CLI |
| **1 — Interrogation** | The `interrogatorNode` calls GPT-4o with a VC due-diligence persona and generates exactly 3 questions via structured output (Zod schema). The graph then pauses via `interrupt()` and surfaces the questions to you. |
| **2 — Your answers** | The CLI collects your 3 answers one by one |
| **3 — Resume & roast** | The graph resumes via `Command({ resume: answers })`. The `roasterNode` receives the full state (idea + questions + answers) and generates a structured markdown roast report. |
| **4 — Report** | The report is printed to your terminal |

---

## Project Structure

```
startup-validator-mvp/
├── src/
│   ├── index.ts   — CLI entry point (readline loop, interrupt/resume orchestration)
│   ├── graph.ts   — StateGraph definition and MemorySaver checkpointer setup
│   ├── nodes.ts   — interrogatorNode and roasterNode implementations
│   └── state.ts   — ValidatorStateAnnotation (shared graph state channels)
├── package.json
└── tsconfig.json
```

### `src/state.ts` — Shared Graph State

Defines the 5 state channels shared across all nodes:

| Channel | Type | Reducer | Purpose |
|---------|------|---------|---------|
| `messages` | `BaseMessage[]` | append/dedup by ID | Standard LangChain message history |
| `initialIdea` | `string` | replace | The raw startup idea text |
| `interrogationQuestions` | `string[]` | replace | 3 questions from the interrogator |
| `userAnswers` | `string[]` | replace | 3 answers from the user |
| `roastReport` | `string` | replace | Final markdown report from the roaster |

### `src/nodes.ts` — The Two Agents

**`interrogatorNode`**
- Persona: relentless VC due-diligence analyst
- Uses `.withStructuredOutput(QuestionsSchema)` to guarantee exactly 3 questions as a typed JSON array
- Calls `interrupt({ questions })` to pause execution and pass the questions to the CLI
- On resume, `interrupt()` returns the user's answers array
- Returns `{ interrogationQuestions, userAnswers }` into state

**`roasterNode`**
- Persona: cynical battle-scarred CTO
- Receives the full populated state
- Produces a structured markdown report with these sections:
  - `## Verdict` — one punchy survivability sentence
  - `## Blind Spot #1/2/3` — analysis + severity rating (🔴 Fatal / 🟠 Serious / 🟡 Manageable)
  - `## Survival Roadmap` — only if the idea is salvageable, otherwise `## Time of Death`

### `src/graph.ts` — Graph Wiring

- `StateGraph` with `ValidatorStateAnnotation`
- Linear edges: `__start__` → `interrogator` → `roaster` → `__end__`
- `MemorySaver` checkpointer — required for `interrupt`/`Command` resume to work (serializes graph state between the two `invoke()` calls)
- Each CLI run gets a unique `thread_id: session-${Date.now()}` to prevent state bleed between sessions

### `src/index.ts` — CLI Orchestration

The two-phase invoke pattern:

```typescript
// Phase 1: run until interrupt
const snapshot = await graph.invoke({ initialIdea }, threadConfig);
const { questions } = snapshot.__interrupt__[0].value;

// ... collect answers from user ...

// Phase 2: resume with answers
const finalState = await graph.invoke(
  new Command({ resume: answers }),
  threadConfig   // same thread_id — ties back to the checkpoint
);
```

---

## Prerequisites

- Node.js 18+
- An OpenAI API key

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Set your OpenAI API key
export OPENAI_API_KEY=sk-...

# 3. (Optional) Override the model — default is gpt-4o
export OPENAI_MODEL=gpt-4o-mini
```

---

## Running

```bash
npm start
```

Example session:

```
════════════════════════════════════════════════════════════
  STARTUP VALIDATOR MVP  —  Powered by LangGraph + Claude
════════════════════════════════════════════════════════════

Describe your startup idea (be specific):
> An AI-powered platform that automatically negotiates SaaS contracts on behalf of SMBs

────────────────────────────────────────────────────────────
Analyzing your idea...
────────────────────────────────────────────────────────────

DUE DILIGENCE — Answer honestly. Vague answers = brutal roast.

Q1: How do you handle liability when your AI negotiation goes wrong ...
Your answer: _

Q2: What prevents SaaS vendors from simply refusing to negotiate ...
Your answer: _

Q3: What's your data moat if OpenAI or a legal-tech incumbent ...
Your answer: _

────────────────────────────────────────────────────────────
Generating your roast report...
════════════════════════════════════════════════════════════
  ROAST REPORT
════════════════════════════════════════════════════════════

## Verdict
...
```

---

## Other Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Run with `tsx watch` — auto-restarts on file changes |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run typecheck` | Type-check without emitting files |

---

## Key Dependencies

| Package | Version | Role |
|---------|---------|------|
| `@langchain/langgraph` | ^1.2 | Graph execution engine, `interrupt`/`Command`, `MemorySaver` |
| `@langchain/openai` | ^1.2 | ChatOpenAI model wrapper |
| `@langchain/core` | ^1.1 | Message types, base abstractions |
| `zod` | ^3.25 | Structured output schema for interrogator |
| `tsx` | ^4.21 | Run TypeScript directly — no build step needed in dev |

---

## Production Notes

To move beyond the MVP:

1. **Persistent checkpointer** — swap `MemorySaver` for `SqliteSaver` or `@langchain/langgraph-checkpoint-postgres`. No node or CLI code needs to change.
2. **REST API** — wrap `graph.invoke()` in Express/Fastify endpoints. Phase 1 returns a job ID; Phase 2 takes the job ID + answers.
3. **Streaming** — replace `graph.invoke()` with `graph.stream()` to stream roast report tokens to the client.
4. **Model** — set `OPENAI_MODEL=gpt-4o` for highest quality, or `gpt-4o-mini` for lower cost.
