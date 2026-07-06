/** WindowLayer — the windowed-workspace renderer (PLAN-odysseus-feel.md,
 *  W1 + W2). Swaps in for ResizableGrid behind Settings → "Windowed workspace
 *  (beta)": the same Pane list, but each pane floats in a FloatingWindow
 *  positioned by the pure engine in lib/windowing.ts. Owns the WinState list,
 *  viewport measurement, z-order, layout persistence — and the W2 gesture
 *  brain: snap-zone hit-testing, the translucent ghost preview, snap/dock
 *  commits, and the dock reservations that push the chat canvas aside.
 *
 *  Zone → outcome (release of a header drag):
 *    top strip  → maximize (snap)
 *    top band   → top half (snap)
 *    bottom     → bottom half (snap)
 *    left/right → DOCK: a full-height side panel that RESERVES canvas room
 *                 (`onDockChange` feeds the insets to App).
 *  Anywhere else floats at the dragged rect. Dragging a parked window pulls
 *  it back to its floating size (FloatingWindow handles the base swap).
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";

import {
  bringToFront,
  clampDockWidth,
  clampRect,
  dockReservations,
  gridArrange,
  hitTestSnapZone,
  hydrateLayout,
  openWindow,
  rectForZone,
  releaseDrag,
  serializeLayout,
  type Rect,
  type SnapZone,
  type Viewport,
  type WinState,
} from "../lib/windowing";
import { FloatingWindow } from "./FloatingWindow";

function readLayout(storageKey: string, vp: Viewport): WinState[] {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? hydrateLayout(JSON.parse(raw), vp) : [];
  } catch {
    return [];
  }
}

function writeLayout(storageKey: string, wins: WinState[]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(serializeLayout(wins)));
  } catch {
    /* quota / unavailable */
  }
}

const rectsEqual = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

