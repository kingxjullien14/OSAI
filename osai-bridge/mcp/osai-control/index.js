#!/usr/bin/env node
/**
 * osai-control — an MCP server that lets a claude oracle drive the running OSAI
 * app. It exposes ONE tool, `control`, which forwards a command to OSAI's
 * localhost control plane (a tiny HTTP server in src-tauri/src/control.rs); the
 * app runs it through the SAME code a human's clicks do (App.tsx dispatchControl).
 *
 * Discovery: reads the bearer token + ephemeral port OSAI writes on launch —
 *   ~/.osai/control-token  and  ~/.osai/control-port
 * (re-read per call, since the port changes each app launch). If they're missing,
 * OSAI isn't running with the control plane enabled (launch it with OSAI_CONTROL=1).
 *
 * Register it in the oracle's MCP config, e.g. in ~/.claude.json:
 *   "mcpServers": { "osai-control": { "command": "node",
 *       "args": ["<abs path>/osai-bridge/mcp/osai-control/index.js"] } }
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

/** Read the live token + port OSAI wrote (fresh each call — the port is ephemeral). */
function readConfig() {
  const dir = path.join(os.homedir(), ".osai");
  let token;
  let port;
  try {
    token = fs.readFileSync(path.join(dir, "control-token"), "utf8").trim();
    port = fs.readFileSync(path.join(dir, "control-port"), "utf8").trim();
  } catch {
    throw new Error(
      "OSAI control plane not reachable — no ~/.osai/control-token|control-port. " +
        "Launch OSAI with OSAI_CONTROL=1 so it starts the local control server.",
    );
  }
  if (!token || !port) throw new Error("OSAI control token/port file is empty.");
  return { token, port };
}

const DESCRIPTION = [
  "Drive the running OSAI desktop app — the same actions a human does in its UI.",
  "Pass an `action` plus its fields. Run `pane.list` first to get pane `key`s for",
  "key-based actions. Actions:",
  "• pane.open {content,label?} — open a pane. content is a PaneContent, e.g.",
  '    {"type":"browser","url":"https://x.com"} · {"type":"shell","cmd":"npm run dev","cwd":"/p"}',
  '    · {"type":"files","root":"/p"} · {"type":"editor","path":"/p/a.ts","name":"a.ts"} · {"type":"chat"}',
  "• pane.openFile {path} — open a file (auto editor-vs-viewer)",
  "• pane.close {key,force?} · pane.maximize {key,on?} · pane.hide {key,on?}",
  "• pane.resumeChat {chatId} — reopen a past chat",
  "• sidebar.toggle {on?}",
  "• terminal.send {key,text} · terminal.runCommand {key,cmd} · terminal.interrupt {key}",
  "• browser.open {url,label?} · browser.navigate {key,url} · browser.back|forward|reload {key}",
  "• layout.list · layout.save {name} · layout.apply {name} — named pane layouts (workspaces)",
  "• settings.get {key?} · settings.set {key,value} — read/adjust app settings",
  "• oracle.list — the agent roster · oracle.spawn {id} — open an oracle pane · oracle.kill {id,force?}",
  "• pane.list — open panes [{key,label,kind,hidden,maximized}]",
  "• state.get — panes + sidebar + counts · capabilities — the action list",
  "Returns the result JSON; writes echo the new pane list.",
].join("\n");

const server = new Server(
  { name: "osai-control", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "control",
      description: DESCRIPTION,
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", description: "dotted verb, e.g. pane.open / pane.list / terminal.runCommand" },
          content: { type: "object", description: "for pane.open: a PaneContent ({type, …})" },
          label: { type: "string" },
          key: { type: "string", description: "a pane key (from pane.list)" },
          path: { type: "string" },
          url: { type: "string" },
          cmd: { type: "string" },
          text: { type: "string" },
          chatId: { type: "string" },
          name: { type: "string", description: "for layout.* : a saved workspace name" },
          value: { description: "for settings.set : the new value (type depends on the key)" },
          id: { type: "string", description: "for oracle.* : an oracle identity (from oracle.list)" },
          on: { type: "boolean" },
          force: { type: "boolean" },
        },
        required: ["action"],
        additionalProperties: true,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== "control") {
    return { isError: true, content: [{ type: "text", text: `unknown tool: ${req.params.name}` }] };
  }
  const args = req.params.arguments ?? {};
  if (!args.action) {
    return { isError: true, content: [{ type: "text", text: "missing required field: action" }] };
  }
  try {
    const { token, port } = readConfig();
    const res = await fetch(`http://127.0.0.1:${port}/control`, {
      method: "POST",
      headers: { "X-OSAI-Token": token, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    const text = await res.text();
    // surface non-2xx (401 bad token, 504 timeout, 400 bad command) as errors.
    return { isError: !res.ok, content: [{ type: "text", text }] };
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: String(e?.message ?? e) }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
