// @ts-nocheck -- executed directly by node's test runner, outside the browser app.
import assert from "node:assert/strict";
import test from "node:test";

import {
  MIN_CANVAS_W,
  MIN_DOCK_W,
  MIN_WIN_H,
  MIN_WIN_W,
  applyResize,
  bringToFront,
  cascadeRect,
  clampDockWidth,
  clampRect,
  dockReservations,
  effectiveRect,
  gridArrange,
  hitTestSnapZone,
  hydrateLayout,
  minimizeWindow,
  openWindow,
  rectForZone,
  releaseDrag,
  serializeLayout,
  toggleWindow,
  topZ,
  unsnap,
} from "./windowing.ts";

const VP = { w: 1600, h: 900 };

const mkWin = (id, over = {}) => ({
  id,
  rect: { x: 100, y: 100, w: 600, h: 400 },
  z: 1,
  snap: null,
  dock: null,
  dockW: null,
  minimized: false,
  ...over,
});

// --- snap zones ---------------------------------------------------------

test("hitTestSnapZone maps edges to zones; open field is null", () => {
  assert.equal(hitTestSnapZone(800, 4, VP), "maximize");
  assert.equal(hitTestSnapZone(10, 450, VP), "left");
  assert.equal(hitTestSnapZone(1595, 450, VP), "right");
  assert.equal(hitTestSnapZone(800, 20, VP), "top");
  assert.equal(hitTestSnapZone(800, 890, VP), "bottom");
  assert.equal(hitTestSnapZone(800, 450, VP), null);
});

test("hitTestSnapZone corners: sides beat top/bottom, top strip beats sides", () => {
  assert.equal(hitTestSnapZone(10, 20, VP), "left");
  assert.equal(hitTestSnapZone(1595, 890, VP), "right");
  assert.equal(hitTestSnapZone(10, 2, VP), "maximize");
});

test("rectForZone tiles the viewport exactly (halves cover it, no gaps)", () => {
  const left = rectForZone("left", VP);
  const right = rectForZone("right", VP);
  assert.equal(left.w + right.w, VP.w);
  assert.equal(right.x, left.w);
  const top = rectForZone("top", VP);
  const bottom = rectForZone("bottom", VP);
  assert.equal(top.h + bottom.h, VP.h);
  assert.deepEqual(rectForZone("maximize", VP), { x: 0, y: 0, w: VP.w, h: VP.h });
});

test("rectForZone covers odd viewport sizes without off-by-one", () => {
  const vp = { w: 1601, h: 901 };
  const left = rectForZone("left", vp);
  const right = rectForZone("right", vp);
  assert.equal(left.w + right.w, vp.w);
});

// --- geometry -----------------------------------------------------------

test("clampRect shrinks oversized windows and pulls strays back inside", () => {
  const big = clampRect({ x: -50, y: -50, w: 5000, h: 5000 }, VP);
  assert.deepEqual(big, { x: 0, y: 0, w: VP.w, h: VP.h });
  const stray = clampRect({ x: 1500, y: 850, w: 600, h: 400 }, VP);
  assert.equal(stray.x + stray.w, VP.w);
  assert.equal(stray.y + stray.h, VP.h);
});

test("clampRect enforces minimum window size", () => {
  const tiny = clampRect({ x: 10, y: 10, w: 10, h: 10 }, VP);
  assert.equal(tiny.w, MIN_WIN_W);
  assert.equal(tiny.h, MIN_WIN_H);
});

test("applyResize east/south grow without moving the origin", () => {
  const r = applyResize({ x: 100, y: 100, w: 600, h: 400 }, "se", 50, 30);
  assert.deepEqual(r, { x: 100, y: 100, w: 650, h: 430 });
});

test("applyResize west/north keep the opposite edge anchored", () => {
  const r = applyResize({ x: 100, y: 100, w: 600, h: 400 }, "nw", 40, 20);
  assert.deepEqual(r, { x: 140, y: 120, w: 560, h: 380 });
  assert.equal(r.x + r.w, 700);
  assert.equal(r.y + r.h, 500);
});

test("applyResize stops at minimums even on the moving side", () => {
  const r = applyResize({ x: 100, y: 100, w: 300, h: 200 }, "w", 500, 0);
  assert.equal(r.w, MIN_WIN_W);
  assert.equal(r.x + r.w, 400);
});

// --- docking ------------------------------------------------------------

