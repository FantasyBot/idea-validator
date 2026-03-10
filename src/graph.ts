import { StateGraph, MemorySaver } from "@langchain/langgraph";
import { ValidatorStateAnnotation } from "./state";
import { researchNode, interrogatorNode, roasterNode } from "./nodes";

/**
 * MemorySaver is the in-process checkpointer.
 * It is REQUIRED for interrupt/resume to work — LangGraph uses it to
 * serialize the graph state between the two graph.invoke() calls.
 *
 * For production: swap MemorySaver for SqliteSaver or a cloud checkpointer
 * (e.g. @langchain/langgraph-checkpoint-postgres) without changing any
 * node or service code.
 */
const checkpointer = new MemorySaver();

/**
 * Graph topology:
 *
 *   __start__
 *       │
 *    research   ◄── fetches competitor/market data via Tavily (skipped if no API key)
 *       │
 *   interrogator  ◄── interrupt() lives here (pauses after generating questions)
 *       │
 *    roaster
 *       │
 *    __end__
 *
 * The flow is strictly linear. The research node enriches both the interrogator
 * prompts and the final roast with real market data when TAVILY_API_KEY is set.
 */
export const graph = new StateGraph(ValidatorStateAnnotation)
  .addNode("research", researchNode)
  .addNode("interrogator", interrogatorNode)
  .addNode("roaster", roasterNode)
  .addEdge("__start__", "research")
  .addEdge("research", "interrogator")
  .addEdge("interrogator", "roaster")
  .addEdge("roaster", "__end__")
  .compile({ checkpointer });
