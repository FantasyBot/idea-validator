# Startup Validator MVP

A CLI tool that stress-tests your startup idea using a multi-agent LangGraph pipeline with a human-in-the-loop interrogation step. It optionally researches your market, asks you N brutal due-diligence questions, streams a blunt roast report written by a cynical CTO persona, and saves it to disk with a 0–100 viability score.

---

## How It Works

```
__start__
    │
 research     ◄── searches for competitors + market data via Tavily (skipped if no API key)
    │
interrogator  ◄── LLM generates N hard-hitting questions, then PAUSES here
    │              (you answer in the CLI)
  roaster     ◄── LLM reads your answers, streams the roast report
    │
 __end__
```

### Phase-by-phase walkthrough

| Phase | What happens |
|-------|-------------|
| **0 — Idea input** | You type your startup idea into the CLI |
| **1 — Research** | If `TAVILY_API_KEY` is set, searches for real competitors and market data. Summarised into a brief that feeds both the interrogator and roaster. Skipped silently if not configured. |
| **2 — Interrogation** | The `interrogatorNode` generates N questions (default 3) via structured output (Zod schema). The graph pauses via `interrupt()` and surfaces the questions to you. |
| **3 — Your answers** | The CLI collects your answers one by one |
| **4 — Resume & roast** | The graph resumes via `Command({ resume: answers })`. The `roasterNode` receives the full state and streams a markdown report with blind spots, severity ratings, and a viability score. |
| **5 — Save** | Report is written to `./reports/<timestamp>.md` |

---

## Project Structure

```
startup-validator-mvp/
├── src/
│   ├── index.ts    — CLI entry point (readline loop, streaming, report saving)
│   ├── graph.ts    — StateGraph definition and MemorySaver checkpointer setup
│   ├── nodes.ts    — researchNode, interrogatorNode, roasterNode
│   ├── service.ts  — startSession / finishSession (shared graph invocation logic)
│   └── state.ts    — ValidatorStateAnnotation (shared graph state channels)
├── reports/        — auto-created, one .md file per run
├── package.json
└── tsconfig.json
```

### `src/state.ts` — Shared Graph State

| Channel | Type | Purpose |
|---------|------|---------|
| `messages` | `BaseMessage[]` | Standard LangChain message history |
| `initialIdea` | `string` | The raw startup idea text |
| `researchSummary` | `string` | Market intelligence brief from the research node |
| `interrogationQuestions` | `string[]` | Questions from the interrogator |
| `userAnswers` | `string[]` | Answers from the user |
| `roastReport` | `string` | Final markdown report from the roaster |
| `viabilityScore` | `number` | 0–100 score parsed from the roast report |

### `src/nodes.ts` — The Three Agents

**`researchNode`**
- Runs only when `TAVILY_API_KEY` is set; returns `researchSummary: ""` otherwise
- Makes two parallel Tavily searches (competitors, market size/trends)
- Summarises findings into a 3–4 paragraph market intelligence brief
- That brief is injected into both the interrogator and roaster prompts

**`interrogatorNode`**
- Persona: relentless VC due-diligence analyst
- Uses `.withStructuredOutput(QuestionsSchema)` to guarantee exactly N questions as a typed JSON array
- Question count is controlled by `INTERROGATION_QUESTIONS` env var (default `3`, max `10`)
- Incorporates `researchSummary` to ask market-aware questions
- Calls `interrupt({ questions })` to pause execution; on resume, `interrupt()` returns the user's answers

**`roasterNode`**
- Persona: cynical battle-scarred CTO
- Receives the full populated state (idea + research + questions + answers)
- Produces a structured markdown report:
  - `## Viability Score: [0-100]/100` — calibrated survivability score
  - `## Verdict` — one punchy sentence
  - `## Blind Spot #1/2/3` — analysis + severity (🔴 Fatal / 🟠 Serious / 🟡 Manageable)
  - `## Survival Roadmap` — if salvageable, otherwise `## Time of Death`
- Score is parsed from the report and stored separately in `viabilityScore`

### `src/service.ts` — Shared Session Logic