test("clampDockWidth keeps panels usable and leaves canvas room", () => {
  assert.equal(clampDockWidth(100, VP), MIN_DOCK_W);
  assert.equal(clampDockWidth(2000, VP), VP.w - MIN_CANVAS_W);
  assert.equal(clampDockWidth(500, VP), 500);
});

test("clampDockWidth on a tiny viewport still honours the panel minimum", () => {
  assert.equal(clampDockWidth(9999, { w: 500, h: 400 }), MIN_DOCK_W);
});

test("dockReservations takes the widest visible panel per side, skips minimized", () => {
  const wins = [
    mkWin("a", { dock: "right", dockW: 400 }),
    mkWin("b", { dock: "right", dockW: 500 }),
    mkWin("c", { dock: "left", dockW: 350, minimized: true }),
    mkWin("d"),
  ];
  assert.deepEqual(dockReservations(wins, VP), { left: 0, right: 500 });
});

test("effectiveRect reflects mode: dock pins to the side, snap fills its zone", () => {
  const docked = effectiveRect(mkWin("a", { dock: "right", dockW: 420 }), VP);
  assert.deepEqual(docked, { x: VP.w - 420, y: 0, w: 420, h: VP.h });
  const snapped = effectiveRect(mkWin("b", { snap: "left" }), VP);
  assert.deepEqual(snapped, rectForZone("left", VP));
  const floating = effectiveRect(mkWin("c"), VP);
  assert.deepEqual(floating, { x: 100, y: 100, w: 600, h: 400 });
});

// --- z-order ------------------------------------------------------------

test("bringToFront raises the target above all others", () => {
  const wins = [mkWin("a", { z: 1 }), mkWin("b", { z: 2 }), mkWin("c", { z: 3 })];
  const next = bringToFront(wins, "a");
  const a = next.find((w) => w.id === "a");
  assert.equal(a.z, 4);
  assert.equal(topZ(next), a.z);
});

test("bringToFront renormalizes runaway z counters while keeping order", () => {
  const wins = [mkWin("a", { z: 9_999 }), mkWin("b", { z: 10_000 })];
  const next = bringToFront(wins, "a");
  const zs = next.map((w) => w.z).sort((x, y) => x - y);
  assert.deepEqual(zs, [1, 2]);
  const a = next.find((w) => w.id === "a");
  const b = next.find((w) => w.id === "b");
  assert.ok(a.z > b.z, "raised window stays on top after renormalization");
});

// --- open / minimize / toggle -------------------------------------------

test("openWindow adds a cascaded window on top; reopening restores + raises", () => {
  let wins = openWindow([], "tasks", VP);
  wins = openWindow(wins, "notes", VP);
  assert.equal(wins.length, 2);
  const notes = wins.find((w) => w.id === "notes");
  assert.equal(notes.z, topZ(wins));
  wins = minimizeWindow(wins, "tasks");
  wins = openWindow(wins, "tasks", VP);
  const tasks = wins.find((w) => w.id === "tasks");
  assert.equal(wins.length, 2, "no duplicate window");
  assert.equal(tasks.minimized, false);
  assert.equal(tasks.z, topZ(wins));
});

test("cascadeRect staggers placements and stays inside the viewport", () => {
  const r0 = cascadeRect(0, VP);
  const r1 = cascadeRect(1, VP);
  assert.equal(r1.x - r0.x, 32);
  assert.equal(r1.y - r0.y, 32);
  for (let i = 0; i < 60; i++) {
    const r = cascadeRect(i, VP);
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= VP.w && r.y + r.h <= VP.h, `index ${i} in view`);
  }
});

test("toggleWindow: open → raise (behind) → minimize (frontmost) → restore", () => {
  assert.equal(toggleWindow([], "x").action, "open");

  let wins = [mkWin("a", { z: 1 }), mkWin("b", { z: 2 })];
  let res = toggleWindow(wins, "a");
  assert.equal(res.action, "raise");
  assert.equal(res.wins.find((w) => w.id === "a").z, topZ(res.wins));

  res = toggleWindow(res.wins, "a");
  assert.equal(res.action, "minimize");
  assert.equal(res.wins.find((w) => w.id === "a").minimized, true);

  res = toggleWindow(res.wins, "a");
  assert.equal(res.action, "restore");
  const a = res.wins.find((w) => w.id === "a");
  assert.equal(a.minimized, false);
  assert.equal(a.z, topZ(res.wins));
});

test("toggleWindow ignores minimized windows when deciding frontmost", () => {
  const wins = [mkWin("a", { z: 1 }), mkWin("b", { z: 2, minimized: true })];
  const res = toggleWindow(wins, "a");
  assert.equal(res.action, "minimize");
});

