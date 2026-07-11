/** FloatingWindow — chrome around one pane in the windowed workspace
 *  (PLAN-odysseus-feel.md, W1 + W2). Positions the pane at its WinState rect
 *  and owns the move/resize gestures. Gestures mutate the wrapper style
 *  directly (no React state per pointermove — heavy panes like terminals must
 *  not re-render mid-drag) and commit on release; React's style diff won't
 *  fight the transient values because its last-known props are unchanged
 *  until the commit re-render lands the same numbers.
 *
 *  W2 gesture vocabulary:
 *  - while a header-drag is armed, every pointermove is reported upward
 *    (`onMovePointer`) so WindowLayer can hit-test snap zones and paint the
 *    ghost preview; release goes through `onCommitMove` with the dragged rect
 *    and the pointer, and WindowLayer resolves zone → snap/dock/float.
 *  - dragging a SNAPPED/DOCKED window un-parks it: the drag base becomes the
 *    remembered floating rect, centered under the pointer (Windows-style).
 *  - a DOCKED panel only exposes its inner edge, which resizes the dock width
 *    (`onCommitDockW`) instead of the floating rect.
 *
 *  The MOVE handle is the pane's own title strip: PaneCard already exposes a
 *  header pointerdown (`onPaneDragStart`, the grid's reorder handle) — in
 *  windowed mode App routes it to the `startMove` this component hands back
 *  through its render-prop children.
 *
 *  Known caveat (same as pane-maximize): native-webview panes (browser/
 *  appcast) paint ABOVE html, so an HTML window overlapping one is occluded
 *  regardless of z-index.
 */
import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";

import { m } from "motion/react";

import { windowPop } from "./fx/motionTokens";
import {
  applyResize,
  clampDockWidth,
  clampRect,
  effectiveRect,
  type Rect,
  type ResizeEdge,
  type Viewport,
  type WinState,
} from "../lib/windowing";
import { setWindowGesture } from "../lib/paneBus";

const MOVE_THRESHOLD_PX = 5;

const HANDLES: { edge: ResizeEdge; className: string; cursor: string }[] = [
  { edge: "n", className: "top-0 right-2.5 left-2.5 h-1.5", cursor: "ns-resize" },
  { edge: "s", className: "right-2.5 bottom-0 left-2.5 h-1.5", cursor: "ns-resize" },
  { edge: "w", className: "top-2.5 bottom-2.5 left-0 w-1.5", cursor: "ew-resize" },
  { edge: "e", className: "top-2.5 right-0 bottom-2.5 w-1.5", cursor: "ew-resize" },
  { edge: "nw", className: "top-0 left-0 h-3 w-3", cursor: "nwse-resize" },
  { edge: "se", className: "right-0 bottom-0 h-3 w-3", cursor: "nwse-resize" },
  { edge: "ne", className: "top-0 right-0 h-3 w-3", cursor: "nesw-resize" },
  { edge: "sw", className: "bottom-0 left-0 h-3 w-3", cursor: "nesw-resize" },
];

/** Pointer-capture a gesture on `el` and stream deltas until release. The
 *  capture keeps moves flowing even when the pointer crosses native webviews
 *  (the same trick as the grid's reorder drag). */
function trackGesture(
  el: HTMLElement,
  pointerId: number,
  cursor: string,
  onDelta: (dx: number, dy: number, ev: PointerEvent) => void,
  onEnd: (commit: boolean, ev: PointerEvent) => void,
  startX: number,
  startY: number,
) {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    /* capture is best-effort */
  }
  document.body.style.cursor = cursor;
  document.body.style.userSelect = "none";
  window.getSelection()?.removeAllRanges();
  const onMove = (ev: PointerEvent) => onDelta(ev.clientX - startX, ev.clientY - startY, ev);
  const finish = (commit: boolean) => (ev: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    try {
      el.releasePointerCapture(pointerId);
    } catch {
      /* already released */
    }
    onEnd(commit, ev);
  };
  const onUp = finish(true);
  const onCancel = finish(false);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
}