export function WindowLayer({
  paneKeys,
  hiddenKeys,
  activeKey,
  storageKey,
  arrangeNonce = 0,
  onActivate,
  onDockChange,
  renderPane,
}: {
  paneKeys: string[];
  hiddenKeys: string[];
  /** The focused pane — raised whenever it changes (spawn, palette, click). */
  activeKey: string | null;
  storageKey: string;
  /** bump to tile all visible windows into an even grid (the app-level
   *  "arrange" button lives outside this layer's stacking context). */
  arrangeNonce?: number;
  onActivate: (key: string) => void;
  /** Live dock reservations (px per side) — App insets the chat canvas. */
  onDockChange?: (insets: { left: number; right: number }) => void;
  renderPane: (
    key: string,
    startMove: (e: ReactPointerEvent<HTMLElement>) => void,
  ) => ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // null until first measure — windows can't be placed without a viewport.
  const [vp, setVp] = useState<Viewport | null>(null);
  // null until hydrated (needs vp) — distinguishes "not loaded" from "empty".
  const [wins, setWins] = useState<WinState[] | null>(null);
  // snap-zone ghost preview while a header drag hovers a zone.
  const [ghost, setGhost] = useState<Rect | null>(null);
  const zoneRef = useRef<SnapZone | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setVp((cur) => (cur && cur.w === r.width && cur.h === r.height ? cur : { w: r.width, h: r.height }));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Reconcile windows with the pane list: hydrate once, drop closed panes,
  // open new ones (cascaded, on top), re-clamp everything to the viewport.
  const keysJoined = paneKeys.join(" ");
  useEffect(() => {
    if (!vp) return;
    setWins((cur) => {
      let ws = cur ?? readLayout(storageKey, vp);
      const alive = new Set(paneKeys);
      ws = ws.filter((w) => alive.has(w.id));
      for (const key of paneKeys) {
        if (!ws.some((w) => w.id === key)) ws = openWindow(ws, key, vp);
      }
      let clamped = false;
      ws = ws.map((w) => {
        const rect = clampRect(w.rect, vp);
        if (rectsEqual(rect, w.rect)) return w;
        clamped = true;
        return { ...w, rect };
      });
      // Object identity matters: an unchanged list must not churn re-renders.
      if (cur && !clamped && ws.length === cur.length && ws.every((w, i) => w === cur[i])) return cur;
      return ws;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vp, keysJoined, storageKey]);

  useEffect(() => {
    if (wins) writeLayout(storageKey, wins);
  }, [wins, storageKey]);

  // Dock reservations → App (the chat canvas insets itself). Minimized panels
  // release their reservation (our minimize = App's hiddenKeys, not the
  // engine's flag, so mirror it in before asking the engine).
  const hiddenJoined = hiddenKeys.join(" ");
  useEffect(() => {
    if (!wins || !vp || !onDockChange) return;
    const hidden = new Set(hiddenKeys);
    const res = dockReservations(
      wins.map((w) => (hidden.has(w.id) ? { ...w, minimized: true } : w)),
      vp,
    );
    onDockChange(res);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wins, vp, hiddenJoined]);

  // One-click ARRANGE: tile every visible window into an even grid, in
  // stacking order (topmost first = top-left), un-parking snaps/docks. The
  // glide transition on each window animates the shuffle.
  useEffect(() => {
    if (!arrangeNonce || !vp) return;
    setWins((cur) => {
      if (!cur) return cur;
      const hidden = new Set(hiddenKeys);
      const visible = cur
        .filter((w) => paneKeys.includes(w.id) && !hidden.has(w.id))
        .sort((a, b) => b.z - a.z);
      if (visible.length === 0) return cur;
      const rects = gridArrange(visible.length, vp, { top: 48 });
      const rectById = new Map(visible.map((w, i) => [w.id, rects[i]]));
      return cur.map((w) => {
        const rect = rectById.get(w.id);
        return rect ? { ...w, rect, snap: null, dock: null } : w;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrangeNonce]);

  // Focus (from any path — click, spawn, palette) raises the window.
  useEffect(() => {
    if (!activeKey) return;
    setWins((cur) => (cur?.some((w) => w.id === activeKey) ? bringToFront(cur, activeKey) : cur));
  }, [activeKey]);

  const commitRect = (id: string, rect: Rect) => {
    setWins((cur) => cur && cur.map((w) => (w.id === id ? { ...w, rect, snap: null, dock: null } : w)));
  };

  const commitDockW = (id: string, width: number) => {
    setWins(
      (cur) =>
        cur &&
        cur.map((w) => (w.id === id && vp ? { ...w, dockW: clampDockWidth(width, vp) } : w)),
    );
  };

  /** Viewport → container-local coords (the engine speaks local). */
  const toLocal = (clientX: number, clientY: number) => {
    const r = containerRef.current?.getBoundingClientRect();
    return { x: clientX - (r?.left ?? 0), y: clientY - (r?.top ?? 0) };
  };

  const movePointer = (clientX: number, clientY: number) => {
    if (!vp) return;
    const { x, y } = toLocal(clientX, clientY);
    const zone = hitTestSnapZone(x, y, vp);
    if (zone !== zoneRef.current) {
      zoneRef.current = zone;
      setGhost(zone ? rectForZone(zone, vp) : null);
    }
  };

  const commitMove = (id: string, dragged: Rect, clientX: number, _clientY: number) => {
    const zone = Number.isNaN(clientX) ? null : zoneRef.current;
    zoneRef.current = null;
    setGhost(null);
    if (Number.isNaN(clientX)) return; // cancelled drag — just clear the ghost
    setWins((cur) => {
      if (!cur) return cur;
      const next = cur.map((w) =>
        w.id === id
          ? releaseDrag(w, zone, dragged, { asDock: zone === "left" || zone === "right" })
          : w,
      );
      return bringToFront(next, id);
    });
  };

  return (
    // pointer-events-none: this layer spans the whole workspace ABOVE the chat
    // canvas — only the windows themselves may catch input, or the canvas
    // underneath is dead to clicks/typing everywhere.
    // `isolate` traps the windows' ever-growing z counters inside this layer,
    // so canvas chrome (strip / toggle / tray, z-30 siblings) always wins.
    <div ref={containerRef} className="pointer-events-none absolute inset-0 isolate overflow-hidden">
      {/* snap-zone ghost — where the window will land if released here */}
      {ghost && (
        <div
          aria-hidden
          className="absolute z-[9998] rounded-lg border-2 border-[var(--color-accent)]/50 bg-[var(--color-accent-soft)]/45 backdrop-blur-[2px] transition-all duration-150 ease-out"
          style={{ left: ghost.x, top: ghost.y, width: ghost.w, height: ghost.h }}
        />
      )}
      {vp &&
        wins?.map((win) => {
          if (!paneKeys.includes(win.id)) return null;
          return (
            <FloatingWindow
              key={win.id}
              win={win}
              vp={vp}
              active={activeKey === win.id}
              hidden={hiddenKeys.includes(win.id)}
              onActivate={() => onActivate(win.id)}
              onCommitRect={(rect) => commitRect(win.id, rect)}
              onCommitMove={(dragged, cx, cy) => commitMove(win.id, dragged, cx, cy)}
              onMovePointer={movePointer}
              onCommitDockW={(w) => commitDockW(win.id, w)}
            >
              {(startMove) => renderPane(win.id, startMove)}
            </FloatingWindow>
          );
        })}
    </div>
  );
}
