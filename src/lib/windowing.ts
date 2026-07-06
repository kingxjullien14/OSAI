/**
 * windowing.ts — pure window-manager engine for the windowed workspace
 * (PLAN-odysseus-feel.md, W0). No DOM: geometry, snap zones, z-order,
 * docking and (de)serialization only, so the whole interaction vocabulary
 * is unit-testable. WindowLayer/FloatingWindow (W1) render this state.
 *
 * Vocabulary (clean-room from studying Odysseus's behavior, not its code):
 *  - a window FLOATS at `rect`, which is also the restore target while
 *    snapped/docked/minimized — gestures never lose the pre-gesture size;
 *  - dragging near an edge SNAPS to a half / maximize (ghost preview in W2);
 *  - dragging hard into a side edge DOCKS it as a panel that reserves
 *    workspace room; dock width is remembered per window;
 *  - minimize hides but preserves everything; close is teardown (the pane
 *    list, not this engine, owns closing).
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Viewport {
  w: number;
  h: number;
}

export type SnapZone = "maximize" | "left" | "right" | "top" | "bottom";
export type DockSide = "left" | "right";
export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export interface WinState {
  id: string;
  /** Floating geometry; the restore target while snapped/docked/minimized. */
  rect: Rect;
  z: number;
  snap: SnapZone | null;
  dock: DockSide | null;
  /** Remembered docked-panel width; null until first dock resize. */
  dockW: number | null;
  minimized: boolean;
}

export const MIN_WIN_W = 280;
export const MIN_WIN_H = 180;
/** Within this distance of a side/bottom edge a header-drag arms a snap. */
export const SNAP_EDGE_PX = 24;
/** Top strip that means "maximize" (smaller: it's easy to hit precisely). */
export const SNAP_TOP_MAX_PX = 8;
/** Docked panels never get narrower than this... */
export const MIN_DOCK_W = 320;
/** ...and never squeeze the remaining canvas below this. */
export const MIN_CANVAS_W = 380;
/** Renormalize z once the top window passes this (keeps numbers small). */
const Z_RENORM_AT = 10_000;
/** Cascade step for default placement of freshly opened windows. */
const CASCADE_PX = 32;

/** Snap zone armed by a header-drag at pointer (x, y), or null in the open
 *  field. Side edges win over the top/bottom bands at corners — users aiming
 *  broadly for "left half" drift through the corner more often than they
 *  mean "top half". */
export function hitTestSnapZone(x: number, y: number, vp: Viewport): SnapZone | null {
  if (y <= SNAP_TOP_MAX_PX) return "maximize";
  if (x <= SNAP_EDGE_PX) return "left";
  if (x >= vp.w - SNAP_EDGE_PX) return "right";
  if (y <= SNAP_EDGE_PX) return "top";
  if (y >= vp.h - SNAP_EDGE_PX) return "bottom";
  return null;
}

export function rectForZone(zone: SnapZone, vp: Viewport): Rect {
  const halfW = Math.round(vp.w / 2);
  const halfH = Math.round(vp.h / 2);
  switch (zone) {
    case "maximize":
      return { x: 0, y: 0, w: vp.w, h: vp.h };
    case "left":
      return { x: 0, y: 0, w: halfW, h: vp.h };
    case "right":
      return { x: halfW, y: 0, w: vp.w - halfW, h: vp.h };
    case "top":
      return { x: 0, y: 0, w: vp.w, h: halfH };
    case "bottom":
      return { x: 0, y: halfH, w: vp.w, h: vp.h - halfH };
  }
}

/** The rect a window actually occupies given its mode. */
export function effectiveRect(win: WinState, vp: Viewport): Rect {
  if (win.dock) {
    const w = clampDockWidth(win.dockW ?? win.rect.w, vp);
    return win.dock === "left"
      ? { x: 0, y: 0, w, h: vp.h }
      : { x: vp.w - w, y: 0, w, h: vp.h };
  }
  if (win.snap) return rectForZone(win.snap, vp);
  return win.rect;
}

