import { createElement } from "react";
import {
  Camera,
  Layers,
  Maximize2,
  MessageSquare,
  PanelLeft,
  Play,
  Radio,
  RefreshCw,
  Settings,
  Rows2,
  SquareStack,
  Trash2,
} from "lucide-react";

import type { Command as PaletteCommand } from "../components/CommandPalette.tsx";
import type { ChatSessionInfo } from "./chat.ts";
import type { OracleInfo } from "./pty.ts";
import type { ProjectInfo } from "./run.ts";
import { SPAWN, type PaneContent } from "./apps.ts";
import { commandToPaletteCommand, createCommand, type AiosCommand } from "./commands.ts";
import { MOD, chord } from "./platform.ts";
import type { Workspace } from "./workspaces.ts";

export interface AppCommandDeps {
  activeKey: string | null;
  panesCount: number;
  home: string | null;
  chats: ChatSessionInfo[];
  oracles: OracleInfo[];
  projects: ProjectInfo[];
  spawn: (kind: PaneContent, label: string) => void;
  resumeChat: (chat: ChatSessionInfo) => void;
  addOracle: (identity: string) => void;
  runProject: (project: ProjectInfo) => void;
  runF5: () => void;
  reloadProjects: () => void;
  fireAppshot: () => void;
  setSidebarOpen: (updater: (value: boolean) => boolean) => void;
  setTopBarMode: (mode: "compact" | "hidden") => void;
  setOverviewOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setHiddenKeys: (keys: string[]) => void;
  setMaximizedKey: (key: string | null) => void;
  /** Saved named layouts; one restore + one delete command each. */
  workspaces: Workspace[];
  /** Opens the name-this-workspace dialog (App owns the modal). */
  openSaveWorkspace: () => void;
  applyWorkspace: (ws: Workspace) => void;
  deleteWorkspace: (name: string) => void;
  /** Surface a command failure to the user (toast) — silent no-ops erode trust. */
  notify?: (message: string) => void;
}

interface RegistryEntry {
  command: AiosCommand;
  group: string;
  actionLabel: string;
}

