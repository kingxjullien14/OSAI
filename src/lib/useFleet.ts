import { useMemo } from "react";

import type { ChatTurn } from "./chatStream";
import {
  buildAgentChildMap,
  reconcileBackground,
  type BgTask,
  type SubagentSummary,
  type ToolTurn,
} from "./subagentFleet";

/**
 * One source of truth for sub-agent rendering, reconciling the transcript's
 * `parentId` nesting with the live `system/task_*` channel (`bgTasks`). Both the
 * transcript (nested AgentStep rows) and the composer dock read from this, so
 * they can never disagree.
 *
 * - `childrenByAgent` / `childIds` — GLOBAL parent→children map (see
 *   `buildAgentChildMap`): a sub-agent's children nest under its Agent row
 *   wherever/whenever they arrived; `childIds` are pulled out of the linear
 *   transcript stream (the Agent owns them).
 * - `dock` — currently-running BACKGROUND agents, for the composer dock.
 * - `backgroundMemberIds` — tool ids in a running background subtree; excluded
 *   from the transcript while live, re-enter (collapsed) when the task finishes.
 */
export function useFleet(turns: ChatTurn[], bgTasks: BgTask[]) {
  const tools = useMemo(
    () => turns.filter((t): t is ToolTurn => t.kind === "tool"),
    [turns],
  );
  const childMap = useMemo(() => buildAgentChildMap(tools), [tools]);
  const { dock, memberIds } = useMemo(
    () => reconcileBackground(tools, childMap.childrenByAgent, bgTasks),
    [tools, childMap, bgTasks],
  );
  return {
    childrenByAgent: childMap.childrenByAgent,
    childIds: childMap.childIds,
    dock,
    backgroundMemberIds: memberIds,
  };
}

export type { SubagentSummary };
