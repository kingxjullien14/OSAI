// Conversation tree — the data model behind PROPER branching (Tier-3 P2, built on
// Tier-4 BYO-key where OSAI owns the message array).
//
// Unlike the display-only re-roll switcher (`chatBranching.ts`, which only shows
// alternate answers to the LAST prompt), this is a real tree: edit OR regenerate
// at any point FORKS a sibling branch, you SWAP between branches, and each branch
// keeps its OWN continuation. The visible transcript is the active root→leaf path;
// on each send the active path's messages go to the model (OSAI owns the array).
//
// Pure + transport/UI-agnostic + generic over the node payload `T`, so it's
// unit-tested in isolation and the ChatPane integration just projects its `turns`
// from `activePath(...)`. A node knows only its `id` + `parentId`; a `Selection`
// records which child is active at each branch point.

/** A node in the conversation forest. `parentId: null` = a top-level (root) node. */
export interface TreeNode<T = unknown> {
  id: string;
  parentId: string | null;
  value: T;
}

/** Selection key for the top-level (root) choice — parents use their own id. */
export const ROOT = "__root__";

/** Branch point → its active child id. Absent ⇒ default (the newest child). */
export type Selection = Record<string, string>;

const keyFor = (parentId: string | null): string => parentId ?? ROOT;

/** Children of `parentId` (root level = `null`), in insertion order. */
export function childrenOf<T>(nodes: TreeNode<T>[], parentId: string | null): TreeNode<T>[] {
  return nodes.filter((n) => n.parentId === parentId);
}

/**
 * The active child id under `parentId`: an explicit, still-valid selection wins;
 * otherwise the LAST (newest) child — so a fresh fork (edit/regenerate) shows by
 * default, and a stale selection (child since removed) falls back safely. `null`
 * when the node has no children (a leaf / the end of the path).
 */
export function activeChildId<T>(
  nodes: TreeNode<T>[],
  selection: Selection,
  parentId: string | null,
): string | null {
  const kids = childrenOf(nodes, parentId);
  if (kids.length === 0) return null;
  const chosen = selection[keyFor(parentId)];
  if (chosen && kids.some((k) => k.id === chosen)) return chosen;
  return kids[kids.length - 1]!.id;
}

/**
 * The active root→leaf path as an ordered node list. Walks from the root level,
 * following the active child at each step. Cycle-guarded (a malformed parent ring
 * can't hang the walk).
 */
export function activePath<T>(nodes: TreeNode<T>[], selection: Selection): TreeNode<T>[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: TreeNode<T>[] = [];
  const seen = new Set<string>();
  let parentId: string | null = null;
  for (;;) {
    const childId = activeChildId(nodes, selection, parentId);
    if (!childId || seen.has(childId)) break;
    const node = byId.get(childId);
    if (!node) break;
    seen.add(childId);
    out.push(node);
    parentId = node.id;
  }
  return out;
}

/**
 * A node's position among its siblings: `{ index, count }`. `count > 1` marks a
 * branch point (render a ‹index+1/count› switcher). Missing node ⇒ `{0,0}`.
 */
export function siblingPosition<T>(
  nodes: TreeNode<T>[],
  nodeId: string,
): { index: number; count: number } {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return { index: 0, count: 0 };
  const sibs = childrenOf(nodes, node.parentId);
  return { index: Math.max(0, sibs.findIndex((s) => s.id === nodeId)), count: sibs.length };
}

/** Append a node (immutable). The caller mints the id + sets the parent. */
export function addNode<T>(nodes: TreeNode<T>[], node: TreeNode<T>): TreeNode<T>[] {
  return [...nodes, node];
}

/** Make `nodeId` the active branch at its parent → a new selection. */
export function selectBranch<T>(
  nodes: TreeNode<T>[],
  selection: Selection,
  nodeId: string,
): Selection {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return selection;
  return { ...selection, [keyFor(node.parentId)]: nodeId };
}

/**
 * Step the active branch at `nodeId`'s parent by `delta` (-1 prev / +1 next),
 * clamped into range → a new selection. Drives the switcher's ‹ ›.
 */
export function stepBranch<T>(
  nodes: TreeNode<T>[],
  selection: Selection,
  nodeId: string,
  delta: number,
): Selection {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return selection;
  const sibs = childrenOf(nodes, node.parentId);
  const i = sibs.findIndex((s) => s.id === nodeId);
  if (i < 0) return selection;
  const next = Math.max(0, Math.min(sibs.length - 1, i + delta));
  return { ...selection, [keyFor(node.parentId)]: sibs[next]!.id };
}

/**
 * Project the active path to a message array via `project` (drop nulls). This is
 * what gets sent to the model each turn — the active branch only, so switching
 * branches genuinely changes the conversation the model sees.
 */
export function activeMessages<T, M>(
  nodes: TreeNode<T>[],
  selection: Selection,
  project: (value: T) => M | null,
): M[] {
  const out: M[] = [];
  for (const node of activePath(nodes, selection)) {
    const m = project(node.value);
    if (m != null) out.push(m);
  }
  return out;
}