/** Shrink-to-fit then keep the window inside the viewport. */
export function clampRect(rect: Rect, vp: Viewport): Rect {
  const w = Math.max(MIN_WIN_W, Math.min(rect.w, vp.w));
  const h = Math.max(MIN_WIN_H, Math.min(rect.h, vp.h));
  const x = Math.max(0, Math.min(rect.x, vp.w - w));
  const y = Math.max(0, Math.min(rect.y, vp.h - h));
  return { x, y, w, h };
}

/** Resize from any edge/corner. The opposite edge stays put; mins are
 *  enforced by giving the delta back on the dragged side. */
export function applyResize(rect: Rect, edge: ResizeEdge, dx: number, dy: number): Rect {
  let { x, y, w, h } = rect;
  if (edge.includes("e")) w = Math.max(MIN_WIN_W, w + dx);
  if (edge.includes("w")) {
    const newW = Math.max(MIN_WIN_W, w - dx);
    x += w - newW;
    w = newW;
  }
  if (edge.includes("s")) h = Math.max(MIN_WIN_H, h + dy);
  if (edge.includes("n")) {
    const newH = Math.max(MIN_WIN_H, h - dy);
    y += h - newH;
    h = newH;
  }
  return { x, y, w, h };
}

export function clampDockWidth(w: number, vp: Viewport): number {
  const max = Math.max(MIN_DOCK_W, vp.w - MIN_CANVAS_W);
  return Math.max(MIN_DOCK_W, Math.min(w, max));
}

/** Total horizontal room reserved by visible docked panels, per side —
 *  drives the `--dock-left-w` / `--dock-right-w` workspace insets. */
export function dockReservations(wins: WinState[], vp: Viewport): { left: number; right: number } {
  const out = { left: 0, right: 0 };
  for (const win of wins) {
    if (!win.dock || win.minimized) continue;
    const w = clampDockWidth(win.dockW ?? win.rect.w, vp);
    out[win.dock] = Math.max(out[win.dock], w);
  }
  return out;
}

export function topZ(wins: WinState[]): number {
  return wins.reduce((m, w) => Math.max(m, w.z), 0);
}

/** Raise a window above everything else, renormalizing to 1..n once the
 *  counter drifts high so persisted z values stay small. */
export function bringToFront(wins: WinState[], id: string): WinState[] {
  const top = topZ(wins);
  let next = wins.map((w) => (w.id === id ? { ...w, z: top + 1 } : w));
  if (top + 1 > Z_RENORM_AT) {
    const order = [...next].sort((a, b) => a.z - b.z);
    next = next.map((w) => ({ ...w, z: order.indexOf(w) + 1 }));
  }
  return next;
}

/** Default placement for the i-th opened window: centered, cascading down-right,
 *  wrapped back into view. */
export function cascadeRect(index: number, vp: Viewport): Rect {
  const w = Math.min(Math.max(MIN_WIN_W, Math.round(vp.w * 0.5)), vp.w);
  const h = Math.min(Math.max(MIN_WIN_H, Math.round(vp.h * 0.6)), vp.h);
  const baseX = Math.round((vp.w - w) / 2);
  const baseY = Math.round((vp.h - h) / 2);
  const span = Math.max(1, Math.floor(Math.min(vp.w - w, vp.h - h) / CASCADE_PX) + 1);
  const step = (index % span) * CASCADE_PX;
  return clampRect({ x: baseX + step, y: baseY + step, w, h }, vp);
}

export function openWindow(wins: WinState[], id: string, vp: Viewport, rect?: Rect): WinState[] {
  const existing = wins.find((w) => w.id === id);
  if (existing) {
    return bringToFront(
      wins.map((w) => (w.id === id ? { ...w, minimized: false } : w)),
      id,
    );
  }
  const win: WinState = {
    id,
    rect: rect ? clampRect(rect, vp) : cascadeRect(wins.length, vp),
    z: topZ(wins) + 1,
    snap: null,
    dock: null,
    dockW: null,
    minimized: false,
  };
  return [...wins, win];
}

export function minimizeWindow(wins: WinState[], id: string): WinState[] {
  return wins.map((w) => (w.id === id ? { ...w, minimized: true } : w));
}

/** Rail-icon click semantics: absent → caller opens; minimized → restore;
 *  open but behind → raise; open and frontmost → minimize. */