function relPath(home: string | null, path: string): string {
  return home && path.startsWith(home)
    ? path.slice(home.length).replace(/^\//, "")
    : path;
}

/** "2h ago" / "3d ago" for the workspace subtitles. */
function savedAgo(ts: number): string {
  if (!ts) return "";
  const m = Math.floor((Date.now() - ts) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function buildAppCommands(deps: AppCommandDeps): PaletteCommand[] {
  const ctx = { source: "palette" as const, activePaneKey: deps.activeKey };
  const toPalette = (entry: RegistryEntry) =>
    commandToPaletteCommand(entry.command, {
      context: ctx,
      group: entry.group,
      actionLabel: entry.actionLabel,
      subtitle: entry.command.description,
      notify: deps.notify,
    });

  const registry: RegistryEntry[] = [
    ...SPAWN.map((s) => ({
      command: createCommand({
        id: `pane.open.${s.id}`,
        label: `new ${s.label}`,
        scope: "pane",
        icon: createElement(s.icon, { size: 14 }),
        keywords: ["open", "pane", "spawn", "launch", "new"],
        run: () => deps.spawn(s.kind, s.label),
      }),
      group: "open",
      actionLabel: "open",
    })),
    ...deps.chats.map((c) => ({
      command: createCommand({
        id: `chat.resume.${c.id}`,
        label: c.title || "untitled chat",
        description: c.cwd ? c.cwd.split("/").pop() : undefined,
        scope: "chat",
        icon: createElement(MessageSquare, { size: 14 }),
        keywords: ["chat", "session", "continue", "resume", c.cwd ?? ""],
        run: () => deps.resumeChat(c),
      }),
      group: "resume",
      actionLabel: "resume",
    })),
    ...deps.oracles.map((o) => ({
      command: createCommand({
        id: `oracle.attach.${o.identity}`,
        label: `oracle: ${o.display_name}`,
        description: o.running ? "running" : "idle",
        scope: "global",
        icon: createElement(Radio, { size: 14 }),
        keywords: ["oracle", "agent", "attach", "session", o.identity],
        run: () => deps.addOracle(o.identity),
      }),
      group: "fleet",
      actionLabel: "attach",
    })),
    ...deps.projects.map((p) => ({
      command: createCommand({
        id: `project.run.${p.root}`,
        label: `run ${p.name}`,
        description: `${p.kind} · ${relPath(deps.home, p.root)}`,
        scope: "run",
        icon: createElement(Play, { size: 14 }),
        keywords: ["run", "start", "launch", "project", p.name, p.kind, relPath(deps.home, p.root)],
        run: () => deps.runProject(p),
      }),
      group: "run",
      actionLabel: "run",
    })),
    {
      command: createCommand({
        id: "workspace.save",
        label: "save workspace…",
        description: "name the current pane layout to restore later",
        scope: "global",
        icon: createElement(SquareStack, { size: 14 }),
        keywords: ["workspace", "layout", "save", "snapshot", "panes", "remember"],
        enabled: () => deps.panesCount > 0,
        run: deps.openSaveWorkspace,
      }),
      group: "workspaces",
      actionLabel: "save",
    },
    ...deps.workspaces.map((ws) => ({
      command: createCommand({
        id: `workspace.open.${ws.name.toLowerCase()}`,
        label: `workspace: ${ws.name}`,
        description: `${ws.panes.length} ${ws.panes.length === 1 ? "pane" : "panes"} · saved ${savedAgo(ws.savedAt)} — replaces the current layout`,
        scope: "global",
        icon: createElement(SquareStack, { size: 14 }),
        keywords: ["workspace", "layout", "restore", "open", "switch", ws.name],
        run: () => deps.applyWorkspace(ws),
      }),
      group: "workspaces",
      actionLabel: "restore",
    })),
    ...deps.workspaces.map((ws) => ({
      command: createCommand({
        id: `workspace.delete.${ws.name.toLowerCase()}`,
        label: `delete workspace: ${ws.name}`,
        description: "forgets the saved layout (open panes are untouched)",
        scope: "global",
        danger: "destructive",
        icon: createElement(Trash2, { size: 14 }),
        keywords: ["workspace", "layout", "delete", "remove", "forget", ws.name],
        run: () => deps.deleteWorkspace(ws.name),
      }),
      group: "workspaces",
      actionLabel: "delete",
    })),
    {
      command: createCommand({
        id: "view.sidebar.toggle",
        label: "toggle sidebar",
        description: chord("B"),
        scope: "global",
        icon: createElement(PanelLeft, { size: 14 }),
        keywords: ["rail", "hide", "show"],
        run: () => deps.setSidebarOpen((v) => !v),
      }),
      group: "view",
      actionLabel: "toggle",
    },
    {
      command: createCommand({
        id: "view.topbar.hide",
        label: "hide top bar",
        scope: "global",
        icon: createElement(Rows2, { size: 14 }),
        keywords: ["topbar", "top", "bar", "chrome", "minimal", "hide"],
        run: () => deps.setTopBarMode("hidden"),
      }),
      group: "view",
      actionLabel: "hide",
    },
    {
      command: createCommand({
        id: "view.topbar.compact",
        label: "show compact top bar",
        scope: "global",
        icon: createElement(Rows2, { size: 14 }),
        keywords: ["topbar", "top", "bar", "chrome", "controls", "show", "compact"],
        run: () => deps.setTopBarMode("compact"),
      }),
      group: "view",
      actionLabel: "show",
    },
    {
      command: createCommand({
        id: "view.overview.open",
        label: "show all panes",
        description: chord("`"),
        scope: "pane",
        icon: createElement(Layers, { size: 14 }),
        keywords: ["overview", "mission", "control", "switch", "panes", "windows", "fan", "out"],
        enabled: () => deps.panesCount > 0,
        run: () => deps.setOverviewOpen(true),
      }),
      group: "view",
      actionLabel: "open",
    },
    {
      command: createCommand({
        id: "pane.tile.all",
        label: "tile all panes",
        scope: "pane",
        icon: createElement(Maximize2, { size: 14 }),
        keywords: ["show", "all", "restore", "unminimize", "tile", "grid", "every", "pane", "visible"],
        run: () => {
          deps.setHiddenKeys([]);
          deps.setMaximizedKey(null);
        },
      }),
      group: "view",
      actionLabel: "tile",
    },
    {
      command: createCommand({
        id: "project.run.focused",
        label: "run focused project",
        description: "F5",
        scope: "run",
        icon: createElement(Play, { size: 14 }),
        keywords: ["f5", "run", "debug", "start", "flutter", "npm", "dev", "build", "terminal", "focused", "open", "file"],
        run: deps.runF5,
      }),
      group: "actions",
      actionLabel: "run",
    },
    {
      command: createCommand({
        id: "project.rescan",
        label: "rescan projects",
        description: "refresh ~/Repo run targets",
        scope: "run",
        icon: createElement(RefreshCw, { size: 14 }),
        keywords: ["refresh", "reload", "rescan", "scan", "projects", "repo", "missing", "cmd k", "command palette"],
        run: deps.reloadProjects,
      }),
      group: "run",
      actionLabel: "scan",
    },
    {
      command: createCommand({
        id: "oracle.appshot",
        label: "appshot - screenshot to oracle",
        description: `${MOD}${MOD}`,
        scope: "global",
        danger: "external",
        icon: createElement(Camera, { size: 14 }),
        keywords: ["screenshot", "capture", "oracle"],
        run: deps.fireAppshot,
      }),
      group: "actions",
      actionLabel: "run",
    },
    {
      command: createCommand({
        id: "app.settings.open",
        label: "settings",
        description: chord(","),
        scope: "global",
        icon: createElement(Settings, { size: 14 }),
        keywords: ["preferences", "theme", "appearance"],
        run: () => deps.setSettingsOpen(true),
      }),
      group: "app",
      actionLabel: "open",
    },
  ];

  return registry.map(toPalette);
}