```typescript
startSession(idea)              // runs research + interrogator, returns { sessionId, questions }
finishSession(sessionId, answers) // resumes graph, returns { report, score }
```

### `src/index.ts` — CLI Orchestration

Phase 1 uses `startSession()`. Phase 3 uses `graph.streamEvents()` directly to stream roast tokens to stdout in real time, then `graph.getState()` to retrieve the final score.

```typescript
// Phase 1: run until interrupt (research + interrogator)
const { sessionId, questions } = await startSession(initialIdea);

// ... collect answers from user ...

// Phase 3: stream the roast report token by token
for await (const event of graph.streamEvents(new Command({ resume: answers }), config)) {
  if (event.event === "on_chat_model_stream" && event.metadata?.langgraph_node === "roaster") {
    process.stdout.write(event.data.chunk.content);
  }
}

// Get score + save to disk
const { values } = await graph.getState(config);
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

# 2. Copy and fill in environment variables
cp .env.example .env
```

Edit `.env`:

```env
OPENAI_API_KEY=sk-...           # required
OPENAI_MODEL=gpt-4o             # optional, default: gpt-4o
TAVILY_API_KEY=tvly-...         # optional — enables market research
INTERROGATION_QUESTIONS=3       # optional — number of questions (1-10)
```

---

## Running

```bash
npm start
```

Example session:

```
════════════════════════════════════════════════════════════
  STARTUP VALIDATOR MVP  —  Powered by LangGraph + gpt-4o
════════════════════════════════════════════════════════════

Describe your startup idea (be specific):
> An AI-powered platform that automatically negotiates SaaS contracts on behalf of SMBs

Researching market & competitors via Tavily...

────────────────────────────────────────────────────────────
DUE DILIGENCE — Answer honestly. Vague answers = brutal roast.
────────────────────────────────────────────────────────────

Q1: How do you handle liability when your AI negotiation goes wrong?
Your answer: _

Q2: What prevents SaaS vendors from simply refusing to negotiate?
Your answer: _

Q3: What's your data moat if an incumbent replicates this in 90 days?
Your answer: _

Generating your roast report...

## Viability Score: 34/100
...

════════════════════════════════════════════════════════════
  VIABILITY SCORE: 34/100
════════════════════════════════════════════════════════════

Report saved to: reports/2026-03-10T14-32-00-000Z.md
```

---

## Known Limitations

- **No data handling controls** — your idea and answers are sent to OpenAI's API and (if configured) Tavily. Not suitable for confidential ideas or enterprise use without adding a local model path and explicit data disclosure
- **Score is uncalibrated** — the 0–100 score is LLM-generated, not benchmarked against real startup outcomes. Treat it as a structured opinion, not a prediction
- **No retention** — each run is independent. There is no longitudinal tracking, cohort benchmarking, or follow-up mechanism yet

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
| `@langchain/langgraph` | ^1.2 | Graph execution, `interrupt`/`Command`, `MemorySaver`, `streamEvents` |
| `@langchain/openai` | ^1.2 | ChatOpenAI model wrapper |
| `@langchain/core` | ^1.1 | Message types, base abstractions |
| `zod` | ^3.25 | Structured output schema for interrogator |
| `dotenv` | ^17 | Environment variable loading |
| `tsx` | ^4.21 | Run TypeScript directly — no build step needed in dev |

---

## Production Roadmap

1. **Persistent checkpointer** — swap `MemorySaver` for `SqliteSaver` or `@langchain/langgraph-checkpoint-postgres`. No node or service code needs to change.
2. **Local model support** — swap `ChatOpenAI` for `ChatOllama` in `nodes.ts` for zero data egress. Controlled via `MODEL_PROVIDER` env var.
3. **Data disclosure** — print a consent notice at startup listing exactly which external APIs receive data.
4. **Longitudinal tracking** — resurface old reports and re-evaluate after 90 days to create a commitment device and improve score calibration over time.
5. **Cohort benchmarking** — aggregate anonymised scores to make the viability number meaningful relative to other ideas in the dataset.