// --- drag release / unsnap ----------------------------------------------

test("releaseDrag in the open field floats at the dragged rect", () => {
  const dragged = { x: 300, y: 200, w: 600, h: 400 };
  const win = releaseDrag(mkWin("a", { snap: "left" }), null, dragged);
  assert.equal(win.snap, null);
  assert.deepEqual(win.rect, dragged);
});

test("releaseDrag into a zone snaps but preserves the restore rect", () => {
  const before = mkWin("a");
  const win = releaseDrag(before, "maximize", { x: 0, y: 0, w: 900, h: 700 });
  assert.equal(win.snap, "maximize");
  assert.deepEqual(win.rect, before.rect, "restore target untouched");
});

test("releaseDrag side zone becomes a dock when asDock is set", () => {
  const win = releaseDrag(mkWin("a"), "right", { x: 0, y: 0, w: 1, h: 1 }, { asDock: true });
  assert.equal(win.dock, "right");
  assert.equal(win.snap, null);
});

test("unsnap clears snap and dock, keeping the floating rect", () => {
  const win = unsnap(mkWin("a", { snap: "left", dock: null }));
  assert.equal(win.snap, null);
  assert.equal(win.dock, null);
  assert.deepEqual(win.rect, { x: 100, y: 100, w: 600, h: 400 });
});

// --- arrange ---------------------------------------------------------------

test("gridArrange tiles N windows inside the viewport without overlap", () => {
  for (const n of [1, 2, 3, 4, 5, 7]) {
    const rects = gridArrange(n, VP, { top: 48 });
    assert.equal(rects.length, n);
    for (const r of rects) {
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= VP.w && r.y + r.h <= VP.h, `n=${n} in view`);
      assert.ok(r.y >= 48 - 1, `n=${n} respects top headroom`);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const overlap =
          a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        assert.ok(!overlap, `n=${n}: rects ${i} and ${j} overlap`);
      }
    }
  }
});

test("gridArrange returns empty for zero and enforces minimum sizes", () => {
  assert.deepEqual(gridArrange(0, VP), []);
  const rects = gridArrange(9, { w: 700, h: 500 });
  for (const r of rects) {
    assert.ok(r.w >= MIN_WIN_W || r.w <= 700);
    assert.ok(r.h >= MIN_WIN_H || r.h <= 500);
  }
});

// --- persistence ----------------------------------------------------------

test("serialize→hydrate round-trips windows with compacted z", () => {
  const wins = [
    mkWin("a", { z: 7, snap: "left" }),
    mkWin("b", { z: 3, dock: "right", dockW: 450, minimized: true }),
  ];
  const restored = hydrateLayout(serializeLayout(wins), VP);
  assert.equal(restored.length, 2);
  const a = restored.find((w) => w.id === "a");
  const b = restored.find((w) => w.id === "b");
  assert.equal(a.snap, "left");
  assert.equal(b.dock, "right");
  assert.equal(b.dockW, 450);
  assert.equal(b.minimized, true);
  assert.ok(a.z > b.z, "stacking order preserved");
});

test("hydrateLayout re-clamps rects to a smaller viewport", () => {
  const layout = serializeLayout([mkWin("a", { rect: { x: 1200, y: 700, w: 800, h: 600 } })]);
  const [win] = hydrateLayout(layout, { w: 1000, h: 600 });
  assert.ok(win.rect.x + win.rect.w <= 1000);
  assert.ok(win.rect.y + win.rect.h <= 600);
});

test("hydrateLayout drops malformed entries, duplicates, and junk input", () => {
  assert.deepEqual(hydrateLayout(null, VP), []);
  assert.deepEqual(hydrateLayout({ v: 2, wins: [] }, VP), []);
  assert.deepEqual(hydrateLayout({ v: 1, wins: "nope" }, VP), []);
  const restored = hydrateLayout(
    {
      v: 1,
      wins: [
        mkWin("ok"),
        { id: "no-rect", z: 1 },
        { id: "", rect: { x: 0, y: 0, w: 300, h: 300 } },
        mkWin("ok"),
        mkWin("bad-zone", { snap: "diagonal", dock: "up", dockW: Number.NaN }),
      ],
    },
    VP,
  );
  assert.deepEqual(
    restored.map((w) => w.id),
    ["ok", "bad-zone"],
  );
  const bad = restored.find((w) => w.id === "bad-zone");
  assert.equal(bad.snap, null);
  assert.equal(bad.dock, null);
  assert.equal(bad.dockW, null);
});
