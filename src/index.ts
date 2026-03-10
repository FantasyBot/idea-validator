import "dotenv/config";
import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import { Command } from "@langchain/langgraph";
import { graph } from "./graph";
import { startSession, makeThreadConfig } from "./service";

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
  const modelName = process.env.OPENAI_MODEL ?? "gpt-4o";
  const researchEnabled = !!process.env.TAVILY_API_KEY;

  console.log("\n" + hr("═"));
  console.log(`  STARTUP VALIDATOR MVP  —  Powered by LangGraph + ${modelName}`);
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

  console.log("\n" + hr());
  if (researchEnabled) {
    console.log("Researching market & competitors via Tavily...");
  } else {
    console.log("Analyzing your idea...");
  }
  console.log(hr() + "\n");

  // ── Phase 1: Run graph to interrupt (research + interrogator) ────────────
  const { sessionId, questions } = await startSession(initialIdea);

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
  console.log("Generating your roast report...\n");

  // ── Phase 3: Resume graph and stream the roast report ───────────────────
  // graph.streamEvents() with version "v2" emits on_chat_model_stream events
  // for every token the roaster model produces, giving real-time output.
  const threadConfig = makeThreadConfig(sessionId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const event of (graph as any).streamEvents(
    new Command({ resume: answers }),
    { ...threadConfig, version: "v2" }
  )) {
    if (
      event.event === "on_chat_model_stream" &&
      event.metadata?.langgraph_node === "roaster"
    ) {
      const content = event.data?.chunk?.content;
      if (typeof content === "string" && content) {
        process.stdout.write(content);
      }
    }
  }

  process.stdout.write("\n");

  // ── Phase 4: Retrieve final state for score + saving ────────────────────
  const snapshot = await graph.getState(threadConfig);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalValues = snapshot.values as any;
  const score: number = finalValues.viabilityScore ?? 0;
  const report: string = finalValues.roastReport ?? "";

  console.log("\n" + hr("═"));
  console.log(`  VIABILITY SCORE: ${score}/100`);
  console.log(hr("═") + "\n");

  // ── Phase 5: Save report to ./reports/<timestamp>.md ────────────────────
  if (report) {
    const reportsDir = path.join(process.cwd(), "reports");
    fs.mkdirSync(reportsDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const reportFile = path.join(reportsDir, `${timestamp}.md`);
    const reportContent = [
      `# Startup Validator Report`,
      ``,
      `**Date:** ${new Date().toISOString()}`,
      `**Model:** ${modelName}`,
      `**Idea:** ${initialIdea}`,
      `**Viability Score:** ${score}/100`,
      ``,
      `---`,
      ``,
      report,
    ].join("\n");
    fs.writeFileSync(reportFile, reportContent, "utf-8");
    console.log(`Report saved to: reports/${path.basename(reportFile)}\n`);
  }

  rl.close();
}

main().catch((err) => {
  console.error("\nFatal error:", err instanceof Error ? err.message : err);
  rl.close();
  process.exit(1);
});
