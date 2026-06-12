/** The ONE catalog of global shortcuts. The keydown switch in App.tsx (plus
 *  VoiceButton's ⌘J listener) is the EXECUTOR; this file is the user-facing
 *  truth both the Settings cheat-sheet and the Mod+? HUD render from — the old
 *  hand-maintained Settings array listed 6 of ~18 live chords and rotted
 *  whenever the switch changed. Labels are platform-correct via lib/platform.
 *  If you add a branch to the switch, add a row here. */
import { MOD, SHIFT, isApple } from "./platform";

export interface ShortcutEntry {
  /** Keycap tokens, already platform-resolved (e.g. ["Ctrl","K"]). */
  keys: string[];
  action: string;
  /** Quiet secondary detail (alternate chord, context note). */
  note?: string;
}

export interface ShortcutGroup {
  title: string;
  items: ShortcutEntry[];
}

/** Function (not a constant): MOD/SHIFT resolve per-platform at module load,
 *  but building lazily keeps any future runtime overrides cheap. */
export function shortcutGroups(): ShortcutGroup[] {
  return [
    {
      title: "launch",
      items: [
        { keys: [MOD, "K"], action: "command palette" },
        { keys: [MOD, SHIFT, "K"], action: "repeat last command" },
        { keys: [MOD, "P"], action: "go to file" },
        { keys: [MOD, SHIFT, "F"], action: "search in files" },
        { keys: [MOD, "T"], action: "new pane", note: `${MOD}+N too · browser-aware` },
        { keys: ["F5"], action: "run current project" },
        { keys: [MOD, "J"], action: "dictate (push-to-talk)" },
        { keys: [MOD, SHIFT, "J"], action: "conductor", note: "speak a layout + plan into existence" },
      ],
    },
    {
      title: "panes",
      items: [
        { keys: [MOD, "1…9"], action: "jump to nth pane" },
        { keys: [MOD, "`"], action: "mission control", note: "Ctrl+↑ too" },
        { keys: [MOD, "W"], action: "close pane" },
        { keys: [MOD, "M"], action: "hide pane", note: `${SHIFT} restores all` },
        { keys: [MOD, "F"], action: "find in chat / browser", note: "else fullscreen pane" },
        { keys: [MOD, "."], action: "focus spotlight" },
        { keys: ["Esc"], action: "exit maximized pane" },
      ],
    },
    {
      title: "app",
      items: [
        { keys: [MOD, "B"], action: "toggle sidebar" },
        { keys: [MOD, ","], action: "settings" },
        { keys: [MOD, "R"], action: "reload cockpit" },
        ...(isApple
          ? [{ keys: ["⌘", "⌘"], action: "appshot", note: "double-tap" }]
          : []),
        { keys: [MOD, "?"], action: "shortcut cheat sheet" },
      ],
    },
  ];
}