export function FloatingWindow({
  win,
  vp,
  active,
  hidden,
  onActivate,
  onCommitRect,
  onCommitMove,
  onMovePointer,
  onCommitDockW,
  children,
}: {
  win: WinState;
  vp: Viewport;
  active: boolean;
  /** Minimized (App's hiddenKeys): stay mounted, out of view. */
  hidden: boolean;
  onActivate: () => void;
  /** Resize commit (floating windows). */
  onCommitRect: (rect: Rect) => void;
  /** Move commit — WindowLayer resolves the armed snap zone. */
  onCommitMove: (dragged: Rect, clientX: number, clientY: number) => void;
  /** Armed-move pointer stream — drives the snap-zone ghost. */
  onMovePointer: (clientX: number, clientY: number) => void;
  /** Dock-width commit (docked panels resize their inner edge only). */
  onCommitDockW: (width: number) => void;
  /** Render-prop: the pane content, handed the move-starter to wire into its
   *  title strip (PaneCard's onPaneDragStart). */
  children: (startMove: (e: ReactPointerEvent<HTMLElement>) => void) => ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  // Rect under a live gesture (null = at rest). Also the commit source.
  const gestureRef = useRef<Rect | null>(null);

  const rect = effectiveRect(win, vp);
  const parked = win.snap != null || win.dock != null;

  const paint = (r: Rect) => {
    const el = rootRef.current;
    if (!el) return;
    el.style.left = `${r.x}px`;
    el.style.top = `${r.y}px`;
    el.style.width = `${r.w}px`;
    el.style.height = `${r.h}px`;
  };

  /** 1:1 pointer tracking during a gesture; geometry GLIDES otherwise (snap /
   *  dock / arrange commits animate from wherever the hand let go). */
  const setGliding = (on: boolean) => {
    const el = rootRef.current;
    if (el) el.style.transition = on ? "" : "none";
  };

  const startMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const strip = e.currentTarget;
    // Container-local pointer position (rect is local; the event is viewport).
    const rootRect = rootRef.current?.getBoundingClientRect();
    const localX = rootRect ? rect.x + (e.clientX - rootRect.left) : e.clientX;
    const localY = rootRect ? rect.y + (e.clientY - rootRect.top) : e.clientY;
    // Dragging a parked window un-parks it: the base becomes the remembered
    // floating rect, centered under the pointer.
    const base = parked
      ? clampRect(
          { x: localX - win.rect.w / 2, y: localY - 14, w: win.rect.w, h: win.rect.h },
          vp,
        )
      : { ...rect };
    let armed = false;
    trackGesture(
      strip,
      e.pointerId,
      "grabbing",
      (dx, dy, ev) => {
        if (!armed && Math.hypot(dx, dy) < MOVE_THRESHOLD_PX) return;
        if (!armed) {
          armed = true;
          // native-webview panes hide for the drag — chasing the chrome over
          // IPC ghosts visibly (browser pane), and they'd paint over the snap
          // ghost anyway.
          setWindowGesture(true);
        }
        setGliding(false);
        gestureRef.current = clampRect({ ...base, x: base.x + dx, y: base.y + dy }, vp);
        paint(gestureRef.current);
        onMovePointer(ev.clientX, ev.clientY);
      },
      (commit, ev) => {
        const r = gestureRef.current;
        gestureRef.current = null;
        setGliding(true);
        if (armed) setWindowGesture(false);
        if (r && commit) onCommitMove(r, ev.clientX, ev.clientY);
        else {
          paint(rect);
          // clear any armed ghost
          onCommitMove(rect, Number.NaN, Number.NaN);
        }
      },
      e.clientX,
      e.clientY,
    );
  };

  const startResize = (edge: ResizeEdge, cursor: string) => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onActivate();
    const handle = e.currentTarget;
    const base = { ...rect };
    trackGesture(
      handle,
      e.pointerId,
      cursor,
      (dx, dy) => {
        setGliding(false);
        if (win.dock) {
          // docked panel: only the inner edge arrives here — resize the width,
          // keeping the panel pinned to its screen edge.
          const w = clampDockWidth(win.dock === "left" ? base.w + dx : base.w - dx, vp);
          gestureRef.current = {
            x: win.dock === "left" ? 0 : vp.w - w,
            y: 0,
            w,
            h: vp.h,
          };
        } else {
          gestureRef.current = clampRect(applyResize(base, edge, dx, dy), vp);
        }
        paint(gestureRef.current);
      },
      (commit) => {
        const r = gestureRef.current;
        gestureRef.current = null;
        setGliding(true);
        if (r && commit) {
          if (win.dock) onCommitDockW(r.w);
          else onCommitRect(r);
        } else paint(rect);
      },
      e.clientX,
      e.clientY,
    );
  };

  // Docked panels expose only their inner edge (the one facing the canvas).
  const handles = win.dock
    ? HANDLES.filter((h) => h.edge === (win.dock === "left" ? "e" : "w"))
    : HANDLES;

  return (
    // m.div: a spring pop-in on open / shrink-out on close (windowPop), scale +
    // opacity ONLY — the gesture owns left/top/width/height, so motion and the
    // drag never write the same properties. `layout` is intentionally OFF (it
    // would fight the direct-style gesture writes).
    <m.div
      ref={rootRef}
      {...windowPop()}
      onPointerDownCapture={onActivate}
      className={`pointer-events-auto absolute transition-[left,top,width,height,box-shadow] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        win.dock ? "" : "rounded-lg"
      } ${
        active
          ? "shadow-[0_24px_60px_-16px_rgba(0,0,0,0.6)]"
          : "shadow-[0_12px_36px_-18px_rgba(0,0,0,0.45)]"
      }`}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        zIndex: win.z,
        display: hidden ? "none" : undefined,
      }}
    >
      <div className="h-full w-full [&>*]:h-full [&>*]:w-full">{children(startMove)}</div>
      {handles.map((h) => (
        <div
          key={h.edge}
          onPointerDown={startResize(h.edge, h.cursor)}
          className={`absolute z-10 ${h.className}`}
          style={{ cursor: h.cursor, touchAction: "none" }}
        />
      ))}
    </m.div>
  );
}
