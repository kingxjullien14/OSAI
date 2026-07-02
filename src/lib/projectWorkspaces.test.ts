// @ts-nocheck -- executed directly by node's test runner, outside the browser app.
import assert from "node:assert/strict";
import test from "node:test";

import {
  normRoot,
  basename,
  joinPath,
  hashRoot,
  inferRole,
  supersedesBase,
  stackToKind,
  kindToStack,
  primaryComponent,
  allComponents,
  projectShapeLabel,
  workspaceToProjectInfo,
  projectInfoToWorkspace,
  migrateProjectsStore,
  mergeProjectWorkspaces,
} from "./projectWorkspaces.ts";

/* ── path helpers ───────────────────────────────────────────────────── */

test("normRoot trims trailing separators, leaves the rest verbatim", () => {
  assert.equal(normRoot("C:\\FHE-Work\\WRMS\\"), "C:\\FHE-Work\\WRMS");
  assert.equal(normRoot("/Users/x/Repo/app///"), "/Users/x/Repo/app");
  assert.equal(normRoot("  C:\\FHE-Work\\WRMS  "), "C:\\FHE-Work\\WRMS");
});

test("basename returns the last segment for both separator styles", () => {
  assert.equal(basename("C:\\FHE-Work\\WRMS"), "WRMS");
  assert.equal(basename("/Users/x/Repo/admin-web/"), "admin-web");
});

test("joinPath honors the root's separator + ignores '.'", () => {
  assert.equal(joinPath("C:\\FHE-Work\\WRMS", "Beta\\admin-web"), "C:\\FHE-Work\\WRMS\\Beta\\admin-web");
  // a posix rel under a windows root → backslash-joined
  assert.equal(joinPath("C:\\FHE-Work\\WRMS", "Beta/api"), "C:\\FHE-Work\\WRMS\\Beta\\api");
  assert.equal(joinPath("/home/x/app", "front"), "/home/x/app/front");
  assert.equal(joinPath("/home/x/app", "."), "/home/x/app");
  assert.equal(joinPath("C:\\FHE-Work\\app\\", ""), "C:\\FHE-Work\\app");
});

test("hashRoot is stable + case/sep-insensitive on the root, prefixed", () => {
  const a = hashRoot("C:\\FHE-Work\\WRMS");
  assert.match(a, /^ws_[0-9a-z]+$/);
  assert.equal(a, hashRoot("C:\\FHE-Work\\WRMS\\")); // trailing sep ignored
  assert.equal(a, hashRoot("c:\\fhe-work\\wrms")); // case-insensitive
  assert.notEqual(a, hashRoot("C:\\FHE-Work\\Trading-Portal"));
});

/* ── inference ──────────────────────────────────────────────────────── */

test("inferRole reads common folder names (backend wins ties)", () => {
  assert.equal(inferRole("front"), "frontend");
  assert.equal(inferRole("admin-web"), "frontend");
  assert.equal(inferRole("admin-web-next"), "frontend");
  assert.equal(inferRole("back"), "backend");
  assert.equal(inferRole("api"), "backend");
  assert.equal(inferRole("api-nitro"), "backend");
  assert.equal(inferRole("web-api"), "backend"); // backend signal wins
  assert.equal(inferRole("mobile"), "mobile");
  assert.equal(inferRole("infra"), "infra");
  assert.equal(inferRole("weird-thing"), "other");
});

test("supersedesBase detects -next / -nitro / v2 successors", () => {
  assert.equal(supersedesBase("admin-web-next"), "admin-web");
  assert.equal(supersedesBase("api-nitro"), "api");
  assert.equal(supersedesBase("app-v2"), "app");
  assert.equal(supersedesBase("admin-web"), null);
  assert.equal(supersedesBase("api"), null);
});

test("stackToKind / kindToStack round-trip the legacy kinds", () => {
  assert.equal(stackToKind("next"), "node");
  assert.equal(stackToKind("nitro"), "node");
  assert.equal(stackToKind("flutter"), "flutter");
  assert.equal(stackToKind("rust"), "rust");
  assert.equal(stackToKind("mystery"), "unknown");
  assert.equal(kindToStack("node"), "node");
  assert.equal(kindToStack("unknown"), "");
});

/* ── structure helpers ──────────────────────────────────────────────── */

const comp = (name, extra = {}) => ({
  id: `x/${name}`,
  name,
  path: name,
  role: inferRole(name),
  stack: "node",
  runCommands: [{ label: "pnpm dev", cmd: "pnpm dev" }],
  ...extra,
});

const wrms = () => ({
  id: "ws_wrms",
  name: "WRMS",
  root: "C:\\FHE-Work\\WRMS",
  source: "scanned",
  mtime: 100,
  schemaVersion: 1,
  structure: {
    kind: "environments",
    defaultEnv: "beta",
    environments: [
      {
        id: "beta",
        name: "Beta",
        path: "Beta",
        components: [comp("admin-web", { status: "legacy" }), comp("admin-web-next", { status: "wip", supersedes: "x/admin-web" })],
      },
      { id: "staging", name: "Staging", path: "Staging", components: [comp("admin-web")] },
    ],
  },
});

test("primaryComponent picks the default env's first component", () => {
  assert.equal(primaryComponent(wrms())?.name, "admin-web");
  const split = {
    ...wrms(),
    structure: { kind: "split", components: [comp("front"), comp("back")] },
  };
  assert.equal(primaryComponent(split)?.name, "front");
  const full = { ...wrms(), structure: { kind: "fullstack", component: comp("app") } };
  assert.equal(primaryComponent(full)?.name, "app");
  const blank = { ...wrms(), structure: { kind: "unconfigured" } };
  assert.equal(primaryComponent(blank), null);
});

