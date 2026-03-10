import "dotenv/config";
import { Command } from "@langchain/langgraph";
import { graph } from "./graph";

// ---------------------------------------------------------------------------
// Thread config helper
// ---------------------------------------------------------------------------

export function makeThreadConfig(sessionId: string) {
  return { configurable: { thread_id: sessionId } };
}

// ---------------------------------------------------------------------------
// Phase 1: Start a validation session
// ---------------------------------------------------------------------------
// Runs the graph from __start__ through research → interrogator (which
// calls interrupt() after generating questions). Returns the sessionId and
// the generated questions. The graph is paused, waiting for answers.

export async function startSession(
  idea: string
): Promise<{ sessionId: string; questions: string[] }> {
  const sessionId = `session-${Date.now()}`;

  const snapshot = await graph.invoke(
    { initialIdea: idea },
    makeThreadConfig(sessionId)
  );

  const interrupts = (
    snapshot as typeof snapshot & {
      __interrupt__?: Array<{ value: { questions: string[] } }>;
    }
  ).__interrupt__;

  if (!interrupts?.length) {
    throw new Error("Graph completed without reaching the interrupt checkpoint.");
  }

  return { sessionId, questions: interrupts[0].value.questions };
}

// ---------------------------------------------------------------------------
// Phase 2: Finish a validation session
// ---------------------------------------------------------------------------
// Resumes the paused graph with the user's answers, runs the roaster node,
// and returns the final report and viability score.

export async function finishSession(
  sessionId: string,
  answers: string[]
): Promise<{ report: string; score: number }> {
  const finalState = await graph.invoke(
    new Command({ resume: answers }),
    makeThreadConfig(sessionId)
  );

  return {
    report: finalState.roastReport ?? "No report generated.",
    score: finalState.viabilityScore ?? 0,
  };
}
