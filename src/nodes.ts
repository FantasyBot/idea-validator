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
// Structured output schema for the interrogator
// Using .withStructuredOutput() guarantees the LLM returns a typed object,
// not free-form text, so we can safely destructure result.questions.
// ---------------------------------------------------------------------------

const QuestionsSchema = z.object({
  questions: z
    .array(z.string())
    .length(3)
    .describe(
      "Exactly 3 hard-hitting technical or go-to-market questions about the startup idea"
    ),
});

// Passing schema as `any` avoids TS2589 (type instantiation too deep) — a known
// TypeScript limitation with LangChain's deeply nested generics.
// Type safety is restored by asserting invoke() results as z.infer<QuestionsSchema>.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const interrogatorLLM = model.withStructuredOutput(QuestionsSchema as any);

// ---------------------------------------------------------------------------
// interrogatorNode
// ---------------------------------------------------------------------------
// Responsibilities:
//  1. Call the LLM (structured output) to generate 3 due-diligence questions
//  2. Call interrupt() — this PAUSES the graph and surfaces the questions to
//     the caller (our CLI). The graph's MemorySaver checkpointer persists state.
//  3. When the graph is resumed via Command({ resume: answers }), the interrupt()
//     call returns the resume value (the user's answers array).
//  4. Return both questions and answers so they land in state before roasterNode runs.
// ---------------------------------------------------------------------------

export async function interrogatorNode(
  state: ValidatorState
): Promise<Partial<ValidatorState>> {
  const result = (await interrogatorLLM.invoke([
    new SystemMessage(
      `You are a relentless technical due-diligence analyst at a top-tier VC firm.
Your job is to stress-test startup ideas by surfacing the 3 most dangerous technical,
infrastructure, or go-to-market blind spots.

Ask questions that probe: scalability bottlenecks, security/compliance landmines,
build-vs-buy tradeoffs, distribution moat, or regulatory exposure.

Rules:
- Be hyper-specific to the idea — no generic "what's your monetization?" filler
- Each question must be a single, direct sentence
- Order from most to least existential threat`
    ),
    new HumanMessage(
      `Startup idea: "${state.initialIdea}"\n\nGenerate exactly 3 hard-hitting questions.`
    ),
  ])) as z.infer<typeof QuestionsSchema>;

  // Pause the graph here. The interrupt value is what the CLI reads to know
  // what questions to display. Execution resumes when the CLI calls
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
// Receives the fully-populated state (idea + questions + answers) and produces
// a structured roast report as a free-form string (rich markdown is fine here).
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

  const response = await model.invoke([
    new SystemMessage(
      `You are a cynical, battle-scarred CTO with 20 years of experience watching
well-funded startups crater for embarrassingly avoidable reasons.

You produce blunt, technically rigorous roast reports. No motivational fluff.
No "great idea but..." hedging. If the idea is broken, say so clearly.

Format your report exactly as follows:

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
      `STARTUP IDEA:\n${state.initialIdea}\n\nDUE DILIGENCE Q&A:\n${qa}\n\nDeliver the roast.`
    ),
  ]);

  return {
    roastReport: response.content as string,
    messages: [response],
  };
}