export function toggleWindow(
  wins: WinState[],
  id: string,
): { wins: WinState[]; action: "open" | "restore" | "raise" | "minimize" } {
  const win = wins.find((w) => w.id === id);
  if (!win) return { wins, action: "open" };
  if (win.minimized) {
    return {
      wins: bringToFront(wins.map((w) => (w.id === id ? { ...w, minimized: false } : w)), id),
      action: "restore",
    };
  }
  const frontmost = wins.filter((w) => !w.minimized).every((w) => w.z <= win.z);
  if (!frontmost) return { wins: bringToFront(wins, id), action: "raise" };
  return { wins: minimizeWindow(wins, id), action: "minimize" };
}

/** Header-drag release: enter the armed zone (side zones become docks when
 *  `asDock`), or float at the dragged position. `rect` (the restore target)
 *  is untouched by snap/dock so dragging away restores the old size. */
export function releaseDrag(
  win: WinState,
  zone: SnapZone | null,
  dragged: Rect,
  opts: { asDock?: boolean } = {},
): WinState {
  if (zone === "left" || zone === "right") {
    if (opts.asDock) return { ...win, snap: null, dock: zone };
    return { ...win, snap: zone, dock: null };
  }
  if (zone) return { ...win, snap: zone, dock: null };
  return { ...win, snap: null, dock: null, rect: dragged };
}

/** Any drag on a snapped/docked window un-snaps it back to its floating rect
 *  (re-centered under the pointer by the chrome; the engine just clears modes). */
export function unsnap(win: WinState): WinState {
  return { ...win, snap: null, dock: null };
}

/** Tile `count` windows into an even grid across the viewport — the one-click
 *  "arrange" that untangles a messy pile of floating windows. Returns rects in
 *  reading order (callers map them onto windows sorted by stacking). `top`
 *  reserves headroom for canvas chrome (the tab strip). */
export function gridArrange(
  count: number,
  vp: Viewport,
  opts: { margin?: number; gap?: number; top?: number } = {},
): Rect[] {
  if (count <= 0) return [];
  const margin = opts.margin ?? 10;
  const gap = opts.gap ?? 10;
  const top = opts.top ?? margin;
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const w = Math.max(MIN_WIN_W, Math.floor((vp.w - margin * 2 - gap * (cols - 1)) / cols));
  const h = Math.max(MIN_WIN_H, Math.floor((vp.h - top - margin - gap * (rows - 1)) / rows));
  return Array.from({ length: count }, (_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return clampRect({ x: margin + col * (w + gap), y: top + row * (h + gap), w, h }, vp);
  });
}

// ---------------------------------------------------------------------------
// Persistence

export interface WindowLayout {
  v: 1;
  wins: WinState[];
}

export function serializeLayout(wins: WinState[]): WindowLayout {
  const order = [...wins].sort((a, b) => a.z - b.z);
  return { v: 1, wins: order.map((w, i) => ({ ...w, z: i + 1 })) };
}

const SNAP_ZONES: readonly SnapZone[] = ["maximize", "left", "right", "top", "bottom"];

function isRect(r: unknown): r is Rect {
  if (!r || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  return ["x", "y", "w", "h"].every((k) => typeof o[k] === "number" && Number.isFinite(o[k] as number));
}

/** Restore a persisted layout, dropping malformed entries and re-clamping
 *  rects to the (possibly different) current viewport. */
export function hydrateLayout(data: unknown, vp: Viewport): WinState[] {
  if (!data || typeof data !== "object" || (data as WindowLayout).v !== 1) return [];
  const raw = (data as WindowLayout).wins;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: WinState[] = [];
  for (const w of raw) {
    if (!w || typeof w !== "object") continue;
    if (typeof w.id !== "string" || !w.id || seen.has(w.id)) continue;
    if (!isRect(w.rect)) continue;
    seen.add(w.id);
    out.push({
      id: w.id,
      rect: clampRect(w.rect, vp),
      z: out.length + 1,
      snap: SNAP_ZONES.includes(w.snap as SnapZone) ? (w.snap as SnapZone) : null,
      dock: w.dock === "left" || w.dock === "right" ? w.dock : null,
      dockW: typeof w.dockW === "number" && Number.isFinite(w.dockW) ? clampDockWidth(w.dockW, vp) : null,
      minimized: w.minimized === true,
    });
  }
  return out;
}
