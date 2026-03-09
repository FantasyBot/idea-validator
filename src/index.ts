import "dotenv/config";
import * as readline from "readline";
import { Command } from "@langchain/langgraph";
import { graph } from "./graph";

// ---------------------------------------------------------------------------
// Readline helpers
// ---------------------------------------------------------------------------

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

function hr(char = "─", width = 60) {
  return char.repeat(width);
}

// ---------------------------------------------------------------------------
// Main CLI flow
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n" + hr("═"));
  console.log("  STARTUP VALIDATOR MVP  —  Powered by LangGraph + Claude");
  console.log(hr("═") + "\n");

  // ── Phase 0: Collect the startup idea ───────────────────────────────────
  const initialIdea = await ask(
    "Describe your startup idea (be specific):\n> "
  );

  if (!initialIdea.trim()) {
    console.error("No idea provided. Exiting.");
    rl.close();
    process.exit(1);
  }

  // Each session gets its own thread so multiple runs don't bleed into each other.
  const threadConfig = {
    configurable: { thread_id: `session-${Date.now()}` },
  };

  console.log("\n" + hr());
  console.log("Analyzing your idea...");
  console.log(hr() + "\n");

  // ── Phase 1: Run the graph until interrupt ───────────────────────────────
  // interrogatorNode calls interrupt() after generating questions, so invoke()
  // returns early with __interrupt__ populated rather than completing the graph.
  const snapshot = await graph.invoke({ initialIdea }, threadConfig);

  // Type-safe access to the interrupt payload
  const interrupts = (
    snapshot as typeof snapshot & {
      __interrupt__?: Array<{ value: { questions: string[] } }>;
    }
  ).__interrupt__;

  if (!interrupts || interrupts.length === 0) {
    // Should not happen in normal flow, but handle gracefully
    console.error("Graph completed without reaching the interrupt. Exiting.");
    rl.close();
    process.exit(1);
  }

  const { questions } = interrupts[0].value;

  // ── Phase 2: Present questions, collect answers ──────────────────────────
  console.log(hr());
  console.log("DUE DILIGENCE — Answer honestly. Vague answers = brutal roast.");
  console.log(hr() + "\n");

  const answers: string[] = [];

  for (let i = 0; i < questions.length; i++) {
    console.log(`Q${i + 1}: ${questions[i]}`);
    const answer = await ask("Your answer: ");
    answers.push(answer.trim() || "(no answer provided)");
    console.log();
  }

  console.log(hr());
  console.log("Generating your roast report...");
  console.log(hr() + "\n");

  // ── Phase 3: Resume the graph with answers ───────────────────────────────
  // Command({ resume: value }) is the LangGraph primitive for resuming after
  // an interrupt. The `value` is returned by interrupt() inside interrogatorNode.
  // Using the SAME threadConfig ties this call to the persisted checkpoint.
  const finalState = await graph.invoke(
    new Command({ resume: answers }),
    threadConfig
  );

  // ── Phase 4: Print the roast report ─────────────────────────────────────
  console.log("\n" + hr("═"));
  console.log("  ROAST REPORT");
  console.log(hr("═") + "\n");
  console.log(finalState.roastReport ?? "No report generated.");
  console.log("\n" + hr("═") + "\n");

  rl.close();
}

main().catch((err) => {
  console.error("\nFatal error:", err instanceof Error ? err.message : err);
  rl.close();
  process.exit(1);
});
