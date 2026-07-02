// @ts-nocheck -- executed directly by node's test runner, outside the browser app.
import assert from "node:assert/strict";
import test from "node:test";

import { routeControl, CONTROL_ACTIONS } from "./control.ts";

function mkHandlers() {
  const calls = [];
  return {
    calls,
    paneOpen: (content, label) => calls.push(["paneOpen", content, label]),
    paneOpenFile: (path) => calls.push(["paneOpenFile", path]),
    paneClose: (key, force) => calls.push(["paneClose", key, force]),
    paneMaximize: (key, on) => calls.push(["paneMaximize", key, on]),
    paneHide: (key, on) => calls.push(["paneHide", key, on]),
    paneResumeChat: (id) => calls.push(["paneResumeChat", id]),
    sidebarToggle: (on) => calls.push(["sidebarToggle", on]),
    terminalSend: (key, text) => {
      calls.push(["terminalSend", key, text]);
      return key !== "missing";
    },
    browserOpen: (url, label) => calls.push(["browserOpen", url, label]),
    browserNavigate: (key, url) => {
      calls.push(["browserNavigate", key, url]);
      return key !== "missing";
    },
    browserBack: (key) => {
      calls.push(["browserBack", key]);
      return key !== "missing";
    },
    browserForward: (key) => {
      calls.push(["browserForward", key]);
      return key !== "missing";
    },
    browserReload: (key) => {
      calls.push(["browserReload", key]);
      return key !== "missing";
    },
    layoutList: () => ["work", "review"],
    layoutSave: (name) => calls.push(["layoutSave", name]),
    layoutApply: (name) => {
      calls.push(["layoutApply", name]);
      return name !== "nope";
    },
    settingsGet: (key) => (key ? { key } : { all: true }),
    settingsSet: (key, value) => {
      calls.push(["settingsSet", key, value]);
      return key === "bad"
        ? { ok: false, error: 'unknown setting "bad"' }
        : { ok: true, value };
    },
    oracleList: () => [{ identity: "max" }],
    oracleSpawn: (id) => calls.push(["oracleSpawn", id]),
    oracleKill: (id, force) => {
      calls.push(["oracleKill", id, force]);
      return id !== "missing";
    },
    paneList: () => [{ key: "k1" }],
    stateGet: () => ({ panes: [{ key: "k1" }], sidebarOpen: true }),
  };
}

test("capabilities returns the full self-describing action list", () => {
  const r = routeControl({ action: "capabilities" }, mkHandlers());
  assert.equal(r.ok, true);
  assert.deepEqual(r.result.actions, CONTROL_ACTIONS);
  assert.ok(r.result.actions.includes("pane.open"));
});

test("read commands return their snapshot", () => {
  const h = mkHandlers();
  assert.deepEqual(routeControl({ action: "pane.list" }, h).result, [{ key: "k1" }]);
  assert.deepEqual(routeControl({ action: "state.get" }, h).result, {
    panes: [{ key: "k1" }],
    sidebarOpen: true,
  });
});

test("pane.open dispatches and echoes the new pane list; missing content errors", () => {
  const h = mkHandlers();
  const r = routeControl({ action: "pane.open", content: { type: "browser", url: "x" }, label: "x" }, h);
  assert.equal(r.ok, true);
  assert.deepEqual(r.result, [{ key: "k1" }], "writes echo pane.list");
  assert.deepEqual(h.calls[0], ["paneOpen", { type: "browser", url: "x" }, "x"]);
  assert.equal(routeControl({ action: "pane.open", content: "nope" }, mkHandlers()).ok, false);
  assert.equal(routeControl({ action: "pane.open" }, mkHandlers()).ok, false);
});

test("pane.openFile / pane.resumeChat validate their string field", () => {
  const h = mkHandlers();
  assert.equal(routeControl({ action: "pane.openFile", path: "/p/a.ts" }, h).ok, true);
  assert.deepEqual(h.calls.at(-1), ["paneOpenFile", "/p/a.ts"]);
  assert.equal(routeControl({ action: "pane.openFile" }, mkHandlers()).ok, false);
  assert.equal(routeControl({ action: "pane.resumeChat", chatId: "c1" }, h).ok, true);
  assert.equal(routeControl({ action: "pane.resumeChat" }, mkHandlers()).ok, false);
});

test("pane.close passes force (default false)", () => {
  const h = mkHandlers();
  routeControl({ action: "pane.close", key: "k3" }, h);
  assert.deepEqual(h.calls[0], ["paneClose", "k3", false]);
  routeControl({ action: "pane.close", key: "k3", force: true }, h);
  assert.deepEqual(h.calls[1], ["paneClose", "k3", true]);
  assert.equal(routeControl({ action: "pane.close" }, mkHandlers()).ok, false);
});

test("pane.maximize / pane.hide default `on` to true and respect false", () => {
  const h = mkHandlers();
  routeControl({ action: "pane.maximize", key: "k1" }, h);
  routeControl({ action: "pane.maximize", key: "k1", on: false }, h);
  routeControl({ action: "pane.hide", key: "k1" }, h);
  assert.deepEqual(h.calls[0], ["paneMaximize", "k1", true]);
  assert.deepEqual(h.calls[1], ["paneMaximize", "k1", false]);
  assert.deepEqual(h.calls[2], ["paneHide", "k1", true]);
});

test("sidebar.toggle forwards an explicit on, else undefined (toggle)", () => {
  const h = mkHandlers();
  routeControl({ action: "sidebar.toggle", on: true }, h);
  routeControl({ action: "sidebar.toggle" }, h);
  assert.deepEqual(h.calls[0], ["sidebarToggle", true]);
  assert.deepEqual(h.calls[1], ["sidebarToggle", undefined]);
});