test("allComponents flattens across environments", () => {
  assert.deepEqual(
    allComponents(wrms()).map((c) => c.name),
    ["admin-web", "admin-web-next", "admin-web"],
  );
});

test("projectShapeLabel summarizes the structure", () => {
  assert.equal(projectShapeLabel(wrms()), "environments · 2");
  assert.equal(projectShapeLabel({ ...wrms(), structure: { kind: "split", components: [comp("a"), comp("b")] } }), "split · 2");
  assert.equal(projectShapeLabel({ ...wrms(), structure: { kind: "fullstack", component: comp("a") } }), "fullstack");
});

/* ── adapter ────────────────────────────────────────────────────────── */

test("workspaceToProjectInfo flattens to the root-level legacy shape", () => {
  const pi = workspaceToProjectInfo(wrms());
  assert.equal(pi.name, "WRMS");
  assert.equal(pi.root, "C:\\FHE-Work\\WRMS");
  assert.equal(pi.kind, "node"); // from the primary component's stack
  assert.equal(pi.commands[0].cmd, "pnpm dev");
  assert.equal(pi.mtime, 100);
});

test("projectInfoToWorkspace builds a fullstack workspace + infers role", () => {
  const ws = projectInfoToWorkspace({
    name: "Trading-Portal",
    root: "C:\\FHE-Work\\Trading-Portal\\",
    kind: "node",
    commands: [{ label: "npm run dev", cmd: "npm run dev" }],
    mtime: 42,
  });
  assert.equal(ws.structure.kind, "fullstack");
  assert.equal(ws.root, "C:\\FHE-Work\\Trading-Portal"); // trailing sep trimmed
  assert.equal(ws.source, "custom");
  assert.equal(ws.id, hashRoot("C:\\FHE-Work\\Trading-Portal"));
  assert.equal(ws.structure.component.stack, "node");
  assert.equal(ws.structure.component.status, "current");
});

/* ── migration ──────────────────────────────────────────────────────── */

test("migrateProjectsStore folds custom + hidden + overrides into v2", () => {
  const old = {
    custom: [
      { name: "WRMS", root: "C:\\FHE-Work\\WRMS", kind: "unknown", commands: [], mtime: 7 },
    ],
    hidden: ["C:\\FHE-Work\\Old-Thing"],
    overrides: {
      "C:\\FHE-Work\\Trading-Portal": { name: "Trading", cmd: "npm run dev" },
    },
  };
  const v2 = migrateProjectsStore(old);
  assert.equal(v2.schemaVersion, 2);
  assert.deepEqual(v2.scanRoots, []);
  assert.equal(v2.custom.length, 1);
  assert.equal(v2.custom[0].name, "WRMS");
  assert.equal(v2.custom[0].structure.kind, "fullstack");
  assert.equal(v2.prefs["C:\\FHE-Work\\Old-Thing"].hidden, true);
  assert.equal(v2.prefs["C:\\FHE-Work\\Trading-Portal"].name, "Trading");
  assert.equal(v2.prefs["C:\\FHE-Work\\Trading-Portal"].cmd, "npm run dev");
});

test("migrateProjectsStore is total on garbage / empty input", () => {
  assert.deepEqual(migrateProjectsStore(null), { schemaVersion: 2, scanRoots: [], custom: [], prefs: {} });
  assert.deepEqual(migrateProjectsStore({}), { schemaVersion: 2, scanRoots: [], custom: [], prefs: {} });
  assert.deepEqual(migrateProjectsStore({ custom: "nope", hidden: 5, overrides: 1 }), {
    schemaVersion: 2,
    scanRoots: [],
    custom: [],
    prefs: {},
  });
});

/* ── merge ──────────────────────────────────────────────────────────── */

test("mergeProjectWorkspaces drops hidden, applies name override, appends custom", () => {
  const scanned = [
    { ...wrms() },
    { ...wrms(), id: "ws_tp", name: "Trading-Portal", root: "C:\\FHE-Work\\Trading-Portal" },
  ];
  const store = {
    schemaVersion: 2,
    scanRoots: [],
    custom: [{ ...wrms(), id: "ws_custom", name: "Local", root: "D:\\elsewhere\\thing" }],
    prefs: {
      "C:\\FHE-Work\\WRMS": { name: "WRMS (prod)" },
      "C:\\FHE-Work\\Trading-Portal": { hidden: true },
    },
  };
  const merged = mergeProjectWorkspaces(scanned, store);
  const names = merged.map((w) => w.name);
  assert.deepEqual(names, ["WRMS (prod)", "Local"]); // TP hidden, custom appended, WRMS renamed
});

test("mergeProjectWorkspaces drops REMOVED workspaces (like hidden)", () => {
  const scanned = [
    { ...wrms() },
    { ...wrms(), id: "ws_tp", name: "Trading-Portal", root: "C:\\FHE-Work\\Trading-Portal" },
  ];
  const store = {
    schemaVersion: 2,
    scanRoots: [],
    custom: [],
    prefs: { "C:\\FHE-Work\\Trading-Portal": { removed: true } },
  };
  assert.deepEqual(
    mergeProjectWorkspaces(scanned, store).map((w) => w.name),
    ["WRMS"],
  );
});

test("mergeProjectWorkspaces does not duplicate a custom that's also scanned", () => {
  const scanned = [{ ...wrms() }];
  const store = {
    schemaVersion: 2,
    scanRoots: [],
    custom: [{ ...wrms(), source: "custom" }], // same root as scanned
    prefs: {},
  };
  assert.equal(mergeProjectWorkspaces(scanned, store).length, 1);
});
