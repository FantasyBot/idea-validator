import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { interrupt } from "@langchain/langgraph";
import { z } from "zod";
import { ValidatorState } from "./state";

// ---------------------------------------------------------------------------
// Model setup
// ---------------------------------------------------------------------------

const model = new ChatOpenAI({
  model: process.env.OPENAI_MODEL ?? "gpt-4o",
  temperature: 0.7,
});

// ---------------------------------------------------------------------------
// Configurable question count (INTERROGATION_QUESTIONS env var, default 3)
// ---------------------------------------------------------------------------

const questionCount = Math.max(
  1,
  Math.min(10, parseInt(process.env.INTERROGATION_QUESTIONS ?? "3", 10))
);

const QuestionsSchema = z.object({
  questions: z
    .array(z.string())
    .length(questionCount)
    .describe(
      `Exactly ${questionCount} hard-hitting technical or go-to-market questions about the startup idea`
    ),
});

// Passing schema as `any` avoids TS2589 (type instantiation too deep) — a known
// TypeScript limitation with LangChain's deeply nested generics.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const interrogatorLLM = model.withStructuredOutput(QuestionsSchema as any);

// ---------------------------------------------------------------------------
// Tavily search helper — uses built-in fetch, no extra dependency needed
// ---------------------------------------------------------------------------

async function tavilySearch(query: string): Promise<string> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      max_results: 5,
    }),
  });
  if (!response.ok) throw new Error(`Tavily error: ${response.status}`);
  const data = (await response.json()) as {
    results?: Array<{ title: string; content: string }>;
  };
  return (
    data.results?.map((r) => `${r.title}\n${r.content}`).join("\n\n") ?? ""
  );
}

// ---------------------------------------------------------------------------
// researchNode
// ---------------------------------------------------------------------------
// Optional — only runs meaningful work when TAVILY_API_KEY is set.
// Searches for competitors and market data, summarises into researchSummary
// which is then used by both the interrogator and roaster for richer analysis.
// ---------------------------------------------------------------------------

export async function researchNode(
  state: ValidatorState
): Promise<Partial<ValidatorState>> {
  if (!process.env.TAVILY_API_KEY) {
    return { researchSummary: "" };
  }

  const [competitorResults, marketResults] = await Promise.all([
    tavilySearch(`${state.initialIdea} startup competitors 2024 2025 2026`),
    tavilySearch(`${state.initialIdea} market size trends`),
  ]);

  const summary = await model.invoke([
    new SystemMessage(
      `You are a market research analyst. Summarize the following search results into a concise market intelligence brief (3-4 paragraphs).
Focus on: key competitors, market size/growth, recent trends, and notable risks. Be factual and specific.`
    ),
    new HumanMessage(
      `STARTUP IDEA: "${state.initialIdea}"\n\nCOMPETITOR SEARCH RESULTS:\n${competitorResults}\n\nMARKET SEARCH RESULTS:\n${marketResults}`
    ),
  ]);

  return { researchSummary: summary.content as string };
}

// ---------------------------------------------------------------------------
// interrogatorNode
// ---------------------------------------------------------------------------
// Generates N due-diligence questions (N = questionCount), incorporating any
// market research context. Pauses the graph via interrupt() so the CLI/API
// can collect user answers before resuming.
// ---------------------------------------------------------------------------

export async function interrogatorNode(
  state: ValidatorState
): Promise<Partial<ValidatorState>> {
  const researchContext = state.researchSummary
    ? `\n\nMARKET RESEARCH CONTEXT (use this to make questions more specific):\n${state.researchSummary}`
    : "";

  const result = (await interrogatorLLM.invoke([
    new SystemMessage(
      `You are a relentless technical due-diligence analyst at a top-tier VC firm.
Your job is to stress-test startup ideas by surfacing the most dangerous technical,
infrastructure, or go-to-market blind spots.

Ask questions that probe: scalability bottlenecks, security/compliance landmines,
build-vs-buy tradeoffs, distribution moat, or regulatory exposure.

Rules:
- Be hyper-specific to the idea — no generic "what's your monetization?" filler
- Each question must be a single, direct sentence
- Order from most to least existential threat${researchContext}`
    ),
    new HumanMessage(
      `Startup idea: "${state.initialIdea}"\n\nGenerate exactly ${questionCount} hard-hitting questions.`
    ),
  ])) as z.infer<typeof QuestionsSchema>;

  // Pause the graph here. The interrupt value is what the CLI/API reads to know
  // what questions to display. Execution resumes when the caller invokes
  // graph.invoke(new Command({ resume: answers }), sameThreadConfig).
  const answers = interrupt({
    questions: result.questions,
  }) as string[];

  return {
    interrogationQuestions: result.questions,
    userAnswers: answers,
  };
}

// ---------------------------------------------------------------------------
// roasterNode
// ---------------------------------------------------------------------------
// Receives the fully-populated state (idea + research + questions + answers)
// and produces a structured roast report including a 0-100 viability score.
// ---------------------------------------------------------------------------

export async function roasterNode(
  state: ValidatorState
): Promise<Partial<ValidatorState>> {
  const qa = state.interrogationQuestions
    .map(
      (q, i) =>
        `Q${i + 1}: ${q}\nA${i + 1}: ${state.userAnswers[i] ?? "(no answer provided)"}`
    )
    .join("\n\n");

  const researchContext = state.researchSummary
    ? `\n\nMARKET RESEARCH:\n${state.researchSummary}`
    : "";

  const response = await model.invoke([
    new SystemMessage(
      `You are a cynical, battle-scarred CTO with 20 years of experience watching
well-funded startups crater for embarrassingly avoidable reasons.

You produce blunt, technically rigorous roast reports. No motivational fluff.
No "great idea but..." hedging. If the idea is broken, say so clearly.

Format your report EXACTLY as follows:

## Viability Score: [0-100]/100
One sentence justifying the score.

## Verdict
One punchy sentence summarizing the idea's survivability.

## Blind Spot #1 — [Title]
2-3 sentences of analysis.
Severity: 🔴 Fatal | 🟠 Serious | 🟡 Manageable

## Blind Spot #2 — [Title]
2-3 sentences of analysis.
Severity: 🔴 Fatal | 🟠 Serious | 🟡 Manageable

## Blind Spot #3 — [Title]
2-3 sentences of analysis.
Severity: 🔴 Fatal | 🟠 Serious | 🟡 Manageable

## Survival Roadmap
One paragraph. Only include if the idea isn't fundamentally broken.
If it IS fundamentally broken, replace this section with "## Time of Death" and explain why.`
    ),
    new HumanMessage(
      `STARTUP IDEA:\n${state.initialIdea}${researchContext}\n\nDUE DILIGENCE Q&A:\n${qa}\n\nDeliver the roast.`
    ),
  ]);

  const reportText = response.content as string;
  const scoreMatch = reportText.match(/Viability Score:\s*(\d+)\/100/);
  const viabilityScore = scoreMatch ? parseInt(scoreMatch[1], 10) : 0;

  return {
    roastReport: reportText,
    viabilityScore,
    messages: [response],
  };
}
