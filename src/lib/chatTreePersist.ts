// Persist the conversation TREE so branches survive a reload (Tier-4 branching).
//
// The durable event log (`events.jsonl`) is LINEAR — it can't represent the tree,
// so a reopened branched chat would replay flat. This sidecar (`tree.json`, saved
// per session) stores the full structure + each node's settled turn, so reopening
// restores the exact tree (active branch + switchers). Pure serialize/deserialize;
// the file I/O is in chat_history.rs + the chatHistory.ts wrappers.
import type { ChatTurn } from "./chatStream";
import type { Selection, TreeNode } from "./chatTree";

export interface PersistedTree {
  v: 1;
  selection: Selection;
  /** structure + the settled turn content for each node (so reload is exact). */
  nodes: { id: string; parentId: string | null; turn: ChatTurn }[];
}

/** Build the saveable tree from the live structure + a turn resolver. Nodes whose
 *  turn is missing (shouldn't happen) are skipped. */
export function serializeTree(
  nodes: TreeNode<string>[],
  selection: Selection,
  turnById: Map<string, ChatTurn>,
): PersistedTree {
  const out: PersistedTree["nodes"] = [];
  for (const n of nodes) {
    const turn = turnById.get(n.id);
    if (turn) out.push({ id: n.id, parentId: n.parentId, turn });
  }
  return { v: 1, selection, nodes: out };
}

/** Parse a saved tree back into live state. Returns null on empty/invalid input
 *  (caller then falls back to the linear log). */
export function deserializeTree(
  json: string,
): { nodes: TreeNode<string>[]; selection: Selection; turns: ChatTurn[] } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const p = parsed as PersistedTree | null;
  if (!p || p.v !== 1 || !Array.isArray(p.nodes) || p.nodes.length === 0) return null;
  const nodes: TreeNode<string>[] = [];
  const turns: ChatTurn[] = [];
  for (const e of p.nodes) {
    if (!e || typeof e.id !== "string" || !e.turn || typeof e.turn !== "object") continue;
    nodes.push({ id: e.id, parentId: e.parentId ?? null, value: e.id });
    turns.push(e.turn);
  }
  if (nodes.length === 0) return null;
  const selection =
    p.selection && typeof p.selection === "object" ? p.selection : ({} as Selection);
  return { nodes, selection, turns };
}