test("terminal.send requires key+text and reports a missing pane", () => {
  const h = mkHandlers();
  assert.equal(routeControl({ action: "terminal.send", key: "k1", text: "ls\n" }, h).ok, true);
  assert.deepEqual(h.calls.at(-1), ["terminalSend", "k1", "ls\n"]);
  assert.equal(routeControl({ action: "terminal.send", key: "k1" }, mkHandlers()).ok, false);
  assert.equal(routeControl({ action: "terminal.send", key: "missing", text: "x" }, mkHandlers()).ok, false);
});

test("terminal.runCommand appends a single newline; interrupt sends ^C", () => {
  const h = mkHandlers();
  routeControl({ action: "terminal.runCommand", key: "k1", cmd: "git status" }, h);
  assert.deepEqual(h.calls.at(-1), ["terminalSend", "k1", "git status\n"]);
  routeControl({ action: "terminal.runCommand", key: "k1", cmd: "git status\n" }, h);
  assert.deepEqual(h.calls.at(-1), ["terminalSend", "k1", "git status\n"], "no double newline");
  routeControl({ action: "terminal.interrupt", key: "k1" }, h);
  assert.deepEqual(h.calls.at(-1), ["terminalSend", "k1", "\x03"]);
});

test("browser.open requires a url and echoes the new pane list", () => {
  const h = mkHandlers();
  const r = routeControl({ action: "browser.open", url: "https://x.com", label: "x" }, h);
  assert.equal(r.ok, true);
  assert.deepEqual(r.result, [{ key: "k1" }], "writes echo pane.list");
  assert.deepEqual(h.calls.at(-1), ["browserOpen", "https://x.com", "x"]);
  assert.equal(routeControl({ action: "browser.open" }, mkHandlers()).ok, false);
});

test("browser.navigate/back/forward/reload need a key and report a missing pane", () => {
  const h = mkHandlers();
  assert.equal(routeControl({ action: "browser.navigate", key: "k1", url: "u" }, h).ok, true);
  assert.deepEqual(h.calls.at(-1), ["browserNavigate", "k1", "u"]);
  assert.equal(routeControl({ action: "browser.navigate", key: "k1" }, mkHandlers()).ok, false);
  assert.equal(routeControl({ action: "browser.navigate", key: "missing", url: "u" }, mkHandlers()).ok, false);
  for (const a of ["browser.back", "browser.forward", "browser.reload"]) {
    assert.equal(routeControl({ action: a, key: "k1" }, mkHandlers()).ok, true, a);
    assert.equal(routeControl({ action: a }, mkHandlers()).ok, false, `${a} needs a key`);
    assert.equal(routeControl({ action: a, key: "missing" }, mkHandlers()).ok, false, `${a} missing pane`);
  }
});

test("layout.list/save/apply drive the workspace store; apply echoes the deck", () => {
  const h = mkHandlers();
  assert.deepEqual(routeControl({ action: "layout.list" }, h).result, ["work", "review"]);
  assert.equal(routeControl({ action: "layout.save", name: "x" }, h).ok, true);
  assert.deepEqual(h.calls.at(-1), ["layoutSave", "x"]);
  assert.equal(routeControl({ action: "layout.save" }, mkHandlers()).ok, false);
  const r = routeControl({ action: "layout.apply", name: "work" }, h);
  assert.equal(r.ok, true);
  assert.deepEqual(r.result, [{ key: "k1" }], "apply echoes pane.list");
  assert.equal(routeControl({ action: "layout.apply", name: "nope" }, mkHandlers()).ok, false);
  assert.equal(routeControl({ action: "layout.apply" }, mkHandlers()).ok, false);
});

test("settings.get reads; settings.set validates + reports rejection", () => {
  const h = mkHandlers();
  assert.deepEqual(routeControl({ action: "settings.get" }, h).result, { all: true });
  assert.deepEqual(routeControl({ action: "settings.get", key: "flashLevel" }, h).result, { key: "flashLevel" });
  const good = routeControl({ action: "settings.set", key: "funFx", value: false }, h);
  assert.equal(good.ok, true);
  assert.deepEqual(good.result, { key: "funFx", value: false });
  assert.deepEqual(h.calls.at(-1), ["settingsSet", "funFx", false]);
  assert.equal(routeControl({ action: "settings.set", key: "x" }, mkHandlers()).ok, false, "needs a value");
  assert.equal(routeControl({ action: "settings.set", value: 1 }, mkHandlers()).ok, false, "needs a key");
  const bad = routeControl({ action: "settings.set", key: "bad", value: 1 }, h);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /unknown setting/);
});

test("oracle.list reads; spawn echoes the deck; kill validates the id", () => {
  const h = mkHandlers();
  assert.deepEqual(routeControl({ action: "oracle.list" }, h).result, [{ identity: "max" }]);
  const sp = routeControl({ action: "oracle.spawn", id: "max" }, h);
  assert.equal(sp.ok, true);
  assert.deepEqual(sp.result, [{ key: "k1" }], "spawn echoes pane.list");
  assert.deepEqual(h.calls.at(-1), ["oracleSpawn", "max"]);
  assert.equal(routeControl({ action: "oracle.spawn" }, mkHandlers()).ok, false);
  assert.equal(routeControl({ action: "oracle.kill", id: "max", force: true }, h).ok, true);
  assert.deepEqual(h.calls.at(-1), ["oracleKill", "max", true]);
  assert.equal(routeControl({ action: "oracle.kill", id: "missing" }, mkHandlers()).ok, false);
  assert.equal(routeControl({ action: "oracle.kill" }, mkHandlers()).ok, false);
});

test("an unknown action fails loudly (never a silent no-op)", () => {
  const r = routeControl({ action: "pane.nuke" }, mkHandlers());
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown action/);
});
