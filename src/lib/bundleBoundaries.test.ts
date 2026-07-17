// @ts-nocheck -- source-boundary regression checks run directly in node.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const hasRuntimeImport = (source: string, specifier: string) => {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^import(?!\\\\s+type)[^\\n]*from\\\\s+["']${escaped}["']`, "m").test(source);
};

test("app shell does not statically import heavy pane implementations", () => {
  const app = read("src/App.tsx");
  const forbidden = [
    "./components/ChatPane",
    "./components/EditorPane",
    "./components/TerminalRuntime",
  ];

  for (const specifier of forbidden) {
    assert.equal(
      hasRuntimeImport(app, specifier),
      false,
      `${specifier} must stay behind a lazy import`,
    );
  }

  assert.match(app, /lazy\(\(\) =>\s*import\("\.\/components\/ChatPane"\)/);
  assert.match(app, /lazy\(\(\) =>\s*import\("\.\/components\/EditorPane"\)/);
});

test("editor pane keeps monaco behind an async runtime import", () => {
  const editor = read("src/components/EditorPane.tsx");

  assert.equal(hasRuntimeImport(editor, "monaco-editor"), false);
  assert.equal(hasRuntimeImport(editor, "../lib/monaco"), false);
  assert.match(editor, /await import\("\.\.\/lib\/monaco"\)/);
});

test("terminal pane keeps xterm behind terminal runtime", () => {
  const shell = read("src/components/TerminalPane.tsx");
  const runtime = read("src/components/TerminalRuntime.tsx");

  assert.equal(shell.includes("@xterm/"), false);
  assert.match(shell, /import\("\.\/TerminalRuntime"\)/);
  assert.match(runtime, /@xterm\/xterm/);
});

test("pet is the glass spirit: soul-driven room + companion + roaming overlay", () => {
  const pane = read("src/components/PetPane.tsx");
  const body = read("src/components/pet/PetBody.tsx");
  const overlay = read("src/components/pet/PetOverlay.tsx");
  const idle = read("src/components/IdleControlCenter.tsx");
  const app = read("src/App.tsx");
  const css = read("src/App.css");

  // ONE rig everywhere: room, idle tile and the desk creature all draw
  // PetBody, steered by the persisted soul (lib/pet/engine + store).
  assert.match(pane, /from "\.\/pet\/PetBody"/);
  assert.match(overlay, /from "\.\/PetBody"/);
  for (const source of [pane, overlay]) {
    assert.match(source, /loadSoul/);
    assert.match(source, /subscribeSoul/);
    assert.match(source, /applyCare/);
    assert.match(source, /suggestActivity/);
  }
  assert.match(body, /data-pose/);
  assert.match(body, /data-mood/);
  // code-drawn, token-tinted — no images, no hex (the ratchet test owns hex).
  assert.doesNotMatch(pane, /<img/);
  assert.doesNotMatch(body, /<img/);
  assert.match(body, /color-mix\(in srgb, var\(--color-accent\)/);

  // the ROOM (P3): honest vitals from the engine's TUNING, care with
  // cooldown notes, bond/journey, affinity flavor, milestone keepsakes.
  assert.match(pane, /TUNING/);
  assert.match(pane, /cooldownLeft/);
  assert.match(pane, /keepsakesOf/);
  assert.match(pane, /bondLevel/);
  assert.match(pane, /nextStageOf/);
  assert.match(pane, /savePetName/);
  for (const label of ["vitals", "care", "bond & journey", "favorite places"]) {
    assert.ok(pane.includes(label), `room card "${label}" must exist`);
  }
  // chat/terminal liveness still lands in the room via the pet bus
  assert.match(pane, /subscribePetReactions/);
  assert.match(pane, /subscribePetBubbles/);

  // P5 residency: on the idle home the spirit lives ON the horizon line
  // (soul-steered walker; click = its room). The old corner tile is gone.
  assert.match(idle, /HorizonPet/);
  assert.match(idle, /onOpenPet/);
  assert.match(idle, /suggestActivity/);
  assert.doesNotMatch(idle, /PetDashboardCompanion/);
  assert.doesNotMatch(css, /osai-pet-mini/);

  // the DESK CREATURE (P2): mounted in the shell, gated by the petRoam
  // setting, grab/toss physics intact.
  assert.match(app, /<PetOverlay/);
  assert.match(overlay, /petRoam/);
  assert.match(overlay, /setPointerCapture/);
  assert.match(overlay, /subscribeNotifications/);

  // the VOICE (P4): the pure decider gates every line (global gap + per-kind
  // cooldowns + quiet/asleep/carried silences), the petVoice setting is the
  // master switch, and bubbles deep-link via the notification opener.
  assert.match(overlay, /tryVoice/);
  assert.match(overlay, /petVoice/);
  assert.match(overlay, /onOpenTarget/);
  assert.match(overlay, /usagePaceRisk/);
  assert.match(overlay, /subscribePetBubbles/);
  assert.match(app, /onOpenTarget=\{openNotificationTarget\}/);

  // the rig's keyframe family lives in App.css, stilled by reduce-motion
  assert.match(css, /the glass-spirit pet \(P1, living-cockpit\)/);
  for (const kf of ["pet2-breathe", "pet2-hop", "pet2-celebrate", "pet2-dangle", "pet2-spin", "pet2-land"]) {
    assert.ok(css.includes(`@keyframes ${kf}`), `@keyframes ${kf} must exist`);
  }
  assert.match(css, /\[data-reduce-motion="true"\] \.osai-pet \*/);

  // the 8-bit pixel pet is fully retired — no orphan markup or CSS anywhere
  assert.doesNotMatch(pane, /pet-pixel|PET_VARIANT_KEY|makeVariant|hatch roll/);
  assert.doesNotMatch(css, /\.pet-pixel|\.pet-world|\.pet-hatch|\.pet-starter|\.pet-canvas|\.pet-dashboard\b/);
  assert.doesNotMatch(css, /image-rendering: pixelated/);
});

test("sidebar usage renders a real claude meter (not the spark proxy)", () => {
  // The usage rendering moved to the shared UsageGlance (components/dashboard);
  // SidebarUsage is now a thin alias of it. Both surfaces draw from one source.
  const source = read("src/components/dashboard/UsageGlance.tsx");
  const sidebar = read("src/components/SidebarUsage.tsx");

  // upstream 2026-06-06: replaced the gpt-5.3-codex-spark block with a real claude
  // meter sourced from ~/.osai/state/usage.json (claude_usage → claudeRate).
  assert.match(source, /ProviderBlock\s+name="claude"/);
  assert.match(source, /claudeRate\(\)/);
  // per-model carve-out rows (claude sonnet/opus weekly, codex spark) nest
  // under each provider block in both the sidebar and the idle home.
  assert.match(source, /models=\{claude!\.models\}/);
  assert.match(source, /models=\{codex!\.models\}/);
  assert.match(source, /function ModelRows/);
  assert.equal(source.includes("gpt-5.3-codex-spark"), false);
  assert.equal(source.includes("idleRate()"), false);
  assert.match(sidebar, /UsageGlance as SidebarUsage/);
});

test("workspaces: named layouts share the boot-restore hydration + ride the palette", () => {
  const app = read("src/App.tsx");
  const ws = read("src/lib/workspaces.ts");
  const cmds = read("src/lib/appCommands.ts");

  // one hydration path: boot restore AND workspace apply both revive sessions
  // (terminal reattach by key, browser last-url) through hydrateSavedPanes.
  assert.match(app, /function hydrateSavedPanes/);
  assert.match(app, /const hydrated = hydrateSavedPanes\(ws\.panes\)/);
  // grid fractions restore BEFORE the panes land so the reflow glides there
  assert.match(app, /saveGridTracks\(gridTrackStorageKey\(GRID_TRACK_KEY, c, r\)/);
  // busy chats being swapped out detach (keep running) instead of dying silently
  assert.match(app, /if \(h\?\.busy\(\)\) h\.detach\(true\)/);
  // the save dialog occludes native webviews like every other overlay
  assert.match(app, /wsDraft != null \|\|/);
  // store: upsert by name (case-insensitive) + subscribe for live palette rows
  assert.match(ws, /export function subscribeWorkspaces/);
  assert.match(ws, /toLowerCase\(\) !== name\.toLowerCase\(\)/);
  // palette: save + per-workspace restore + danger-marked delete
  assert.match(cmds, /id: "workspace\.save"/);
  assert.match(cmds, /workspace\.open\./);
  assert.match(cmds, /workspace\.delete\./);
  assert.match(cmds, /danger: "destructive"/);
});

test("finder/search modals carry the palette's full dialog+combobox ARIA mirror", () => {
  const finder = read("src/components/FileFinder.tsx");
  const search = read("src/components/GlobalSearch.tsx");
  const palette = read("src/components/CommandPalette.tsx");
  const ui = read("src/components/ui.tsx");

  // one shared focus trap, used by every modal (not per-file re-rolls)
  assert.match(ui, /export function trapTab/);
  for (const [src, key] of [
    [finder, "filefinder"],
    [search, "globalsearch"],
  ] as const) {
    assert.match(src, /role="dialog"/);
    assert.match(src, /aria-modal="true"/);
    assert.match(src, /role="combobox"/);
    assert.match(src, /aria-activedescendant/);
    assert.match(src, new RegExp(`id="${key}-listbox"`));
    assert.match(src, /role="option"/);
    assert.match(src, /aria-selected/);
    assert.match(src, /trapTab\(e, e\.currentTarget\)/);
  }
  // palette rows can hold focus after a click — Tab must stay inside there too
  assert.match(palette, /trapTab\(e, e\.currentTarget\)/);
});

test("browser video fullscreen avoids macos native space transition", () => {
  const source = read("src-tauri/src/browser.rs");

  assert.match(source, /set_simple_fullscreen\(on\)/);
});

test("web shell guards tauri-only runtime APIs", () => {
  const app = read("src/App.tsx");
  const chatPane = read("src/components/ChatPane.tsx");
  const terminalRuntime = read("src/components/TerminalRuntime.tsx");
  const tauri = read("src/lib/tauri.ts");
  const fs = read("src/lib/fs.ts");

  assert.match(tauri, /function isTauriRuntime/);
  assert.match(tauri, /__TAURI_INTERNALS__/);
  assert.match(tauri, /Promise\.reject\(new Error\(`tauri runtime unavailable/);
  assert.match(app, /import \{[^}]*\bisTauriRuntime\b[^}]*\} from "\.\/lib\/tauri"/);
  assert.match(app, /if \(!isTauriRuntime\(\)\) return;\s+void getCurrentWindow\(\)\.startDragging\(\)\.catch/);
  assert.match(app, /if \(!isTauriRuntime\(\)\) return;\s+let disposed = false/);
  assert.match(app, /const win = getCurrentWindow\(\)/);
  assert.match(app, /await win\.hide\(\)\.catch/);
  assert.match(app, /if \(!isTauriRuntime\(\)\) return;\s+\/\/ Resolve the pane key/);
  assert.match(app, /onDragDropEvent/);
  assert.match(fs, /if \(!isTauriRuntime\(\)\) return path/);
  assert.match(chatPane, /if \(webChatRuntime\) \{/);
  assert.match(chatPane, /webChatSend\(wire/);
  assert.doesNotMatch(chatPane, /web preview loaded\. live chat runs inside the desktop shell/);
  assert.match(chatPane, /url: fileSrc\(path\)/);
  assert.doesNotMatch(chatPane, /convertFileSrc/);
  assert.match(terminalRuntime, /if \(!isTauriRuntime\(\)\) \{/);
  assert.match(terminalRuntime, /terminal panes run inside the desktop shell/);
});

test("web mirror uses a cloudflare durable object transport", () => {
  const app = read("src/App.tsx");
  const viewer = read("src/components/MirrorViewer.tsx");
  const transport = read("src/lib/mirrorTransport.ts");
  const worker = read("workers/mirror/src/index.ts");
  const workflow = read(".github/workflows/cloudflare-pages.yml");

  assert.match(app, /ensureMirrorPairing/);
  assert.match(app, /mirrorShareUrl/);
  assert.match(app, /parseMirrorSocketMessage/);
  assert.match(app, /<MirrorViewer/);
  assert.match(app, /source: "mirror"/);
  assert.match(viewer, /desktop mirror/);
  assert.match(viewer, /pixel streaming is not enabled yet/);
  // mirror endpoint is deployment-specific (env-configurable), never a hardcoded
  // personal worker URL.
  assert.match(transport, /VITE_OSAI_MIRROR_URL/);
  assert.doesNotMatch(transport, /firazfhansurie/);
  assert.match(transport, /#mirror=/);
  assert.match(worker, /class MirrorRoom extends DurableObject/);
  assert.match(worker, /ctx\.acceptWebSocket/);
  assert.match(worker, /type: "snapshot"/);
  assert.match(worker, /type: "control"/);
  assert.match(workflow, /wrangler@latest deploy --config workers\/mirror\/wrangler\.jsonc/);
});

test("hosted web opens the real shell unless the url is a mirror link", () => {
  const app = read("src/App.tsx");

  assert.match(app, /const webMirrorMode = !nativeRuntime && mirrorPairing != null/);
  assert.match(app, /if \(webMirrorMode\) \{/);
  assert.doesNotMatch(app, /if \(!nativeRuntime\) \{\s+return \(\s+<MirrorViewer/);
  assert.match(app, /if \(panes\.length === 0\) return idleDash/);
});

test("hosted web chat uses a cloud chat transport instead of a dead preview", () => {
  const chatPane = read("src/components/ChatPane.tsx");
  const chatLib = read("src/lib/chat.ts");
  const fn = read("functions/api/chat.ts");

  assert.match(chatLib, /export async function webChatSend/);
  assert.match(chatLib, /fetch\("\/api\/chat"/);
  assert.match(chatPane, /const webChatRuntime = !nativeRuntime/);
  assert.match(chatPane, /webChatSend\(wire/);
  assert.doesNotMatch(chatPane, /web preview loaded\. live chat runs inside the desktop shell/);
  assert.match(fn, /OPENAI_API_KEY/);
  assert.match(fn, /OSAI_CHAT_MODEL/);
  assert.match(fn, /https:\/\/api\.openai\.com\/v1\/responses/);
});

test("hosted web shell is mobile and ipad first", () => {
  const app = read("src/App.tsx");

  assert.match(app, /const compactWebLayout = !nativeRuntime && webViewportCompact/);
  assert.match(app, /matchMedia\("\(max-width: 1024px\)"/);
  assert.match(app, /useState\(\(\) => !\(!nativeRuntime && window\.matchMedia/);
  assert.match(app, /if \(compactWebLayout\) return \{ cols: 1, rows: n \}/);
  assert.match(app, /sidebarOpen && !compactWebLayout/);
  assert.match(app, /compactWebLayout && \(\s+<MobileBottomNav/);
  assert.match(app, /function MobileBottomNav/);
});

test("sidebar exposes an icon-only rail mode", () => {
  const app = read("src/App.tsx");
  const settings = read("src/lib/settings.ts");
  const settingsPane = read("src/components/Settings.tsx");

  assert.match(settings, /sidebarMode: SidebarMode/);
  assert.match(settings, /export type SidebarMode = "full" \| "icons"/);
  assert.match(settingsPane, /rail style/);
  assert.match(app, /iconsOnly/);
});

test("shell exposes a shared notification center and controls", () => {
  const app = read("src/App.tsx");
  const settings = read("src/lib/settings.ts");
  const settingsPane = read("src/components/Settings.tsx");

  assert.match(app, /NotificationCenter/);
  assert.match(app, /subscribeNotifications/);
  assert.match(app, /openNotificationTarget/);
  assert.match(app, /reattach: t\.sessionId/);
  assert.match(app, /focusPane\(pane\.key\)/);
  assert.match(settings, /notificationNativeMode: NotificationNativeMode/);
  assert.match(settingsPane, /native alerts/);
});

test("scheduled agents open as chatpane-backed agents", () => {
  const app = read("src/App.tsx");
  const pane = read("src/components/ScheduledAgentsPane.tsx");
  const section = read("src/components/ScheduledAgentsSection.tsx");
  const idle = read("src/components/IdleDashboard.tsx");
  const apps = read("src/lib/apps.ts");
  const agents = read("src/lib/scheduledAgents.ts");

  assert.match(apps, /\| \{ type: "scheduled-agents" \}/);
  assert.match(apps, /agentId\?: string/);
  assert.match(apps, /modelId\?: string/);
  assert.match(app, /import\("\.\/components\/ScheduledAgentsPane"\)/);
  assert.match(app, /pane\.kind\.type === "scheduled-agents"/);
  assert.match(app, /<ScheduledAgentsPane onOpenAgentChat=\{onOpenScheduledAgentChat\} \/>/);
  assert.match(app, /scheduledAgentsSlot=/);
  assert.match(app, /chatpaneAgentsOnly/);
  assert.match(app, /embedded/);
  assert.match(app, /scheduledAgentChatStates/);
  // scheduled-agent chatpanes boot on the user's BASE model (follows their installed
  // engine), not a hardcoded codex model that fails when codex isn't installed.
  assert.match(app, /modelId: agentChatModelId\(\)/);
  assert.match(app, /function agentChatModelId\(\)[\s\S]*baseModelId\(/);
  assert.match(app, /modelId=\{pane\.kind\.type === "chat" \? pane\.kind\.modelId : undefined\}/);
  assert.match(app, /focusPane\(existingPane\.key\)/);
  assert.match(app, /reattach: live\.id/);
  assert.match(app, /scheduledAgentBootstrapRef/);
  assert.match(app, /setHiddenKeys\(\(current\)/);
  assert.match(app, /if \(command\) submitWhenReady\(existingPane\.key, command\);\s*else focusPane\(existingPane\.key\)/);
  assert.match(app, /if \(command\) \{\s*setHiddenKeys\(\(current\) => \(current\.includes\(key\) \? current : \[\.\.\.current, key\]\)\);/);
  assert.match(app, /buildScheduledAgentChatSeed/);
  assert.match(app, /loadScheduledAgentChatSession/);
  assert.match(app, /resume: \{ id: saved\.sessionId, title: saved\.title \}/);
  assert.match(section, /embedded/);
  assert.match(section, /createScheduledAgent/);
  assert.match(section, /new chatpane agent/);
  assert.match(section, /chatStateLabel/);
  assert.match(section, /onOpenAgentChat/);
  assert.doesNotMatch(section, /Terminal/);
  assert.match(pane, /osai agents/);
  assert.match(pane, /open chatpane/);
  assert.match(pane, /run pulse now/);
  assert.match(pane, /control update for all agents/);
  assert.match(pane, /current job/);
  assert.match(idle, /onOpenScheduledAgentChat/);
  assert.match(agents, /buildScheduledAgentChatSeed/);
  assert.match(agents, /buildScheduledAgentRunCommand/);
  assert.match(agents, /shell control plane/);
  assert.match(agents, /saveScheduledAgentChatSession/);
  // no developer name anywhere — the cleanse migration heals legacy stored
  // absolute home paths generically (no hardcoded username).
  assert.doesNotMatch(agents, /firazfhansurie/);
  assert.match(agents, /cleanseStored/);
  assert.match(agents, /ensureScheduledAgentHome/);
  assert.match(agents, /loadConfiguredScheduledAgents/);
  assert.match(agents, /createScheduledAgent/);
});

test("idle home is the Horizon lock screen: starfield sky + clock on the line + living ground", () => {
  const app = read("src/App.tsx");
  const idle = read("src/components/IdleDashboard.tsx");
  const controlCenter = read("src/components/IdleControlCenter.tsx");
  const usageGlance = read("src/components/dashboard/UsageGlance.tsx");
  const sidebarUsage = read("src/components/SidebarUsage.tsx");
  const css = read("src/App.css");

  // IdleDashboard is a thin loader that hands data to IdleControlCenter.
  assert.match(idle, /<IdleControlCenter/);
  assert.match(idle, /notifications=\{notifications\}/);

  // The landscape (owner picked sketch B): proportional bands — no scroll,
  // no fit-scale hack — with the composer-grade command line kept center.
  assert.match(controlCenter, /const HORIZON = \d+/);
  assert.match(controlCenter, /function SkyField/);
  assert.match(controlCenter, /function ClockBlock/);
  assert.match(controlCenter, /function HorizonPet/);
  assert.match(controlCenter, /function LockDock/);
  assert.match(controlCenter, /function ContinueShelf/);
  assert.match(controlCenter, /function CommandLine/);
  assert.match(controlCenter, /osai-horizon-line/);
  assert.match(controlCenter, /osai-lock-fly/);
  assert.match(controlCenter, /osai-lock-ridge-a/);

  // the dock is exactly the owner's three: chat · terminal · notes
  assert.match(controlCenter, /type: "notes"/);
  assert.doesNotMatch(controlCenter, /label: "browser"/);
  assert.doesNotMatch(controlCenter, /label: "history"/);

  // the ONE glanceable status row: agents chip opens the agents surface,
  // usage comes from the shared source, streak opens pulse.
  assert.match(controlCenter, /useUsageRates/);
  assert.match(controlCenter, /onOpenScheduledAgents/);
  assert.match(controlCenter, /currentStreak/);
  assert.match(controlCenter, /type: "pulse"/);

  // continue shelf: resume-layout card + work sessions (done/remove) +
  // recent projects w/ drift dots + overflow into the projects pane.
  // Rows are GROUND_PILLs — one material/scale family with the dock and the
  // command line (L4 owner feedback: "the different sizes feel weird").
  assert.match(controlCenter, /resumeLayout/);
  assert.match(controlCenter, /onResumeSession/);
  assert.match(controlCenter, /all projects →/);
  assert.match(controlCenter, /type: "projects"/);
  assert.match(controlCenter, /const GROUND_PILL/);
  assert.doesNotMatch(controlCenter, /surface-card/);

  // "continue" ordering = real access recency (opens + cwd spawns), never fs
  // mtime alone — agents editing files must not reorder the shelf (L4).
  assert.match(controlCenter, /projectAccessTimes/);
  assert.match(controlCenter, /lastAccessFor/);
  assert.match(app, /touchProjectAccess/);

  // exactly ONE pet on screen: the workspace's roaming overlay hides while
  // the home overlay covers it (the lock screen has its own resident).
  assert.match(app, /\{!homeOverlay && panes\.length > 0 && \(/);

  // the ambience family exists in CSS, stilled by reduce-motion
  for (const kf of [
    "osai-horizon-flow",
    "osai-lock-twinkle",
    "osai-lock-shoot",
    "osai-lock-fly",
    "osai-lock-ridge",
    "osai-lock-sat",
  ]) {
    assert.ok(css.includes(`@keyframes ${kf}`), `@keyframes ${kf} must exist`);
  }
  assert.match(css, /\[data-reduce-motion="true"\] :is\(\.osai-lock-star/);

  // the Mission Control era is fully retired on this surface
  assert.doesNotMatch(controlCenter, /Mission Control/);
  assert.doesNotMatch(controlCenter, /QuickActions/);
  assert.doesNotMatch(controlCenter, /MiniHistory/);
  assert.doesNotMatch(controlCenter, /PetDashboardCompanion/);

  // usage rendering is shared: SidebarUsage aliases the dashboard UsageGlance,
  // so the sidebar + home draw the bars from one source.
  assert.match(usageGlance, /export function ProviderBlock/);
  assert.match(usageGlance, /export function useUsageRates/);
  assert.match(sidebarUsage, /UsageGlance as SidebarUsage/);

  assert.match(app, /notifications=\{notifications\}/);
});

test("pane overview is button driven, not a global scroll gesture", () => {
  const app = read("src/App.tsx");

  assert.match(app, /show all panes/i); // Mission Control button (top bar + OPEN-rail pill)
  assert.match(app, /disabled=\{panes\.length === 0\}/); // dims/disables at 0 panes, no silent no-op
  assert.equal(app.includes('addEventListener("wheel", onWheel'), false);
  assert.equal(app.includes("wheelAccum"), false);
});

test("top bar can be compacted or hidden", () => {
  const app = read("src/App.tsx");
  const settings = read("src/lib/settings.ts");
  const settingsPane = read("src/components/Settings.tsx");
  const commands = read("src/lib/appCommands.ts");

  assert.match(settings, /topBarMode: TopBarMode/);
  assert.match(settings, /export type TopBarMode = "full" \| "compact" \| "hidden"/);
  assert.match(settings, /topBarMode: "hidden"/);
  assert.match(settings, /parsed\.topBarMode === "full" \|\| parsed\.topBarMode === "compact"/);
  assert.match(settingsPane, /top bar/);
  assert.match(app, /topBarMode === "hidden"/);
  assert.doesNotMatch(app, /uppercase tracking-\[0\.2em\][\s\S]*superapp/);
  assert.match(app, /className="glass flex h-7 shrink-0/);
  assert.match(commands, /view\.topbar\.hide/);
  assert.match(commands, /view\.topbar\.compact/);
  assert.doesNotMatch(app, /ThemeSwitcher/);
  assert.doesNotMatch(app, /superapp/i);
  assert.doesNotMatch(settingsPane, /superapp/i);
  // the appearance preview shows the CURRENT anatomy (S2, living-cockpit):
  // a floating window + composer deck, prompt line "❯ ship it".
  assert.match(settingsPane, /ship it/);
});

test("command palette promotes chatpane intelligence for freeform search", () => {
  const app = read("src/App.tsx");
  const palette = read("src/components/CommandPalette.tsx");

  assert.match(palette, /onAsk/);
  assert.match(palette, /onDeepSearch/);
  assert.match(palette, /ask osai:/);
  assert.match(palette, /deep search:/);
  assert.match(app, /askFromPalette/);
  assert.match(app, /deepSearchFromPalette/);
  assert.match(app, /type: "chat", seed: query/);
});

test("codex usage surfaces pace-risk warnings", () => {
  const chatPane = read("src/components/ChatPane.tsx");
  // pace-risk rendering lives ONLY in the shared UsageGlance (sidebar + idle
  // home) now — the composer dropped its own usage strip (the sidebar reading is
  // canonical), so ChatPane no longer references usagePaceRisk.
  const usageGlance = read("src/components/dashboard/UsageGlance.tsx");
  const usagePace = read("src/lib/usagePace.ts");

  assert.doesNotMatch(chatPane, /usagePaceRisk/);
  assert.match(chatPane, /contextLedger/);
  assert.match(chatPane, /est tok/);
  assert.match(usageGlance, /PaceWarning/);
  assert.match(usageGlance, /usagePaceRisk/);
  assert.match(usagePace, /fast pace/);
  assert.match(usagePace, /slow down/);
});

test("chatpane stop: codex interrupts, only opencode kill-restarts", () => {
  const chatPane = read("src/components/ChatPane.tsx");
  const state = read("src/lib/chatPaneState.ts");
  const chat = read("src/lib/chat.ts");
  const rust = read("src-tauri/src/chat.rs");

  assert.match(state, /stopStrategy/);
  // Round-1 parity: codex now stops via turn/interrupt (keeps the persistent
  // app-server + thread); only opencode still kill-and-restarts.
  assert.match(state, /kill-and-restart/);
  assert.match(state, /"interrupt"/);
  assert.match(rust, /codex_interrupt/);
  assert.match(chatPane, /chatStop\(id\)/);
  assert.match(chatPane, /backend restarted/);
  assert.match(chatPane, /backendBusy/);
  assert.match(chatPane, /activeRunRef\.current = streaming \|\| backendBusy/);
  assert.match(chatPane, /busy: \(\) => activeRunRef\.current/);
  assert.match(chat, /ChatReattachInfo/);
  assert.match(rust, /ChatReattachInfo/);
});

test("codex chatpane uses terminal-grade codex context by default", () => {
  const rust = read("src-tauri/src/chat.rs");
  const chat = read("src/lib/chat.ts");

  assert.match(rust, /deliberately uses the user's real `~\/\.codex`/);
  assert.match(rust, /OSAI_CODEX_FAST_HOME/);
  assert.match(rust, /let fast = fast_requested \|\| fast_env;/);
  assert.match(rust, /start_codex_appserver[\s\S]*if let Some\(ch\) = codex_chat_home\(fast\)/);
  assert.match(rust, /params\["model"\] = json!\(m\)/);
  assert.match(chat, /gpt-5\.3-codex-spark/);
  assert.match(chat, /gpt-5\.5/);
});

test("spark model labeling is explicitly gpt-5.3, never 5.5", () => {
  const chatPane = read("src/components/ChatPane.tsx");
  const sidebarUsage = read("src/components/SidebarUsage.tsx");
  const chat = read("src/lib/chat.ts");
  const source = [chatPane, sidebarUsage, chat].join("\n");

  assert.match(chat, /id: "gpt-5\.3-codex-spark"/);
  // The spark model's human label lives in the CHAT_MODELS registry (chat.ts) —
  // explicitly "gpt-5.3", never 5.5. (The composer's old usageProviderLabel that
  // also said "gpt-5.3 spark" was removed with the usage strip.)
  assert.match(chat, /label: "gpt-5\.3 codex spark"/);
  assert.match(chatPane, /\^gpt-5\\\.3-codex-spark\$/);
  assert.doesNotMatch(source, /5\.5[^"\n]*spark|spark[^"\n]*5\.5/i);
  assert.doesNotMatch(chatPane, /return "spark"/);
}
);

test("chatpane handoff targets the LIVE model catalog, not a hardcoded list", () => {
  const chatPane = read("src/components/ChatPane.tsx");

  assert.match(chatPane, /handoffPanelOpen/);
  assert.match(chatPane, /hand off to/);
  // targets come from the live picker/API model lists, grouped by engine —
  // NOT the old hardcoded CHAT_MODELS.map((target)) panel.
  assert.doesNotMatch(chatPane, /CHAT_MODELS\.map\(\(target\)/);
  assert.match(chatPane, /\[\.\.\.pickerModels, \.\.\.apiModels\]/);
  // the prompt + delivery + copy live in the shared, tested handoff helper
  assert.match(chatPane, /buildHandoffPrompt\(target, \{ delivery: handoffDelivery/);
  assert.match(chatPane, /handoffDelivery/);
  assert.match(chatPane, /copyHandoff/);
});

test("chatpane does not auto-timeout long agent runs", () => {
  const chatPane = read("src/components/ChatPane.tsx");

  assert.doesNotMatch(chatPane, /request timed out after 2 minutes/);
  assert.doesNotMatch(chatPane, /turnTimeoutRef/);
});

test("chatpane memory search is explicit slash command only", () => {
  const chatPane = read("src/components/ChatPane.tsx");

  assert.match(chatPane, /id: "memory"/);
  assert.match(chatPane, /setMemoryPanelOpen\(true\)/);
  assert.match(chatPane, /memoryPanelOpen &&/);
  assert.doesNotMatch(chatPane, /q\.length < 4/);
});

test("shell still surfaces source build state via the source-status backend", () => {
  const chatRust = read("src-tauri/src/chat.rs");

  assert.match(chatRust, /detached\.load\(Ordering::SeqCst\) \|\| s\.busy\.load/);
  assert.match(chatRust, /stopped by user/);
  assert.match(read("src/lib/fs.ts"), /shell_source_status/);
  assert.match(read("src-tauri/src/files.rs"), /pub fn shell_source_status/);
  assert.match(read("src-tauri/src/lib.rs"), /files::shell_source_status/);
});

test("shell exposes running mac apps as attachable pane targets", () => {
  const app = read("src/App.tsx");
  const apps = read("src/lib/apps.ts");
  const pane = read("src/components/AttachAppsPane.tsx");
  const attachedPane = read("src/components/AppAttachPane.tsx");
  const bridge = read("src/lib/macApps.ts");
  const rust = read("src-tauri/src/mac_apps.rs");
  const lib = read("src-tauri/src/lib.rs");

  assert.match(app, /AttachAppsPane/);
  assert.match(app, /AppAttachPane/);
  assert.match(app, /onAttachApp/);
  assert.match(apps, /type: "apps"/);
  assert.match(apps, /type: "app"/);
  assert.match(pane, /attach as pane/);
  assert.match(pane, /focusMacApp/);
  assert.match(attachedPane, /attached external app/);
  assert.match(attachedPane, /capture preview/);
  assert.match(attachedPane, /captureMacApp/);
  assert.match(attachedPane, /fileSrc\(capturePath\)/);
  assert.match(attachedPane, /direct native window embedding is not reliable on macos/);
  assert.match(bridge, /mac_list_apps/);
  assert.match(bridge, /mac_focus_app/);
  assert.match(bridge, /mac_capture_app/);
  assert.match(rust, /MacAppInfo/);
  assert.match(rust, /screencapture/);
  assert.match(lib, /mac_apps::mac_list_apps/);
  assert.match(lib, /mac_apps::mac_focus_app/);
  assert.match(lib, /mac_apps::mac_capture_app/);
});

test("chatpane autoscroll: a stick flag + ResizeObserver keep the view pinned to the newest message", () => {
  const chatPane = read("src/components/ChatPane.tsx");
  const scroll = read("src/lib/chatScroll.ts");

  // ONE source of truth (stick), re-pinned on EVERY content resize — not inferred
  // from scroll-direction intent, a programmatic-vs-user flag, or an rAF settle.
  assert.match(chatPane, /stickRef/);
  assert.match(chatPane, /new ResizeObserver/);
  assert.match(chatPane, /contentRef/);
  assert.match(chatPane, /useLayoutEffect/);
  // stick is a pure function of POSITION (near the bottom ⇒ follow) …
  assert.match(chatPane, /atBottom\(/);
  // … and the browser must not fight our scrollTop (scroll-anchoring off).
  assert.match(chatPane, /\[overflow-anchor:none\]/);
  // the jump-to-latest affordances stay: the pill + double-tap ↓.
  assert.match(chatPane, /scroll to bottom/);
  assert.match(chatPane, /lastArrowDownRef/);
  assert.match(chatPane, /e\.key === "ArrowDown" && !overlay/);
  assert.match(chatPane, /jumpToLatest\(\)/);
  // the old intent/pause machinery is fully retired.
  assert.doesNotMatch(chatPane, /nextAutoscrollPaused/);
  assert.doesNotMatch(chatPane, /programmaticRef/);
  assert.doesNotMatch(chatPane, /forceBottomRef/);
  // pure, unit-tested helpers back the position math.
  assert.match(scroll, /export function atBottom/);
  assert.match(scroll, /export function distanceFromBottom/);
});

test("chatpane pending steer queue stays attached to the shared composer", () => {
  const chatPane = read("src/components/ChatPane.tsx");
  const composerStart = chatPane.indexOf("const composer = useMemo");
  const queueStart = chatPane.indexOf("pending steer queue belongs with the composer");
  const composerShell = chatPane.indexOf("flash-composer", queueStart);
  const dockStart = chatPane.indexOf("shrink-0 border-t border-[var(--color-border)]");

  assert.notEqual(composerStart, -1);
  assert.ok(queueStart > composerStart, "queued steer list must render inside the shared composer");
  assert.ok(composerShell > queueStart, "queued steer list must sit above the composer input shell");
  assert.ok(dockStart > composerShell, "queued steer list must not be owned only by the docked footer");
  assert.match(chatPane, /steerQueued\(q\.id\)/);
  assert.match(chatPane, /moveQueued\(q\.id, -1\)/);
  assert.match(chatPane, /editQueued\(q\)/);
});

test("chatpane docked composer can collapse and reopen", () => {
  const chatPane = read("src/components/ChatPane.tsx");
  const composerStart = chatPane.indexOf("const composer = useMemo");
  const dockStart = chatPane.indexOf("shrink-0 border-t border-[var(--color-border)]");
  const hideButton = chatPane.indexOf("hide composer");
  const showButton = chatPane.indexOf("show composer");

  assert.notEqual(composerStart, -1);
  assert.notEqual(dockStart, -1);
  assert.ok(hideButton > composerStart, "hide control must live with the composer");
  assert.ok(showButton > dockStart, "reopen control must be available in the docked footer");
  assert.match(chatPane, /isComposerCollapsed/);
  assert.match(chatPane, /setComposerCollapsed\(true\)/);
  assert.match(chatPane, /setComposerCollapsed\(false\)/);
});

test("chat panes receive concrete cwd for shell context", () => {
  const app = read("src/App.tsx");
  const apps = read("src/lib/apps.ts");

  assert.match(apps, /type: "chat";[\s\S]*cwd\?: string/);
  assert.match(app, /const chatCwd = pane\.kind\.type === "chat"/);
  assert.match(app, /<ChatPane[\s\S]*cwd=\{chatCwd\}/);
});

test("shell exposes a policy-gated agent control bridge", () => {
  const app = read("src/App.tsx");
  const actions = read("src/lib/agentActions.ts");
  const controller = read("src/lib/agentController.ts");

  assert.match(app, /__osaiAgentControl/);
  assert.match(app, /osai-agent-action/);
  assert.match(actions, /agentActionPolicy/);
  assert.match(actions, /requires confirmation/);
  assert.match(controller, /createAgentController/);
  assert.match(controller, /!policy\.allowed/);
});

test("mac bundle wires entitlements and hardcodes no personal signing identity", () => {
  const tauri = read("src-tauri/tauri.conf.json");

  // ad-hoc signing ("-") breaks TCC permission persistence across mac builds.
  assert.equal(tauri.includes('"signingIdentity": "-"'), false);
  // a mac signing identity is the builder's own (env/CI), never baked into source.
  assert.doesNotMatch(tauri, /Apple Development: Firaz Fhansurie/);
  assert.match(tauri, /"entitlements": "\.\/Entitlements\.plist"/);
});

test("provider base follows the chosen CLI, not a hardcoded codex default (PLAN §13)", () => {
  const chat = read("src/lib/chat.ts");
  const chatPane = read("src/components/ChatPane.tsx");
  const settings = read("src/lib/settings.ts");

  // the single-source base selectors exist
  assert.match(chat, /export function baseModelId\(/);
  assert.match(chat, /export function defaultAiForProvider\(/);
  assert.match(chat, /export function engineForProvider\(/);

  // ChatPane boots the model from baseModelId (not a bare CHAT_MODELS\[0\] base)
  assert.match(chatPane, /baseModelId\(/);

  // the legacy migration that force-downgraded claude users to codex is gone
  assert.equal(
    /parsed\.chatProvider = "codex-cli"/.test(settings),
    false,
    "the claude→codex downgrade migration must stay removed",
  );
});

test("onboarding is gated + veteran-safe, and detect_providers is wired (PLAN §5)", () => {
  const settings = read("src/lib/settings.ts");
  const app = read("src/App.tsx");
  const libRs = read("src-tauri/src/lib.rs");
  const chatRs = read("src-tauri/src/chat.rs");

  // flag + veteran back-fill so existing installs never re-onboard
  assert.match(settings, /onboardingComplete: boolean/);
  assert.match(settings, /parsed\.onboardingComplete === undefined/);

  // mounted after the splash, gated on the flag
  assert.match(app, /!loadSettings\(\)\.onboardingComplete/);
  assert.match(app, /<Onboarding onClose=/);

  // the Rust detection command is registered
  assert.match(chatRs, /pub fn detect_providers\(\)/);
  assert.match(libRs, /chat::detect_providers/);
});

test("design-token ratchet: hardcoded color/elevation literals must not increase", () => {
  // The §10 lint guard, ratchet-style: these counts may only go DOWN as the
  // convergence sweep continues. If this test fails because a number grew, use
  // the token instead: readable-on-accent = --color-accent-fg, hover lift =
  // border-strong (accent is for active/primary/focus only, DESIGN.md §6),
  // floating surfaces = .surface-pop / --osai-shadow-pop.
  const dir = join(root, "src", "components");
  const sources = readdirSync(dir, { recursive: true })
    .filter((f) => String(f).endsWith(".tsx"))
    .map((f) => readFileSync(join(dir, String(f)), "utf8"))
    .join("\n");
  const count = (re: RegExp) => (sources.match(re) ?? []).length;
  const ratchet = (label: string, re: RegExp, max: number) => {
    const n = count(re);
    assert.ok(n <= max, `${label}: ${n} occurrences (ratchet max ${max}) — use the design token instead`);
  };
  ratchet("text-white", /text-white/g, 0);
  ratchet("text-black", /text-black/g, 0);
  // floor is 10, not 0: the survivors are TRUE primary/add affordances per
  // DESIGN.md §6 (palette ask-CTA, oracle/notes/scheduled add-CTAs, reply action
  // buttons, snippet tip). Decoration (rows, chips, floats) is border-strong.
  ratchet("hover accent border (use border-strong)", /hover:border-\[var\(--color-accent\)\]/g, 10);
  // floor is 3, not 0: TerminalComposer.tsx is locked (never edited) and
  // carries the last three. Everything editable is on --osai-shadow-pop.
  ratchet("shadow-2xl (use --osai-shadow-pop)", /shadow-2xl/g, 3);

  // Hex color literals — 0 outside the two legit users: TerminalRuntime.tsx
  // (xterm's 16-color ANSI palette is hex by contract) and Settings.tsx (the
  // theme/accent swatch DEFINITIONS are the source the tokens come from).
  const hexSources = readdirSync(dir, { recursive: true })
    .filter((f) => String(f).endsWith(".tsx"))
    .filter((f) => !/TerminalRuntime\.tsx$|Settings\.tsx$/.test(String(f)))
    .map((f) => readFileSync(join(dir, String(f)), "utf8"))
    .join("\n");
  const hexCount = (hexSources.match(/#[0-9a-fA-F]{6}\b/g) ?? []).length;
  assert.ok(
    hexCount <= 0,
    `hex color literals in components: ${hexCount} (ratchet max 0) — use a --color-* token (exempt: TerminalRuntime ANSI palette, Settings swatch definitions)`,
  );
});

test("panes are drag-to-move reorderable (pointer-driven, webview-safe)", () => {
  const app = read("src/App.tsx");
  // pointer-driven, because HTML5 draggable is swallowed by the Tauri webview;
  // the strip captures the pointer once armed and the target is hit-tested
  // from the DOM under the cursor (data-pane-key), so browser panes acquire.
  assert.match(app, /onPaneDragStart/);
  assert.match(app, /setPointerCapture/);
  assert.match(app, /elementFromPoint/);
  // text-selection is suppressed for the gesture so drags never paint smears.
  assert.match(app, /userSelect = "none"/);
  assert.match(app, /const swapPanes = useCallback/);
  // CRUCIAL: a reorder must NOT deactivate panes — that blanked native webviews
  // (the browser flicker/"offline" bug). The drag layers over still-live webviews.
  assert.equal(/!reordering/.test(app), false, "reorder must not deactivate panes");
});
