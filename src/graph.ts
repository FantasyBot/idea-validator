import { StateGraph, MemorySaver } from "@langchain/langgraph";
import { ValidatorStateAnnotation } from "./state";
import { interrogatorNode, roasterNode } from "./nodes";

/**
 * MemorySaver is the in-process checkpointer.
 * It is REQUIRED for interrupt/resume to work — LangGraph uses it to
 * serialize the graph state between the two graph.invoke() calls.
 *
 * For production: swap MemorySaver for SqliteSaver or a cloud checkpointer
 * (e.g. @langchain/langgraph-checkpoint-postgres) without changing any
 * node or CLI code.
 */
const checkpointer = new MemorySaver();

/**
 * Graph topology:
 *
 *   __start__
 *       │
 *   interrogator  ◄── interrupt() lives here (pauses after generating questions)
 *       │
 *    roaster
 *       │
 *    __end__
 *
 * There are no conditional edges because the flow is strictly linear.
 * The interrupt acts as the human-in-the-loop gate between the two nodes.
 */
export const graph = new StateGraph(ValidatorStateAnnotation)
  .addNode("interrogator", interrogatorNode)
  .addNode("roaster", roasterNode)
  .addEdge("__start__", "interrogator")
  .addEdge("interrogator", "roaster")
  .addEdge("roaster", "__end__")
  .compile({ checkpointer });
