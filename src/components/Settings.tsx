/** Glassmorphic settings window — native-feeling preferences modal for the
 *  OSAI cockpit. Left nav rail + scrollable right panel. Esc / backdrop close.
 *  Every control persists through src/lib/settings.ts. lowercase, terse. */
import {
  type ComponentType,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  Activity,
  Bell,
  Blocks,
  Check,
  Cpu,
  DownloadCloud,
  RefreshCw,
  SquareTerminal,
  Info,
  Keyboard,
  Minus,
  Eye,
  EyeOff,
  FileText,
  Monitor,
  MonitorUp,
  Moon,
  PanelLeft,
  Palette,
  Pencil,
  Plus,
  Radio,
  RotateCcw,
  Search,
  Trash2,
  Settings as SettingsIcon,
  Sun,
  Type,
  X,
} from "lucide-react";

import {
  scanWorkspaces,
  suggestedScanRoots,
  detectWorkspace,
  previewWorkspaceContext,
  generateWorkspaceContext,
} from "../lib/run";
import { AnimatePresence, m } from "motion/react";

import { modalPop, overlayFade } from "./fx/motionTokens";
import { SlidingIndicator } from "./fx/SlidingIndicator";
import { trapTab } from "./ui";
import {
  type ProjectWorkspace,
  type ProjectComponent,
  loadProjectWorkspacesStore,
  subscribeProjectWorkspaces,
  getScanRoots,
  addScanRoot,
  removeScanRoot,
  setWorkspaceName,
  setWorkspaceHidden,
  setWorkspaceRemoved,
  restoreAllRemoved,
  addCustomWorkspace,
  removeCustomWorkspace,
  projectShapeLabel,
  allComponents,
  normRoot,
} from "../lib/projectWorkspaces";

import {
  type AppSettings,
  type PaneType,
  type FlashLevel,
  type TranscribeVia,
  type NotificationNativeMode,
  type SidebarMode,
  type TopBarMode,
  loadSettings,
  saveSettings,
  applyFlashLevel,
  DEFAULT_SETTINGS,
} from "../lib/settings";
import {
  type Density,
  getDensity,
  applyDensity,
  applyFontScale,
  applyReduceMotion,
} from "../lib/appearance";
import { isApple } from "../lib/platform";
import { shortcutGroups } from "../lib/shortcuts";

import {
  type SidebarState,
  loadSidebar,
  toggleHidden,
  removeItem,
  resetSidebar,
  subscribe as subscribeSidebar,
} from "../lib/sidebar";
import { SPAWN_BY_ID } from "../lib/apps";
import { spawnPane } from "../lib/paneBus";
import { listPlugins, type Plugins } from "../lib/plugins";
import { listBridges, type Channel, type ChannelStatus } from "../lib/bridges";

import {
  type Accent,
  type Accent2,
  type Theme,
  ACCENT_PRESETS,
  ACCENT_ORDER,
  ACCENT2_PRESETS,
  ACCENT2_ORDER,
  getAccent,
  getAccent2,
  getAccentRecents,
  getTheme,
  normalizeHex,
  setAccent,
  setAccent2,
  setTheme,
  subscribe as subscribeTheme,
  subscribeAccent,
  subscribeAccent2,
} from "../lib/theme";
import {
  reportDiag,
  diagRecent,
  diagClear,
  diagInfo,
  type DiagEvent,
  type DiagInfo,
} from "../lib/diag";
import { invoke, isTauriRuntime } from "../lib/tauri";
import { refreshModelCatalog } from "../lib/modelCatalog";
import { applyDynamicCatalog } from "../lib/providers";
import { API_PROVIDERS, type ApiProviderId } from "../lib/providers";
import { setApiKey, deleteApiKey, listConfiguredProviders } from "../lib/apiKeys";
import { checkForUpdate, installUpdate, type UpdatePhase } from "../lib/updater";
import type { Update } from "@tauri-apps/plugin-updater";


/* ── control primitives ─────────────────────────────────────────────── */

/** Label (+ optional sub-description) on the left, control on the right. */
function Row({
  label,
  sub,
  subClassName,
  children,
}: {
  /** usually a string; nodes allowed for status-dot labels (channels S1). */
  label: ReactNode;
  sub?: string;
  /** override the sub line's color (e.g. a live status readout). */
  subClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] text-[var(--color-text)]">{label}</div>
        {sub && (
          <div className={`mt-0.5 text-[11px] leading-snug ${subClassName ?? "text-[var(--color-muted)]"}`}>
            {sub}
          </div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Pill switch — slides + goes accent when on. */
function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="press relative h-[22px] w-[38px] rounded-full border transition-all duration-200"
      style={{
        background: checked
          ? "var(--color-accent)"
          : "color-mix(in srgb, var(--color-panel-2) 70%, transparent)",
        borderColor: checked
          ? "var(--color-accent)"
          : "var(--color-border-strong)",
        boxShadow: checked
          ? "var(--osai-glow-soft)"
          : "inset 0 1px 0 0 var(--osai-glass-edge)",
      }}
    >
      <span
        className="absolute top-[2px] h-[16px] w-[16px] rounded-full bg-white shadow transition-all duration-200"
        style={{ left: checked ? "18px" : "2px" }}
      />
    </button>
  );
}

/** Number stepper with - / + and bounds. */
function Stepper({
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const stepBtn =
    "press grid h-6 w-6 place-items-center rounded-md text-[var(--color-text-2)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)] hover:text-[var(--color-accent)] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[var(--color-text-2)]";
  return (
    <div className="flex items-center gap-1 rounded-lg border border-[var(--osai-surface-edge)] bg-[color-mix(in_srgb,var(--color-panel-2)_55%,transparent)] p-0.5 backdrop-blur-sm">
      <button
        onClick={() => onChange(clamp(value - step))}
        disabled={value <= min}
        className={stepBtn}
      >
        <Minus size={12} />
      </button>
      <span className="min-w-[42px] text-center font-mono text-[12px] tabular-nums text-[var(--color-text)]">
        {value}
        {suffix ? <span className="text-[var(--color-muted)]">{suffix}</span> : null}
      </span>
      <button
        onClick={() => onChange(clamp(value + step))}
        disabled={value >= max}
        className={stepBtn}
      >
        <Plus size={12} />
      </button>
    </div>
  );
}

/** Range slider — accent fill, value readout. */
function Slider({
  value,
  min = 0,
  max = 100,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex w-[180px] items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full outline-none [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_28%,transparent),0_1px_3px_rgba(0,0,0,0.4)] [&::-webkit-slider-thumb]:transition-shadow hover:[&::-webkit-slider-thumb]:shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-accent)_40%,transparent),0_1px_3px_rgba(0,0,0,0.4)]"
        style={{
          background: `linear-gradient(to right, var(--color-accent) 0%, var(--osai-accent-2) ${pct}%, color-mix(in srgb, white 8%, transparent) ${pct}%)`,
        }}
      />
      <span className="w-7 text-right font-mono text-[11px] tabular-nums text-[var(--color-muted)]">
        {value}
      </span>
    </div>
  );
}

/** Segmented control — one of N options, accent on selected. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-[9px] border border-[var(--osai-surface-edge)] bg-[color-mix(in_srgb,white_3%,transparent)] backdrop-blur-sm">
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`press px-3 py-1.5 text-[12px] transition-colors ${
              i > 0 ? "border-l border-[var(--osai-surface-edge)]" : ""
            }`}
            style={{
              background: active
                ? "color-mix(in srgb, var(--color-accent) 18%, transparent)"
                : "transparent",
              color: active ? "var(--color-text)" : "var(--color-text-2)",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── appearance helpers ─────────────────────────────────────────────────────
   The density / font-scale / reduce-motion setters now live in
   src/lib/appearance.ts so the app boot path applies them too (see imports). */

/** Codex-style theme picker — segmented, icon + label, with a preview hint
 *  swatch under each option. Wired through theme.ts so it stays in sync with
 *  the settings surface. */
function ThemePicker({
  value,
  onChange,
}: {
  value: Theme;
  onChange: (t: Theme) => void;
}) {
  const opts: {
    value: Theme;
    label: string;
    Icon: ComponentType<{ size?: number }>;
    /* mini preview: window bg + bar */
    bg: string;
    bar: string;
  }[] = [
    { value: "system", label: "system", Icon: Monitor, bg: "linear-gradient(120deg, #1a1c1f 0 50%, #f5f5f4 50% 100%)", bar: "var(--color-accent)" },
    { value: "light", label: "light", Icon: Sun, bg: "#f5f5f4", bar: "var(--color-accent)" },
    { value: "dark", label: "dark", Icon: Moon, bg: "#1a1c1f", bar: "var(--color-accent)" },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {opts.map(({ value: v, label, Icon, bg, bar }) => {
        const active = v === value;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(v)}
            className="group flex flex-col items-stretch gap-2 rounded-xl border p-2 text-left transition-all"
            style={{
              borderColor: active
                ? "var(--color-accent)"
                : "var(--color-border)",
              background: active
                ? "var(--color-accent-soft)"
                : "var(--color-panel-2)",
              boxShadow: active ? "0 0 0 1px var(--color-accent)" : "none",
            }}
          >
            {/* mini window preview */}
            <div
              className="relative h-10 w-full overflow-hidden rounded-lg border"
              style={{ background: bg, borderColor: "var(--color-border)" }}
            >
              <span
                className="absolute left-1.5 top-1.5 h-1 w-6 rounded-full"
                style={{ background: bar }}
              />
              <span
                className="absolute left-1.5 top-3.5 h-1 w-9 rounded-full opacity-50"
                style={{ background: "#888" }}
              />
            </div>
            <span
              className="flex items-center gap-1.5 text-[12px]"
              style={{
                color: active ? "var(--color-accent)" : "var(--color-text-2)",
              }}
            >
              <Icon size={13} />
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A single round accent dot. Active = ringed + check. */
function AccentDot({
  hex,
  active,
  label,
  onClick,
}: {
  hex: string;
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className="relative grid h-7 w-7 place-items-center rounded-full transition-transform hover:scale-110"
      style={{
        background: hex,
        boxShadow: active
          ? "0 0 0 2px var(--color-panel), 0 0 0 4px var(--color-text)"
          : "0 0 0 1px rgba(0,0,0,0.25) inset",
      }}
    >
      {active && <Check size={14} strokeWidth={3} color="#fff" />}
    </button>
  );
}

/** Accent swatch row — 6 presets + recent customs + a "custom" picker.
 *  Click any swatch (or pick/type a hex) to re-tint the whole app live. */
function AccentSwatches({
  value,
  onChange,
  presets = ACCENT_PRESETS,
  order = ACCENT_ORDER,
}: {
  value: string;
  onChange: (a: string) => void;
  /** preset table + row order — defaults to the primary accent's; the glow
   *  row (accent-2) passes its own. Custom hexes share one recents list. */
  presets?: Record<string, string>;
  order?: readonly string[];
}) {
  const colorInputRef = useRef<HTMLInputElement>(null);
  const custom = !(value in presets);
  // current base hex (preset or custom) — drives the picker + hex field.
  const currentHex = presets[value] ?? normalizeHex(value) ?? Object.values(presets)[0]!;
  const [hexDraft, setHexDraft] = useState(currentHex);
  const [recents, setRecents] = useState<string[]>(getAccentRecents);

  // keep the draft + recents in sync when the accent changes elsewhere.
  useEffect(() => {
    setHexDraft(currentHex);
    setRecents(getAccentRecents());
  }, [currentHex]);

  const commitHex = (raw: string) => {
    const norm = normalizeHex(raw);
    if (norm) onChange(norm);
  };

  return (
    <div className="flex flex-col items-end gap-2.5">
      <div className="flex items-center gap-2.5">
        {order.map((a) => (
          <AccentDot
            key={a}
            hex={presets[a]!}
            active={value === a}
            label={a}
            onClick={() => onChange(a)}
          />
        ))}

        {/* recent custom colors */}
        {recents.map((hex) => (
          <AccentDot
            key={hex}
            hex={hex}
            active={custom && currentHex === hex}
            label={hex}
            onClick={() => onChange(hex)}
          />
        ))}

        {/* custom — rainbow + opens native color picker */}
        <button
          type="button"
          aria-label="custom color"
          title="custom color"
          aria-pressed={custom}
          onClick={() => colorInputRef.current?.click()}
          className="relative grid h-7 w-7 place-items-center rounded-full transition-transform hover:scale-110"
          style={{
            background:
              "conic-gradient(from 0deg, #ff5f57, #febc2e, #28c840, #339cff, #924ff7, #fb5b86, #ff5f57)",
            boxShadow: custom
              ? "0 0 0 2px var(--color-panel), 0 0 0 4px var(--color-text)"
              : "0 0 0 1px rgba(0,0,0,0.25) inset",
          }}
        >
          <Plus size={13} strokeWidth={3} color="#fff" />
          {/* the actual color input lives here, visually hidden but anchored
              under the swatch so the OS picker pops near it. */}
          <input
            ref={colorInputRef}
            type="color"
            value={currentHex}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-hidden
            tabIndex={-1}
          />
        </button>
      </div>

      {/* editable hex field — type or paste any color. */}
      <div className="flex items-center gap-2">
        <span
          className="h-4 w-4 shrink-0 rounded-[5px]"
          style={{
            background: currentHex,
            boxShadow: "0 0 0 1px rgba(0,0,0,0.25) inset",
          }}
        />
        <span className="font-mono text-[12px] text-[var(--color-muted)]">#</span>
        <input
          value={hexDraft.replace(/^#/, "")}
          onChange={(e) => setHexDraft(e.target.value)}
          onBlur={() => {
            commitHex(hexDraft);
            setHexDraft(currentHex);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commitHex(hexDraft);
              (e.target as HTMLInputElement).blur();
            }
          }}
          spellCheck={false}
          maxLength={6}
          placeholder={Object.values(presets)[0]?.replace(/^#/, "")}
          className="w-[72px] rounded-md border border-[var(--color-border)] bg-[var(--color-panel-2)]/50 px-2 py-1 font-mono text-[12px] uppercase tracking-wide text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
        />
      </div>
    </div>
  );
}

/** A live preview card — shows theme + accent + font scale against the app's
 *  CURRENT anatomy (S2, living-cockpit): a floating window on the ambient
 *  canvas with a chat line + the composer deck (filament, chips, send orb) —
 *  not the retired sidebar-grid look. Every color is a live token, so each
 *  appearance change repaints it instantly. */
function AppearancePreview({ fontPx }: { fontPx: number }) {
  return (
    <div
      className="relative overflow-hidden rounded-xl border"
      style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
    >
      {/* ambient canvas */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-8 -top-10 h-28 w-28 rounded-full opacity-25 blur-2xl"
        style={{ background: "var(--color-accent)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-12 -right-6 h-28 w-28 rounded-full opacity-[0.18] blur-2xl"
        style={{ background: "var(--osai-accent-2)" }}
      />
      {/* a second window peeking behind — the workspace has depth now */}
      <div
        aria-hidden
        className="absolute right-5 top-6 h-16 w-40 rounded-lg border opacity-50"
        style={{ borderColor: "var(--color-border)", background: "var(--color-panel)" }}
      />

      {/* the floating window */}
      <div
        className="relative m-4 mr-16 rounded-lg border shadow-[var(--osai-shadow-pop)]"
        style={{ borderColor: "var(--color-border-strong)", background: "var(--color-pane)" }}
      >
        <div
          className="flex items-center gap-1.5 border-b px-2.5 py-1.5"
          style={{ borderColor: "var(--color-border)" }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--color-success)" }} />
          <span className="font-mono text-[9.5px] text-[var(--color-muted)]">chat</span>
          <span className="ml-auto font-mono text-[9px] tracking-widest text-[var(--color-faint)]">
            – ⤢ ✕
          </span>
        </div>

        <p className="px-3 pt-2.5 leading-relaxed text-[var(--color-text-2)]" style={{ fontSize: fontPx }}>
          <span style={{ color: "var(--color-accent)" }}>◆ </span>
          windows glide, menus stay solid.{" "}
          <span style={{ background: "var(--color-selection)" }}>selected text</span> looks like
          this.
        </p>

        {/* mini composer deck — filament + chips + orb */}
        <div
          className="relative m-2.5 rounded-xl border px-2.5 py-2"
          style={{ borderColor: "var(--color-border-strong)", background: "var(--color-panel)" }}
        >
          <span
            aria-hidden
            className="absolute inset-x-3 top-0 h-[2px] rounded-full opacity-80"
            style={{
              background:
                "linear-gradient(90deg, transparent, var(--color-accent), var(--osai-accent-2), transparent)",
            }}
          />
          <p className="font-mono leading-none text-[var(--color-text)]" style={{ fontSize: fontPx }}>
            <span style={{ color: "var(--color-accent)" }}>❯</span> ship it
            <span
              className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px]"
              style={{ background: "var(--color-cursor)" }}
            />
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            <span
              className="rounded-full border px-1.5 py-0.5 font-mono text-[8.5px]"
              style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
            >
              model
            </span>
            <span
              className="rounded-full border px-1.5 py-0.5 font-mono text-[8.5px]"
              style={{
                borderColor: "color-mix(in srgb, var(--color-accent) 40%, transparent)",
                color: "var(--color-accent)",
                background: "var(--color-accent-soft)",
              }}
            >
              plan
            </span>
            <span
              className="ml-auto grid h-5 w-5 place-items-center rounded-full text-[10px] leading-none"
              style={{ background: "var(--color-accent)", color: "var(--color-accent-fg)" }}
            >
              ↑
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The card eyebrow — mono machine-voice label that sits at the top of a card. */
function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-4 pt-3 font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--color-faint)]">
      {children}
    </div>
  );
}

/** A labeled group of controls rendered as one Neon Glass card — the building
 *  block every section is composed from. The eyebrow rides inside the card lip;
 *  rows are separated by a whisper divider (a single custom child draws none). */
function Card({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <section className="mb-4 last:mb-1">
      <div className="surface-card rounded-[14px]">
        {label && <GroupLabel>{label}</GroupLabel>}
        <div className="flex flex-col divide-y divide-[color-mix(in_srgb,var(--color-border)_60%,transparent)] px-4">
          {children}
        </div>
      </div>
    </section>
  );
}

/* Shared glass field styles — a translucent fill + accent focus-glow, so every
   text input across the sections reads the same. Add a width per use. */
const FIELD =
  "glow-focus rounded-lg border border-[var(--osai-surface-edge)] bg-[color-mix(in_srgb,var(--color-panel-2)_45%,transparent)] px-2.5 py-1 text-[12px] text-[var(--color-text)] outline-none";
const FIELD_MONO =
  "glow-focus rounded-lg border border-[var(--osai-surface-edge)] bg-[color-mix(in_srgb,var(--color-panel-2)_45%,transparent)] px-2.5 py-1 font-mono text-[11px] text-[var(--color-text)] outline-none";
/** Quiet glass button — the secondary action across the sections. */
const GHOST_BTN =
  "press flex items-center gap-1.5 rounded-lg border border-[var(--osai-surface-edge)] bg-[color-mix(in_srgb,var(--color-panel-2)_45%,transparent)] px-2.5 py-1 text-[12px] text-[var(--color-text-2)] transition-colors hover:border-[var(--osai-surface-edge-strong)] hover:text-[var(--color-text)]";

/* ── sections ───────────────────────────────────────────────────────── */

type SectionId =
  | "general"
  | "appearance"
  | "sidebar"
  | "notifications"
  | "projects"
  | "oracles"
  | "channels"
  | "plugins"
  | "diagnostics"
  | "shortcuts"
  | "about";

type NavGroup = "preferences" | "workspace" | "system";

type NavItem = {
  id: SectionId;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  group: NavGroup;
  /** Extra search terms so the rail filter finds a section by what's inside it. */
  keywords?: string;
};

const NAV: NavItem[] = [
  // preferences — how the cockpit looks + behaves for you
  { id: "general", label: "general", icon: SettingsIcon, group: "preferences", keywords: "name startup tray socket mirror codex dictation pane reopen layout" },
  { id: "appearance", label: "appearance", icon: Palette, group: "preferences", keywords: "theme accent color font size density motion splash top bar flash dark light" },
  { id: "sidebar", label: "sidebar", icon: PanelLeft, group: "preferences", keywords: "rail items pin reorder icons hide" },
  { id: "notifications", label: "notifications", icon: Bell, group: "preferences", keywords: "alerts native quiet sound soundscape effects bell" },
  // workspace — the agents + data the cockpit drives (projects live in their own sidebar pane now)
  { id: "oracles", label: "oracles", icon: Cpu, group: "workspace", keywords: "agent tmux session refresh interval" },
  { id: "channels", label: "channels", icon: Radio, group: "workspace", keywords: "bridge integrations connect pair" },
  { id: "plugins", label: "plugins", icon: Blocks, group: "workspace", keywords: "extensions blocks add-ons" },
  // system — diagnostics, bindings, the build itself
  { id: "diagnostics", label: "diagnostics", icon: Activity, group: "system", keywords: "logs errors events local install usage perf" },
  { id: "shortcuts", label: "shortcuts", icon: Keyboard, group: "system", keywords: "keys bindings hotkeys chords keyboard" },
  { id: "about", label: "about", icon: Info, group: "system", keywords: "version update github docs build" },
];

const NAV_GROUPS: { id: NavGroup; title: string }[] = [
  { id: "preferences", title: "preferences" },
  { id: "workspace", title: "workspace" },
  { id: "system", title: "system" },
];

/** One-line orientation under each section title. */
const SECTION_BLURB: Record<SectionId, string> = {
  general: "identity, startup, and the integrations the cockpit talks to.",
  appearance: "theme, accent, type, and how much the cockpit moves.",
  sidebar: "what shows in the rail, and how it's laid out.",
  notifications: "how panes and background runs are allowed to interrupt you.",
  projects: "the repos the homescreen offers — add, hide, or rename them.",
  oracles: "defaults for the agents OSAI spawns into terminals.",
  channels: "bridges to the services OSAI speaks to.",
  plugins: "extensions that add panes and capabilities.",
  diagnostics: "local-first event log — nothing leaves this machine.",
  shortcuts: "every keyboard chord, straight from the live catalog.",
  about: "build, credits, and software updates.",
};

/** A keycap chip — font-mono, raised. */
function Keycap({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-grid min-w-[22px] place-items-center rounded-md border border-[var(--color-border-strong)] bg-[var(--color-panel-2)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-text)] shadow-sm">
      {children}
    </kbd>
  );
}

// (the hand-maintained SHORTCUTS array is gone — it listed 6 of ~18 live
//  chords and rotted whenever the keydown switch changed. The cheat-sheet now
//  renders the same lib/shortcuts.ts catalog the Mod+? HUD uses.)

/* ── diagnostics section (local-first, zero network) ────────────────── */

/** Color a kind chip — errors hot, usage muted, perf neutral. */
function kindClass(kind: string): string {
  if (kind === "error") return "text-[var(--color-danger)]";
  if (kind === "perf") return "text-[var(--color-accent)]";
  return "text-[var(--color-muted)]"; // usage
}

/** software-update card (about section): ask GitHub Releases for a newer signed
 *  build, then download + install + relaunch in place. Tauri-only — the web
 *  shell can't self-update, so it renders nothing there. The whole mechanism
 *  (endpoint, pubkey, signing) lives in tauri.conf.json + RELEASING.md; this is
 *  just the surface. */
function UpdateCard() {
  const [phase, setPhase] = useState<UpdatePhase>({ kind: "idle" });
  const [update, setUpdate] = useState<Update | null>(null);

  if (!isTauriRuntime()) return null;

  const busy =
    phase.kind === "checking" || phase.kind === "downloading" || phase.kind === "installing";

  const runCheck = async () => {
    setPhase({ kind: "checking" });
    setUpdate(null);
    try {
      const u = await checkForUpdate();
      if (!u) {
        setPhase({ kind: "none" });
        return;
      }
      setUpdate(u);
      setPhase({ kind: "available", version: u.version, notes: u.body ?? null });
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  const runInstall = async () => {
    if (!update) return;
    // installUpdate drives setPhase through downloading → installing → ready,
    // then relaunches (the promise usually never resolves). It folds any error
    // into the phase itself, so the catch here is just to keep the await tidy.
    try {
      await installUpdate(update, setPhase);
    } catch {
      /* phase already === error */
    }
  };

  const status = (() => {
    switch (phase.kind) {
      case "checking":
        return "checking for updates…";
      case "none":
        return "you're on the latest version";
      case "available":
        return `version ${phase.version} is available`;
      case "downloading":
        return phase.pct == null ? "downloading…" : `downloading… ${phase.pct}%`;
      case "installing":
        return "installing…";
      case "ready":
        return "installed — restarting…";
      case "error":
        return `couldn't update: ${phase.message}`;
      default:
        return "check github releases for a newer build";
    }
  })();

  return (
    <div className="surface-card mt-1 w-full max-w-[360px] p-3 text-left">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] font-medium text-[var(--color-text)]">software update</span>
        {phase.kind === "available" ? (
          <button
            type="button"
            onClick={runInstall}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--color-accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_15%,transparent)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-accent)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-accent)_25%,transparent)] disabled:opacity-50"
          >
            <DownloadCloud size={13} /> install v{phase.version}
          </button>
        ) : (
          <button
            type="button"
            onClick={runCheck}
            disabled={busy}
            className={`${GHOST_BTN} disabled:opacity-50`}
          >
            <RefreshCw size={13} className={busy ? "animate-spin" : ""} /> check
          </button>
        )}
      </div>
      <p
        className={`mt-1.5 text-[11px] leading-snug ${
          phase.kind === "error" ? "text-[var(--color-danger)]" : "text-[var(--color-muted)]"
        }`}
      >
        {status}
      </p>
      {phase.kind === "downloading" && (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[var(--color-panel-2)]">
          <div
            className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-300"
            style={{ width: phase.pct == null ? "100%" : `${phase.pct}%` }}
          />
        </div>
      )}
      {phase.kind === "available" && phase.notes && (
        <p className="mt-2 max-h-24 overflow-y-auto whitespace-pre-line text-[11px] leading-snug text-[var(--color-text-2)]">
          {phase.notes}
        </p>
      )}
    </div>
  );
}

/** Reads the local diag store (Phase 1) and renders recent events newest-first,
 *  filterable by kind/source, with a clear button + the anon install id / app
 *  version header. Everything stays on-device — no network, no consent prompt. */
function DiagnosticsSection() {
  const [events, setEvents] = useState<DiagEvent[]>([]);
  const [info, setInfo] = useState<DiagInfo>({
    install_id: "",
    app_version: "",
    os: "",
  });
  const [kindFilter, setKindFilter] = useState<"all" | "error" | "usage" | "perf">("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    Promise.all([diagRecent(300), diagInfo()])
      .then(([evs, nfo]) => {
        setEvents(evs);
        setInfo(nfo);
      })
      .catch((e) => reportDiag("settings.diagnostics", e, { action: "refresh" }))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearAll = () => {
    diagClear()
      .then(() => {
        setEvents([]);
      })
      .catch((e) => reportDiag("settings.diagnostics", e, { action: "clear" }));
  };

  // Distinct sources for the filter dropdown.
  const sources = Array.from(new Set(events.map((e) => e.source))).sort();

  // Error count by source (the local pre-cluster).
  const errorBySource = new Map<string, number>();
  for (const e of events) {
    if (e.kind === "error") {
      errorBySource.set(e.source, (errorBySource.get(e.source) ?? 0) + 1);
    }
  }
  const topErrors = Array.from(errorBySource.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const filtered = events.filter(
    (e) =>
      (kindFilter === "all" || e.kind === kindFilter) &&
      (sourceFilter === "all" || e.source === sourceFilter),
  );

  const errorCount = events.filter((e) => e.kind === "error").length;
  const usageCount = events.filter((e) => e.kind === "usage").length;

  return (
    <div className="flex flex-col gap-4 text-[12px]">
      {/* header: install id + version + os */}
      <div className="surface-card flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
            install id
          </span>
          <span className="font-mono text-[11px] text-[var(--color-text-2)]">
            {info.install_id || "—"}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 text-right">
          <span className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
            version · os
          </span>
          <span className="font-mono text-[11px] text-[var(--color-text-2)]">
            {info.app_version || "—"} · {info.os || "—"}
          </span>
        </div>
      </div>

      {/* summary counts */}
      <div className="flex flex-wrap gap-2">
        <span className="rounded-md bg-[var(--color-panel-2)]/50 px-2 py-1 text-[11px] text-[var(--color-text-2)]">
          {events.length} events
        </span>
        <span className="rounded-md bg-[var(--color-panel-2)]/50 px-2 py-1 text-[11px] text-[var(--color-danger)]">
          {errorCount} errors
        </span>
        <span className="rounded-md bg-[var(--color-panel-2)]/50 px-2 py-1 text-[11px] text-[var(--color-muted)]">
          {usageCount} usage
        </span>
      </div>

      {/* error-by-source pre-cluster */}
      {topErrors.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
            errors by source
          </span>
          <div className="flex flex-wrap gap-1.5">
            {topErrors.map(([src, n]) => (
              <button
                key={src}
                onClick={() => {
                  setKindFilter("error");
                  setSourceFilter(src);
                }}
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-panel-2)]/40 px-2 py-0.5 font-mono text-[10px] text-[var(--color-text-2)] transition-colors hover:border-[var(--color-danger)]"
                title="filter to this source"
              >
                {src} · {n}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* controls */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)}
          className="rounded-lg border border-[var(--osai-surface-edge)] bg-[color-mix(in_srgb,var(--color-panel-2)_45%,transparent)] px-2 py-1 text-[11px] text-[var(--color-text)] outline-none"
        >
          <option value="all">all kinds</option>
          <option value="error">errors</option>
          <option value="usage">usage</option>
          <option value="perf">perf</option>
        </select>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="rounded-lg border border-[var(--osai-surface-edge)] bg-[color-mix(in_srgb,var(--color-panel-2)_45%,transparent)] px-2 py-1 text-[11px] text-[var(--color-text)] outline-none"
        >
          <option value="all">all sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button onClick={refresh} className={`${GHOST_BTN} text-[11px]`}>
          refresh
        </button>
        <button
          onClick={clearAll}
          className="press ml-auto rounded-lg border border-[var(--osai-surface-edge)] bg-[color-mix(in_srgb,var(--color-panel-2)_45%,transparent)] px-2.5 py-1 text-[11px] text-[var(--color-danger)] transition-colors hover:border-[color-mix(in_srgb,var(--color-danger)_50%,transparent)]"
        >
          clear
        </button>
      </div>

      {/* event list */}
      <div className="flex flex-col gap-1.5">
        {loading ? (
          <span className="text-[11px] text-[var(--color-muted)]">loading…</span>
        ) : filtered.length === 0 ? (
          <span className="text-[11px] text-[var(--color-muted)]">
            no events yet — nothing has errored (or been used) since the store was
            created. local-first: nothing leaves this machine.
          </span>
        ) : (
          filtered.map((ev, i) => (
            <div
              key={`${ev.ts}-${i}`}
              className="surface-card flex flex-col gap-0.5 px-2.5 py-1.5"
            >
              <div className="flex items-center gap-2">
                <span className={`font-mono text-[10px] uppercase ${kindClass(ev.kind)}`}>
                  {ev.kind}
                </span>
                <span className="font-mono text-[11px] text-[var(--color-text)]">
                  {ev.source}
                  {ev.action ? ` · ${ev.action}` : ""}
                </span>
                <span className="ml-auto font-mono text-[10px] text-[var(--color-muted)]">
                  {ev.ts.replace("T", " ").replace(/\.\d+Z$/, "")}
                </span>
              </div>
              {ev.kind !== "usage" && ev.message && (
                <pre className="whitespace-pre-wrap break-all text-[10px] text-[var(--color-text-2)]">
                  {ev.message}
                </pre>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ── projects (structured workspaces) section ───────────────────────── */

const ICON_BTN =
  "press grid h-7 w-7 place-items-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]";

/** A small role / stack / status chip (mono, tinted by tone). */
function MetaChip({
  label,
  tone = "muted",
}: {
  label: string;
  tone?: "accent" | "cyan" | "muted" | "warn" | "wip";
}) {
  const tones: Record<string, { bg: string; fg: string; bd: string }> = {
    accent: {
      bg: "color-mix(in srgb, var(--color-accent) 16%, transparent)",
      fg: "var(--color-accent)",
      bd: "color-mix(in srgb, var(--color-accent) 40%, transparent)",
    },
    cyan: {
      bg: "color-mix(in srgb, var(--osai-accent-2) 14%, transparent)",
      fg: "var(--osai-accent-2)",
      bd: "color-mix(in srgb, var(--osai-accent-2) 38%, transparent)",
    },
    warn: {
      bg: "color-mix(in srgb, var(--color-warning) 16%, transparent)",
      fg: "var(--color-warning)",
      bd: "color-mix(in srgb, var(--color-warning) 38%, transparent)",
    },
    wip: {
      bg: "color-mix(in srgb, var(--color-success) 16%, transparent)",
      fg: "var(--color-success)",
      bd: "color-mix(in srgb, var(--color-success) 38%, transparent)",
    },
    muted: {
      bg: "color-mix(in srgb, var(--color-panel-2) 60%, transparent)",
      fg: "var(--color-muted)",
      bd: "var(--color-border)",
    },
  };
  const t = tones[tone];
  return (
    <span
      className="shrink-0 rounded-[5px] border px-1.5 py-px font-mono text-[9px] uppercase tracking-wide"
      style={{ background: t.bg, color: t.fg, borderColor: t.bd }}
    >
      {label}
    </span>
  );
}

const ROLE_TONE: Record<string, "accent" | "cyan" | "muted"> = {
  frontend: "accent",
  fullstack: "accent",
  backend: "cyan",
};

/** One component row — name + role/stack/status chips + path. */
function ComponentRow({ ws, comp }: { ws: ProjectWorkspace; comp: ProjectComponent }) {
  const supName = comp.supersedes
    ? allComponents(ws).find((c) => c.id === comp.supersedes)?.name
    : null;
  const status = comp.status && comp.status !== "current" ? comp.status : null;
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="truncate text-[12.5px] text-[var(--color-text-2)]">{comp.name}</span>
        <MetaChip label={comp.role} tone={ROLE_TONE[comp.role] ?? "muted"} />
        {comp.stack && <MetaChip label={comp.stack} tone="muted" />}
        {status === "wip" && <MetaChip label="wip" tone="wip" />}
        {(status === "legacy" || status === "deprecated") && <MetaChip label={status} tone="warn" />}
        {supName && (
          <span className="text-[10px] text-[var(--color-faint)]">↑ replaces {supName}</span>
        )}
      </div>
      <span
        className="shrink-0 truncate font-mono text-[10px] text-[var(--color-faint)]"
        title={comp.path}
      >
        {comp.path === "." ? "·" : comp.path}
      </span>
    </div>
  );
}

/** Renders a workspace's structure (fullstack / split / environments). */
function WorkspaceStructure({ ws }: { ws: ProjectWorkspace }) {
  const st = ws.structure;
  if (st.kind === "fullstack") return <ComponentRow ws={ws} comp={st.component} />;
  if (st.kind === "split")
    return (
      <>
        {st.components.map((c) => (
          <ComponentRow key={c.id} ws={ws} comp={c} />
        ))}
      </>
    );
  if (st.kind === "environments")
    return (
      <>
        {st.environments.map((env) => (
          <div key={env.id} className="pt-1 first:pt-0">
            <div className="flex items-center gap-1.5 pb-0.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-muted)]">
                {env.name}
              </span>
              {env.id === st.defaultEnv && <MetaChip label="default" tone="accent" />}
            </div>
            <div className="border-l border-[color-mix(in_srgb,var(--color-border)_70%,transparent)] pl-2.5">
              {env.components.map((c) => (
                <ComponentRow key={c.id} ws={ws} comp={c} />
              ))}
            </div>
          </div>
        ))}
      </>
    );
  return (
    <p className="py-1 text-[11px] text-[var(--color-faint)]">
      no recognized stack — may not be a project, or configure it manually.
    </p>
  );
}

/** A workspace card — name (rename) + shape badge + hide/delete + structure. */
function WorkspaceCard({
  ws,
  name,
  hidden,
  onRescan,
  onLaunch,
}: {
  ws: ProjectWorkspace;
  name: string;
  hidden: boolean;
  onRescan: () => void;
  /** when set, the card shows an "open" button → opens the launch picker. */
  onLaunch?: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const [ctxOpen, setCtxOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [ctxStatus, setCtxStatus] = useState<string | null>(null);
  const custom = ws.source === "custom";
  const commit = () => {
    setWorkspaceName(ws.root, draft.trim());
    setRenaming(false);
  };
  const openCtx = () => {
    setCtxOpen((v) => !v);
    if (preview === null) {
      previewWorkspaceContext(ws.root)
        .then(setPreview)
        .catch(() => setPreview("(couldn't render preview)"));
    }
  };
  const writeCtx = () => {
    setCtxStatus("writing…");
    generateWorkspaceContext(ws.root)
      .then((files) => {
        setCtxStatus(`✓ wrote ${files.join(" · ")}`);
        onRescan();
      })
      .catch((e) => setCtxStatus(`failed: ${e}`));
  };
  return (
    <div className="surface-card mb-2.5 px-3.5 py-2.5" style={{ opacity: hidden ? 0.5 : 1 }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {renaming ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                if (e.key === "Escape") {
                  setDraft(name);
                  setRenaming(false);
                }
              }}
              className={`w-[170px] ${FIELD}`}
            />
          ) : (
            <span className="truncate text-[13px] font-medium text-[var(--color-text)]">{name}</span>
          )}
          <MetaChip label={projectShapeLabel(ws)} tone="muted" />
          {custom && <MetaChip label="custom" tone="accent" />}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onLaunch && (
            <button
              onClick={onLaunch}
              title="open in chat or terminal"
              className="press mr-0.5 flex items-center gap-1 rounded-md border border-[color-mix(in_srgb,var(--color-accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_15%,transparent)] px-2 py-1 text-[11px] font-medium text-[var(--color-accent)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-accent)_25%,transparent)]"
            >
              <SquareTerminal size={12} /> open
            </button>
          )}
          <button
            onClick={openCtx}
            title="agent context (CLAUDE.md / AGENTS.md)"
            className={ICON_BTN}
            style={ctxOpen ? { color: "var(--color-accent)" } : undefined}
          >
            <FileText size={13} />
          </button>
          <button
            onClick={() => {
              setDraft(name);
              setRenaming((v) => !v);
            }}
            title="rename"
            className={ICON_BTN}
          >
            <Pencil size={13} />
          </button>
          {custom ? (
            <button
              onClick={() => {
                removeCustomWorkspace(ws.root);
                onRescan();
              }}
              title="remove"
              className="press grid h-7 w-7 place-items-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-danger)]"
            >
              <Trash2 size={13} />
            </button>
          ) : (
            <>
              <button
                onClick={() => setWorkspaceHidden(ws.root, !hidden)}
                title={hidden ? "show" : "hide from home"}
                className={ICON_BTN}
              >
                {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <button
                onClick={() => {
                  setWorkspaceRemoved(ws.root, true);
                  onRescan();
                }}
                title="remove (e.g. a mis-scanned folder) — restorable below"
                className="press grid h-7 w-7 place-items-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-danger)]"
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
      </div>
      <div className="mt-0.5 truncate font-mono text-[10px] text-[var(--color-faint)]">{ws.root}</div>
      <div className="mt-1.5 border-t border-[color-mix(in_srgb,var(--color-border)_55%,transparent)] pt-1">
        <WorkspaceStructure ws={ws} />
      </div>
      {ctxOpen && (
        <div className="mt-2 border-t border-[color-mix(in_srgb,var(--color-border)_55%,transparent)] pt-2">
          <div className="flex items-center justify-between gap-2 pb-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-muted)]">
              agent context
            </span>
            <button
              onClick={writeCtx}
              className="press flex items-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--color-accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_15%,transparent)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-accent)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-accent)_25%,transparent)]"
            >
              <FileText size={12} /> write CLAUDE.md · AGENTS.md
            </button>
          </div>
          <p className="pb-1.5 text-[10px] leading-snug text-[var(--color-faint)]">
            inserts a managed block into CLAUDE.md + AGENTS.md (your own notes are untouched) and
            writes osai.workspace.json (git-ignored). Agents launched here read it natively.
          </p>
          {ctxStatus && (
            <p
              className="pb-1.5 text-[10px]"
              style={{ color: ctxStatus.startsWith("failed") ? "var(--color-danger)" : "var(--color-success)" }}
            >
              {ctxStatus}
            </p>
          )}
          <pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--osai-surface-edge)] bg-[color-mix(in_srgb,var(--color-panel-2)_45%,transparent)] p-2 font-mono text-[10px] leading-snug text-[var(--color-text-2)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {preview ?? "loading…"}
          </pre>
        </div>
      )}
    </div>
  );
}

export function ProjectsSection({
  onLaunch,
}: {
  /** when set, each workspace card shows an "open" button calling this with the ws. */
  onLaunch?: (ws: ProjectWorkspace) => void;
} = {}) {
  const [scannedWs, setScannedWs] = useState<ProjectWorkspace[]>([]);
  const [store, setStore] = useState(loadProjectWorkspacesStore);
  const [roots, setRoots] = useState<string[]>(getScanRoots);
  const [suggested, setSuggested] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [newRoot, setNewRoot] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [nName, setNName] = useState("");
  const [nPath, setNPath] = useState("");
  const [regenOnChange, setRegenOnChange] = useState(() => loadSettings().regenerateContextOnChange);

  const rescan = () => {
    setLoading(true);
    scanWorkspaces(getScanRoots())
      .then((ws) => {
        setScannedWs(ws);
        // keep already-generated context fresh, if the owner opted in.
        if (loadSettings().regenerateContextOnChange) {
          ws.filter((w) => w.manifestPath).forEach((w) => {
            generateWorkspaceContext(w.root).catch(() => {});
          });
        }
      })
      .catch((e) => reportDiag("settings.projects", e, { action: "scan" }))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    rescan();
    suggestedScanRoots().then(setSuggested).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(
    () =>
      subscribeProjectWorkspaces(() => {
        setStore(loadProjectWorkspacesStore());
        setRoots(getScanRoots());
      }),
    [],
  );

  const addRoot = (r: string) => {
    const t = r.trim();
    if (!t) return;
    addScanRoot(t);
    setNewRoot("");
    rescan();
  };
  const submitAdd = () => {
    const path = nPath.trim();
    if (!path) return;
    detectWorkspace(path)
      .then((ws) => {
        addCustomWorkspace(nName.trim() ? { ...ws, name: nName.trim() } : ws);
        rescan();
      })
      .catch((e) => reportDiag("settings.projects", e, { action: "add" }));
    setNName("");
    setNPath("");
    setAddOpen(false);
  };

  const customRoots = new Set(store.custom.map((c) => normRoot(c.root)));
  const nameOf = (w: ProjectWorkspace) => store.prefs[normRoot(w.root)]?.name?.trim() || w.name;
  // REMOVED workspaces drop out of the list entirely (vs hidden, which stays
  // greyed); a "restore removed" affordance below brings them all back.
  const removedCount = Object.values(store.prefs).filter((p) => p.removed).length;
  const list = [...scannedWs.filter((w) => !customRoots.has(normRoot(w.root))), ...store.custom]
    .filter((w) => !store.prefs[normRoot(w.root)]?.removed)
    .map((w) => ({ ws: w, name: nameOf(w), hidden: !!store.prefs[normRoot(w.root)]?.hidden }))
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  const suggestable = suggested.filter((s) => !roots.some((r) => normRoot(r) === normRoot(s)));
  const samplePath = isApple ? "/Users/you/Repo" : "C:\\FHE-Work";

  return (
    <div className="-mt-1">
      <Card label="scan roots">
        <div className="py-1.5">
          <p className="pb-2 text-[11px] leading-snug text-[var(--color-muted)]">
            folders OSAI scans for projects — each sub-folder becomes a workspace, its shape
            (fullstack · front/back · environments) detected automatically.
          </p>
          {roots.length === 0 && (
            <p className="pb-2 text-[11px] text-[var(--color-faint)]">
              none yet — using sensible defaults. add one (e.g. {samplePath}).
            </p>
          )}
          {roots.map((r) => (
            <div key={r} className="flex items-center justify-between gap-2 py-1">
              <span className="truncate font-mono text-[11px] text-[var(--color-text-2)]">{r}</span>
              <button
                onClick={() => {
                  removeScanRoot(r);
                  rescan();
                }}
                title="remove"
                className={ICON_BTN}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <div className="mt-1.5 flex items-center gap-2">
            <input
              value={newRoot}
              onChange={(e) => setNewRoot(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addRoot(newRoot);
              }}
              placeholder={samplePath}
              spellCheck={false}
              className={`flex-1 ${FIELD_MONO}`}
            />
            <button onClick={() => addRoot(newRoot)} disabled={!newRoot.trim()} className={`${GHOST_BTN} disabled:opacity-40`}>
              <Plus size={13} /> add
            </button>
            <button onClick={rescan} title="rescan" className={GHOST_BTN}>
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> rescan
            </button>
          </div>
          {suggestable.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-[var(--color-faint)]">suggested:</span>
              {suggestable.map((s) => (
                <button
                  key={s}
                  onClick={() => addRoot(s)}
                  className="press rounded-md border border-[var(--osai-surface-edge)] bg-[color-mix(in_srgb,var(--color-panel-2)_45%,transparent)] px-2 py-0.5 font-mono text-[10px] text-[var(--color-text-2)] transition-colors hover:border-[var(--osai-surface-edge-strong)] hover:text-[var(--color-text)]"
                >
                  + {s}
                </button>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card label="agent context">
        <Row
          label="keep context fresh on rescan"
          sub="when on, workspaces that already have an osai.workspace.json get their CLAUDE.md / AGENTS.md regenerated on rescan. off → generate by hand via the context button on each workspace."
        >
          <Toggle
            checked={regenOnChange}
            onChange={(v) => {
              setRegenOnChange(v);
              saveSettings({ regenerateContextOnChange: v });
            }}
          />
        </Row>
      </Card>

      <div className="mb-1.5 mt-1 flex items-center justify-between px-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-faint)]">
          workspaces{loading ? " · scanning…" : ` · ${list.length}`}
        </span>
        <button onClick={() => setAddOpen((v) => !v)} className={`${GHOST_BTN} shrink-0`}>
          <Plus size={13} /> add
        </button>
      </div>

      {addOpen && (
        <div className="surface-card mb-2.5 flex flex-col gap-2 p-3">
          <input
            className={`w-full ${FIELD}`}
            placeholder="name (optional — defaults to the folder name)"
            value={nName}
            onChange={(e) => setNName(e.target.value)}
          />
          <input
            className={`w-full ${FIELD_MONO}`}
            placeholder={isApple ? "absolute path (e.g. /Users/you/Repo/app)" : "absolute path (e.g. C:\\FHE-Work\\App)"}
            value={nPath}
            onChange={(e) => setNPath(e.target.value)}
          />
          <p className="text-[10px] text-[var(--color-faint)]">its shape is auto-detected on add.</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setAddOpen(false)} className="rounded-md px-2.5 py-1 text-[12px] text-[var(--color-muted)] hover:text-[var(--color-text)]">
              cancel
            </button>
            <button
              onClick={submitAdd}
              disabled={!nPath.trim()}
              className="press rounded-lg bg-[var(--color-accent)] px-3 py-1 text-[12px] font-medium text-[var(--color-accent-fg)] disabled:opacity-40"
            >
              add project
            </button>
          </div>
        </div>
      )}

      {!loading && list.length === 0 && (
        <p className="py-6 text-center text-[12px] text-[var(--color-faint)]">
          no projects found — add a scan root above.
        </p>
      )}
      {list.map(({ ws, name, hidden }) => (
        <WorkspaceCard
          key={ws.root}
          ws={ws}
          name={name}
          hidden={hidden}
          onRescan={rescan}
          onLaunch={onLaunch ? () => onLaunch(ws) : undefined}
        />
      ))}
      {removedCount > 0 && (
        <div className="mt-1 flex items-center justify-between gap-2 px-1 py-1 text-[11px] text-[var(--color-faint)]">
          <span>
            {removedCount} removed workspace{removedCount === 1 ? "" : "s"} hidden from the list
          </span>
          <button
            onClick={() => {
              restoreAllRemoved();
              rescan();
            }}
            className={GHOST_BTN}
          >
            <RotateCcw size={12} /> restore removed
          </button>
        </div>
      )}
    </div>
  );
}

/* ── plugins + channels summaries (S1, living-cockpit) ──────────────────
   These sections used to embed their FULL panes inside the modal — foreign
   chrome, own scrollbars, mismatched layout. Native sections now: a live
   summary in the house Card/Row system, with the rich pane one click away. */

function PluginsSummarySection({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<Plugins | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    listPlugins()
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);
  const groups = data ? new Set(data.skills.map((sk) => sk.group)).size : 0;
  const openPane = () => {
    spawnPane("plugins");
    onClose();
  };
  return (
    <>
      <Card label="skills">
        <Row
          label={
            data
              ? `${data.skills.length} skills · ${groups} group${groups === 1 ? "" : "s"}`
              : err
                ? "couldn't read the catalog"
                : "reading the catalog…"
          }
          sub={err ?? "the canonical osai skill catalog — browse + search it in the plugins pane"}
          subClassName={err ? "text-[var(--color-danger)]" : undefined}
        >
          <button onClick={openPane} className={GHOST_BTN}>
            <Blocks size={13} /> open plugins pane
          </button>
        </Row>
      </Card>
      <Card label="mcp servers">
        {data && data.mcps.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 py-2">
            {data.mcps.map((m) => (
              <span
                key={m}
                className="rounded-md border border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] px-2.5 py-1 font-mono text-[11px] text-[var(--color-text)]"
              >
                {m}
              </span>
            ))}
          </div>
        ) : (
          <p className="py-2 text-[11px] leading-snug text-[var(--color-faint)]">
            no mcp servers connected — agents gain tools when a server is configured for the CLI.
          </p>
        )}
      </Card>
    </>
  );
}

const CHANNEL_DOT: Record<ChannelStatus, string> = {
  connected: "var(--color-success)",
  disconnected: "var(--color-warning)",
  soon: "var(--color-faint)",
};

function ChannelsSummarySection({ onClose }: { onClose: () => void }) {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    listBridges()
      .then((c) => setChannels(c.bridges))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);
  const openPane = () => {
    spawnPane("bridges");
    onClose();
  };
  const live = channels?.filter((c) => c.status !== "soon") ?? [];
  const soon = channels?.filter((c) => c.status === "soon") ?? [];
  return (
    <>
      <Card label="channels">
        <Row
          label={
            channels
              ? `${live.length} connector${live.length === 1 ? "" : "s"} · ${
                  live.filter((c) => c.status === "connected").length
                } live`
              : err
                ? "couldn't read channel status"
                : "checking channels…"
          }
          sub={err ?? "pairing, activity feeds, and per-channel health live in the channels pane"}
          subClassName={err ? "text-[var(--color-danger)]" : undefined}
        >
          <button onClick={openPane} className={GHOST_BTN}>
            <Radio size={13} /> open channels pane
          </button>
        </Row>
        {live.map((c) => (
          <Row
            key={c.id}
            label={
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-full"
                  style={{ background: CHANNEL_DOT[c.status] }}
                />
                {c.name}
              </span>
            }
            sub={
              c.status === "connected"
                ? `connected${c.uptime ? ` · up ${c.uptime}` : ""}${
                    c.lastActivityAgo ? ` · active ${c.lastActivityAgo} ago` : ""
                  }`
                : "known connector — nothing alive right now"
            }
          >
            <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-faint)]">
              {c.kind}
            </span>
          </Row>
        ))}
      </Card>
      {soon.length > 0 && (
        <Card label="on the way">
          <div className="flex flex-wrap gap-1.5 py-2">
            {soon.map((c) => (
              <span
                key={c.id}
                className="rounded-md border border-[var(--color-border)] px-2.5 py-1 font-mono text-[11px] text-[var(--color-faint)]"
              >
                {c.name}
              </span>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

/* ── main component ─────────────────────────────────────────────────── */

/** Control-plane state mirrored from Rust (control.rs ControlStatus). */
type ControlStatus = { enabled: boolean; running: boolean; port: number };

/** Agent control (Tier 2): toggle the localhost control plane that lets an
 *  external oracle drive OSAI via the osai-control MCP. Backed by RUST state (the
 *  server owns the on/off + token + persisted choice), not localStorage — so this
 *  reads/writes it over `invoke`. Hidden on the web shell and on builds that
 *  predate the commands (the status invoke rejects → card stays hidden). */
function AgentControlCard() {
  const [status, setStatus] = useState<ControlStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let alive = true;
    // a rejection here = the command isn't in this binary yet → leave the card
    // hidden (status stays null) rather than showing a dead toggle.
    invoke<ControlStatus>("osai_control_status")
      .then((st) => alive && setStatus(st))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!isTauriRuntime() || status === null) return null;
  const toggle = (on: boolean) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    invoke<ControlStatus>("osai_set_control", { on })
      .then(setStatus)
      .catch(() => setErr("couldn't update — is this a current build?"))
      .finally(() => setBusy(false));
  };
  return (
    <Card label="agent control">
      <Row
        label="allow agent control"
        sub="let an external agent (the osai-control MCP) drive this cockpit — open panes, run terminals, read state — over a localhost-only, token-gated server. Off by default; enabling starts it immediately, no restart."
      >
        <Toggle checked={status.enabled} onChange={toggle} />
      </Row>
      {status.enabled && (
        <Row
          label="endpoint"
          sub="discovery files: ~/.osai/control-token + ~/.osai/control-port — point the osai-control MCP at them, then ask your oracle to drive the app"
        >
          <span className="font-mono text-[11px] text-[var(--color-muted)] tabular-nums">
            {status.running && status.port ? `127.0.0.1:${status.port}` : "starting…"}
          </span>
        </Row>
      )}
      {err && (
        <div className="px-0.5 pt-1 text-[11px] text-[var(--color-danger)]">{err}</div>
      )}
    </Card>
  );
}

/** BYO-key API keys (Tier 4): paste a provider key → stored in the OS keychain
 *  (never plaintext), and that provider's models then appear in the composer's
 *  picker. Keys are write-only from here — never read back into the UI. Hidden on
 *  the web shell / builds without the commands. */
/** The "local" provider's base URL (LM Studio / llama.cpp / vLLM — any
 *  OpenAI-compatible server). Saving pushes the endpoint to the Rust runtime
 *  and re-sweeps the model catalog so the server's models appear immediately. */
function LocalEndpointRow() {
  const [draft, setDraft] = useState(() => loadSettings().localApiEndpoint);
  const [busy, setBusy] = useState(false);
  // sweep readout — the connection stops being a black box (owner ask):
  // "12 models found" / "no response — is the server running?".
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const commit = () => {
    const endpoint = draft.trim().replace(/\/+$/, "") || DEFAULT_SETTINGS.localApiEndpoint;
    setDraft(endpoint);
    setBusy(true);
    setNote(null);
    saveSettings({ localApiEndpoint: endpoint });
    void invoke("set_local_api_endpoint", { endpoint })
      .catch(() => {})
      .then(() => refreshModelCatalog(null, endpoint))
      .then((cat) => {
        applyDynamicCatalog(cat?.providers);
        const n = cat?.providers?.local?.length ?? 0;
        setNote(
          n > 0
            ? { ok: true, text: `${n} model${n === 1 ? "" : "s"} found` }
            : { ok: false, text: "no response — is the server running?" },
        );
      })
      .catch(() => setNote({ ok: false, text: "sweep failed — restart the app?" }))
      .finally(() => setBusy(false));
  };
  return (
    <Row
      label="local endpoint"
      sub={
        note
          ? note.text
          : "any OpenAI-compatible server — LM Studio :1234 · llama.cpp :8080 · vLLM. models appear in the picker when the server answers /models"
      }
      subClassName={note ? (note.ok ? "text-[var(--color-success)]" : "text-[var(--color-danger)]") : undefined}
    >
      <div className="flex items-center gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
          placeholder="http://localhost:1234/v1"
          spellCheck={false}
          className={`w-[210px] ${FIELD_MONO}`}
        />
        <button type="button" disabled={busy} onClick={commit} className={GHOST_BTN}>
          save
        </button>
      </div>
    </Row>
  );
}

function ApiKeysCard() {
  const [configured, setConfigured] = useState<Set<string> | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = () =>
    listConfiguredProviders()
      .then(setConfigured)
      .catch(() => setConfigured(new Set()));
  useEffect(() => {
    if (!isTauriRuntime()) return;
    void refresh();
  }, []);
  if (!isTauriRuntime() || configured === null) return null;
  const keyed = API_PROVIDERS.filter((p) => !p.keyless);
  const save = (id: ApiProviderId) => {
    const key = (drafts[id] ?? "").trim();
    if (!key) return;
    setBusy(id);
    setApiKey(id, key)
      .then(() => {
        setDrafts((d) => ({ ...d, [id]: "" }));
        return refresh();
      })
      .catch(() => {})
      .finally(() => setBusy(null));
  };
  const clear = (id: ApiProviderId) => {
    setBusy(id);
    deleteApiKey(id)
      .then(refresh)
      .catch(() => {})
      .finally(() => setBusy(null));
  };
  return (
    <Card label="api keys · bring your own">
      <div className="px-0.5 pb-1.5 text-[11px] leading-snug text-[var(--color-muted)]">
        Chat on any provider's API with your own key — stored in your OS keychain, never plaintext.
        A provider's models appear in the composer's model picker once its key is set. Ollama is
        local and needs no key.
      </div>
      <LocalEndpointRow />
      {keyed.map((p) => {
        const isSet = configured.has(p.id);
        return (
          <Row
            key={p.id}
            label={p.label}
            sub={isSet ? "key stored in your OS keychain" : p.keyUrl ? `get a key → ${p.keyUrl}` : `paste a ${p.label} key`}
          >
            {isSet ? (
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-[var(--color-accent)]">configured</span>
                <button
                  type="button"
                  disabled={busy === p.id}
                  onClick={() => clear(p.id)}
                  className={GHOST_BTN}
                >
                  clear
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <input
                  type="password"
                  value={drafts[p.id] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") save(p.id);
                  }}
                  placeholder="paste key"
                  spellCheck={false}
                  className={`w-[170px] ${FIELD_MONO}`}
                />
                <button
                  type="button"
                  disabled={busy === p.id || !(drafts[p.id] ?? "").trim()}
                  onClick={() => save(p.id)}
                  className={GHOST_BTN}
                >
                  save
                </button>
              </div>
            )}
          </Row>
        );
      })}
    </Card>
  );
}

export function Settings({
  open,
  onClose,
  initialSection,
  mirrorUrl,
  mirrorStatus,
  onCopyMirrorUrl,
}: {
  open: boolean;
  onClose: () => void;
  /** When set, the overlay jumps to this section on open (e.g. a notification
   *  deep-linking to "diagnostics"). Consumed once per open. */
  initialSection?: string | null;
  /** Desktop-mirror pairing url (only present when a mirror is available). */
  mirrorUrl?: string | null;
  /** Pairing status text (e.g. "connected", "waiting"). */
  mirrorStatus?: string;
  /** Copy the mirror url to the clipboard (App owns the clipboard + flash). */
  onCopyMirrorUrl?: () => void;
}) {
  const [section, setSection] = useState<SectionId>("general");
  const [query, setQuery] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [s, setS] = useState<AppSettings>(loadSettings);
  const [sidebar, setSidebar] = useState<SidebarState>(loadSidebar);
  useEffect(() => subscribeSidebar(setSidebar), []);
  const [theme, setLocalTheme] = useState<Theme>(getTheme);
  const [accent, setLocalAccent] = useState<Accent>(getAccent);
  const [accent2, setLocalAccent2] = useState<Accent2>(getAccent2);
  const [density, setLocalDensity] = useState<Density>(getDensity);

  // re-sync from store each time the window opens; honor a deep-linked section.
  useEffect(() => {
    if (open) {
      setQuery("");
      setConfirmReset(false);
      setS(loadSettings());
      setLocalTheme(getTheme());
      setLocalAccent(getAccent());
      setLocalAccent2(getAccent2());
      setLocalDensity(getDensity());
      if (initialSection && NAV.some((n) => n.id === initialSection)) {
        setSection(initialSection as SectionId);
      }
    }
  }, [open, initialSection]);

  // reflect theme/accent changes from anywhere (e.g. the header switcher).
  useEffect(() => {
    const offT = subscribeTheme(setLocalTheme);
    const offA = subscribeAccent(setLocalAccent);
    const offA2 = subscribeAccent2(setLocalAccent2);
    return () => {
      offT();
      offA();
      offA2();
    };
  }, []);

  // apply persisted appearance attrs once so the cockpit reflects stored
  // prefs without requiring a toggle. (theme + accent are applied by
  // initTheme() in App.tsx — these are the display-only follow-up attrs.)
  useEffect(() => {
    const init = loadSettings();
    applyFontScale(init.terminalFontSize);
    applyReduceMotion(init.reduceMotion);
    applyFlashLevel(init.flashLevel);
    applyDensity(getDensity());
  }, []);

  // esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // land keyboard focus inside the dialog on open so the Tab trap + Escape
  // work without a click first (screen readers announce the dialog label).
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) requestAnimationFrame(() => dialogRef.current?.focus());
  }, [open]);

  // sliding nav indicator: measure the active row's offset within the rows
  // container so the highlight glides between sections (W5-4, no layoutId).
  const navRowsRef = useRef<HTMLDivElement>(null);
  const [navRect, setNavRect] = useState({ top: 0, height: 0 });
  useLayoutEffect(() => {
    const c = navRowsRef.current;
    if (!c) return;
    const el = c.querySelector<HTMLElement>(`[data-nav-id="${section}"]`);
    // when a search filters the active row out of view, collapse the indicator.
    setNavRect(el ? { top: el.offsetTop, height: el.offsetHeight } : { top: 0, height: 0 });
  }, [section, open, query]);

  // rail search — match a section by its label or its keyword tags.
  const q = query.trim().toLowerCase();
  const matchesQuery = (n: NavItem) =>
    !q || n.label.includes(q) || (n.keywords ?? "").includes(q);

  /** Persist + update local state in one move. */
  const patch = (p: Partial<AppSettings>) => setS(saveSettings(p));

  /** Reset behavioral / appearance / notification prefs to defaults — but keep
   *  identity, engine choice, and onboarding state so a reset never re-triggers
   *  first-run or forgets who you are. */
  const doResetAll = () => {
    const cur = loadSettings();
    const next = saveSettings({
      ...DEFAULT_SETTINGS,
      userName: cur.userName,
      onboardingComplete: cur.onboardingComplete,
      onboardedAt: cur.onboardedAt,
      chatProvider: cur.chatProvider,
      chatModel: cur.chatModel,
      chatEffort: cur.chatEffort,
      chatAccess: cur.chatAccess,
      chatContextBudget: cur.chatContextBudget,
      defaultAi: cur.defaultAi,
    });
    setS(next);
    applyFontScale(next.terminalFontSize);
    applyReduceMotion(next.reduceMotion);
    applyFlashLevel(next.flashLevel);
    applyDensity("comfortable");
    setLocalDensity("comfortable");
    setConfirmReset(false);
  };

  // Exit motion — AnimatePresence + fx/motionTokens (the component stays
  // mounted by App after first open so the exit can play; all content below
  // only renders while `open`).
  return (
    <AnimatePresence>
      {open && (
    <m.div
      {...overlayFade()}
      className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-6 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <m.div
        {...modalPop()}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="settings"
        tabIndex={-1}
        className="glass-strong flex h-[600px] w-[900px] max-w-full overflow-hidden rounded-[18px] shadow-[var(--osai-shadow-pop)] focus:outline-none"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => trapTab(e, e.currentTarget)}
      >
        {/* nav rail */}
        <nav className="relative flex w-[236px] shrink-0 flex-col border-r border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-bg)_55%,transparent)] backdrop-blur-md">
          {/* the signature gradient edge running down the rail's right border */}
          <span className="pointer-events-none absolute inset-y-0 right-0 w-px bg-[linear-gradient(180deg,transparent,var(--color-accent)_40%,var(--osai-accent-2)_75%,transparent)] opacity-50" />

          {/* brand — gradient diamond + wordmark */}
          <div className="flex items-center gap-2.5 px-4 pb-3.5 pt-4">
            <span
              className="h-[22px] w-[22px] rounded-[7px] bg-[linear-gradient(135deg,var(--color-accent),var(--osai-accent-2))]"
              style={{ boxShadow: "0 0 14px -2px color-mix(in srgb, var(--color-accent) 45%, transparent)" }}
            />
            <span className="text-[15px] font-semibold lowercase tracking-tight text-[var(--color-text)]">
              settings
            </span>
          </div>

          {/* search — matches a section by label or by what's inside it */}
          <div className="relative mx-3 mb-3">
            <Search
              size={12}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-faint)]"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="search settings…"
              spellCheck={false}
              className="glow-focus w-full rounded-[9px] border border-[var(--osai-surface-edge)] bg-[color-mix(in_srgb,white_3%,transparent)] py-1.5 pl-7 pr-6 text-[12px] text-[var(--color-text)] outline-none placeholder:text-[var(--color-faint)]"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                aria-label="clear search"
                className="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-[var(--color-faint)] transition-colors hover:text-[var(--color-text)]"
              >
                <X size={11} />
              </button>
            )}
          </div>

          {/* rows wrapper is `relative` so the gliding indicator can sit behind
              the buttons and animate to the active row's measured offset */}
          <div
            ref={navRowsRef}
            className="relative flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {!q && navRect.height > 0 && (
              <SlidingIndicator
                top={navRect.top}
                height={navRect.height}
                className="rounded-[9px] bg-[linear-gradient(90deg,color-mix(in_srgb,var(--color-accent)_18%,transparent),color-mix(in_srgb,var(--color-accent)_4%,transparent))] shadow-[inset_2px_0_0_var(--color-accent),0_0_22px_-10px_var(--osai-glow-accent)] ring-1 ring-inset ring-[color-mix(in_srgb,var(--color-accent)_34%,transparent)]"
              />
            )}
            {NAV_GROUPS.map((group, gi) => {
              const items = NAV.filter((n) => n.group === group.id && matchesQuery(n));
              if (!items.length) return null;
              return (
                <div key={group.id} className="flex flex-col gap-0.5">
                  {!q && (
                    <div
                      className={`px-2 pb-1 font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--color-faint)] ${gi === 0 ? "pt-1" : "pt-3"}`}
                    >
                      {group.title}
                    </div>
                  )}
                  {items.map(({ id, label, icon: Icon }) => {
                    const active = id === section;
                    return (
                      <button
                        key={id}
                        data-nav-id={id}
                        onClick={() => {
                          setSection(id);
                          setQuery("");
                        }}
                        className="relative z-10 flex items-center gap-2.5 rounded-[9px] border border-transparent px-2.5 py-2 text-left text-[13px] transition-colors hover:border-[var(--color-border)] hover:bg-[color-mix(in_srgb,white_3%,transparent)]"
                        style={{
                          color: active ? "var(--color-text)" : "var(--color-text-2)",
                          background:
                            q && active
                              ? "color-mix(in srgb, var(--color-accent) 12%, transparent)"
                              : undefined,
                        }}
                      >
                        <Icon
                          size={15}
                          className={active ? "text-[var(--color-accent)]" : "text-[var(--color-muted)]"}
                        />
                        {label}
                      </button>
                    );
                  })}
                </div>
              );
            })}
            {q && !NAV.some(matchesQuery) && (
              <div className="px-2 py-3 text-[11px] leading-snug text-[var(--color-faint)]">
                nothing matches “{query}”.
              </div>
            )}
          </div>

          {/* footer — build line, mono + faint, capped by a hairline */}
          <div className="border-t border-[var(--color-border)] px-4 py-3 font-mono text-[10px] tracking-wide text-[var(--color-faint)]">
            OSAI · v2.2.1 · Jul.Nazz
          </div>
        </nav>

        {/* content */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <button
            onClick={onClose}
            className="absolute right-3 top-3 z-10 grid h-7 w-7 place-items-center rounded-lg text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
            aria-label="close"
          >
            <X size={15} />
          </button>

          {/* S1 (living-cockpit): channels + plugins used to render their FULL
              panes here — different chrome, mismatched with every other
              section. They're native Card/Row sections now (live summary, the
              pane one click away via spawnPane). */}
          <div className="flex-1 overflow-y-auto px-6 py-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <header className="mb-5">
              <h2 className="text-[18px] font-semibold lowercase tracking-tight text-[var(--color-text)]">
                {section}
              </h2>
              <p className="mt-1 text-[12.5px] leading-snug text-[var(--color-muted)]">
                {SECTION_BLURB[section]}
              </p>
            </header>
            <div>
              {section === "general" && (
                <>
                  <Card label="you">
                    <Row
                      label="your name"
                      sub="shown in the homescreen greeting + account row"
                    >
                      <input
                        value={s.userName}
                        onChange={(e) => patch({ userName: e.target.value })}
                        placeholder="your name"
                        spellCheck={false}
                        className={`w-[160px] ${FIELD}`}
                      />
                    </Row>
                    <Row label="setup" sub="replay the first-run onboarding">
                      <button
                        type="button"
                        onClick={() => window.dispatchEvent(new Event("osai:replay-onboarding"))}
                        className={GHOST_BTN}
                      >
                        replay setup
                      </button>
                    </Row>
                  </Card>

                  <Card label="startup & window">
                    <Row
                      label="reopen last layout"
                      sub="restore your panes + sizes on startup"
                    >
                      <Toggle
                        checked={s.reopenLastLayout}
                        onChange={(v) => patch({ reopenLastLayout: v })}
                      />
                    </Row>
                    <Row
                      label="minimize to tray"
                      sub="closing the window keeps OSAI running in the system tray (a tray icon gives show / quit) instead of quitting"
                    >
                      <Toggle
                        checked={s.minimizeToTray}
                        onChange={(v) => patch({ minimizeToTray: v })}
                      />
                    </Row>
                  </Card>

                  <Card label="panes & oracles">
                    <Row label="default new-pane type">
                      <Segmented<PaneType>
                        value={s.defaultPaneType}
                        onChange={(v) => patch({ defaultPaneType: v })}
                        options={[
                          { value: "terminal", label: "terminal" },
                          { value: "files", label: "files" },
                          { value: "browser", label: "browser" },
                        ]}
                      />
                    </Row>
                    <Row
                      label="confirm before closing oracle pane"
                      sub="ask before killing a live oracle session"
                    >
                      <Toggle
                        checked={s.confirmCloseOraclePane}
                        onChange={(v) => patch({ confirmCloseOraclePane: v })}
                      />
                    </Row>
                  </Card>

                  <Card label="integrations">
                    <Row
                      label="terminal socket"
                      sub="private tmux/psmux namespace for OSAI's persistent terminals — change it to isolate from other tmux servers (takes effect on the next terminal you open)"
                    >
                      <input
                        value={s.terminalSocket}
                        onChange={(e) => patch({ terminalSocket: e.target.value })}
                        placeholder="osai"
                        spellCheck={false}
                        className={`w-[230px] ${FIELD_MONO}`}
                      />
                    </Row>
                    <Row
                      label="dictation transcription"
                      sub="auto uses your OpenAI API key when one is configured (see API keys below), else the local whisper server — claude/codex have no speech-to-text API"
                    >
                      <Segmented<TranscribeVia>
                        value={s.transcribeVia}
                        onChange={(v) => patch({ transcribeVia: v })}
                        options={[
                          { value: "auto", label: "auto" },
                          { value: "openai", label: "openai" },
                          { value: "local", label: "local whisper" },
                        ]}
                      />
                    </Row>
                    <Row
                      label="dictation server"
                      sub="whisper.cpp endpoint for the local backend — probed before each recording"
                    >
                      <input
                        value={s.whisperUrl}
                        onChange={(e) => patch({ whisperUrl: e.target.value })}
                        placeholder="http://localhost:9000/inference"
                        spellCheck={false}
                        className={`w-[230px] ${FIELD_MONO}`}
                      />
                    </Row>
                    <Row
                      label="show codex usage"
                      sub="the codex (chatgpt-sub) usage block reads ~/.codex/auth.json — turn off to hide it (e.g. if that token isn't yours); when off it isn't fetched at all"
                    >
                      <Toggle
                        checked={s.showCodexUsage}
                        onChange={(v) => patch({ showCodexUsage: v })}
                      />
                    </Row>
                    {mirrorUrl && (
                      <Row
                        label="desktop mirror link"
                        sub={`copy the pairing link to view this cockpit elsewhere · ${mirrorStatus ?? "off"}`}
                      >
                        <button
                          type="button"
                          onClick={() => onCopyMirrorUrl?.()}
                          className={GHOST_BTN}
                        >
                          <MonitorUp size={13} />
                          copy link
                        </button>
                      </Row>
                    )}
                  </Card>

                  <AgentControlCard />
                  <ApiKeysCard />
                </>
              )}

              {section === "appearance" && (
                <>
                  <Card label="theme">
                    <div className="py-3">
                      <div className="mb-2 text-[11px] leading-snug text-[var(--color-muted)]">
                        use light, dark, or match your system
                      </div>
                      <ThemePicker
                        value={theme}
                        onChange={(t) => {
                          setTheme(t);
                          setLocalTheme(t);
                        }}
                      />
                    </div>
                    <Row
                      label="accent"
                      sub="pick a preset or any custom color — re-tints the whole cockpit instantly"
                    >
                      <AccentSwatches
                        value={accent}
                        onChange={(a) => {
                          setAccent(a);
                          setLocalAccent(a);
                        }}
                      />
                    </Row>
                    <Row
                      label="glow"
                      sub="the second neon — composer lip, send orb, the pet's core. pick one that pairs with your accent"
                    >
                      <AccentSwatches
                        value={accent2}
                        onChange={(a) => {
                          setAccent2(a);
                          setLocalAccent2(a);
                        }}
                        presets={ACCENT2_PRESETS}
                        order={ACCENT2_ORDER}
                      />
                    </Row>
                  </Card>

                  <Card label="preview">
                    <div className="py-3">
                      <AppearancePreview fontPx={s.terminalFontSize} />
                    </div>
                  </Card>

                  <Card label="type & density">
                    <Row
                      label="text size"
                      sub="base size for terminal + chat — scales the cockpit"
                    >
                      <div className="flex items-center gap-3">
                        <Type size={13} className="text-[var(--color-muted)]" />
                        <Slider
                          value={s.terminalFontSize}
                          min={10}
                          max={20}
                          onChange={(v) => {
                            patch({ terminalFontSize: v });
                            applyFontScale(v);
                          }}
                        />
                        <Stepper
                          value={s.terminalFontSize}
                          min={10}
                          max={20}
                          suffix="px"
                          onChange={(v) => {
                            patch({ terminalFontSize: v });
                            applyFontScale(v);
                          }}
                        />
                      </div>
                    </Row>
                    <Row label="density" sub="how tight the cockpit packs — terminal goes compact + all-mono">
                      <Segmented<Density>
                        value={density}
                        onChange={(d) => {
                          applyDensity(d);
                          setLocalDensity(d);
                        }}
                        options={[
                          { value: "comfortable", label: "comfortable" },
                          { value: "compact", label: "compact" },
                          { value: "terminal", label: "terminal" },
                        ]}
                      />
                    </Row>
                  </Card>

                  <Card label="chrome & motion">
                    <Row label="splash on launch" sub="show the mascot boot screen">
                      <Toggle
                        checked={s.splashOnLaunch}
                        onChange={(v) => patch({ splashOnLaunch: v })}
                      />
                    </Row>
                    <Row
                      label="composer flash"
                      sub="ambient light on the prompt box — calm is minimal, lush lights it from within, max adds drift + a border tide"
                    >
                      <Segmented<FlashLevel>
                        value={s.flashLevel}
                        onChange={(v) => {
                          patch({ flashLevel: v });
                          applyFlashLevel(v);
                        }}
                        options={[
                          { value: "calm", label: "calm" },
                          { value: "lush", label: "lush" },
                          { value: "max", label: "max" },
                        ]}
                      />
                    </Row>
                    <Row label="top bar" sub="show brand chrome, compact controls, or hide it">
                      <Segmented<TopBarMode>
                        value={s.topBarMode}
                        onChange={(v) => patch({ topBarMode: v })}
                        options={[
                          { value: "full", label: "full" },
                          { value: "compact", label: "compact" },
                          { value: "hidden", label: "hidden" },
                        ]}
                      />
                    </Row>
                    <Row label="reduce motion" sub="cut animations + transitions">
                      <Toggle
                        checked={s.reduceMotion}
                        onChange={(v) => {
                          patch({ reduceMotion: v });
                          applyReduceMotion(v);
                        }}
                      />
                    </Row>
                    {/* (the "windowed workspace" toggle retired — windowed IS
                        the desktop workspace now; compact/mobile web keeps
                        the stacked grid automatically.) */}
                  </Card>

                  {/* the pet's switches live here (S4). */}
                  <Card label="pet">
                    <Row
                      label="pet roams the workspace"
                      sub="the glass spirit wanders the floor, naps at night, celebrates finished runs — grab it, toss it, right-click to care"
                    >
                      <Toggle checked={s.petRoam} onChange={(v) => patch({ petRoam: v })} />
                    </Row>
                    <Row
                      label="pet speaks up"
                      sub="rare useful one-liners — a finished run, an error, usage pace; click the bubble to jump there. quiet mode and sleep silence it"
                    >
                      <Toggle checked={s.petVoice} onChange={(v) => patch({ petVoice: v })} />
                    </Row>
                  </Card>
                </>
              )}

              {section === "sidebar" && (
                <>
                  <p className="mb-3 text-[12px] leading-snug text-[var(--color-muted)]">
                    show or hide rail items. drag to reorder them right in the
                    sidebar. pinned sites can be unpinned here or via their ⋯ menu.
                  </p>
                  <Card label="layout">
                    <Row label="rail style" sub="full labels or compact icons only">
                      <Segmented<SidebarMode>
                        value={s.sidebarMode}
                        onChange={(v) => patch({ sidebarMode: v })}
                        options={[
                          { value: "full", label: "full" },
                          { value: "icons", label: "icons" },
                        ]}
                      />
                    </Row>
                  </Card>
                  <Card label="rail items">
                    {sidebar.items.map((it) => {
                      const isLink = it.kind.type === "link";
                      const app = it.kind.type === "app" ? SPAWN_BY_ID[it.kind.appId] : undefined;
                      const Icon = app?.icon ?? PanelLeft;
                      return (
                        <div
                          key={it.id}
                          className="flex items-center justify-between gap-3 py-2"
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            {isLink && it.faviconUrl ? (
                              <img src={it.faviconUrl} alt="" className="h-4 w-4 shrink-0 rounded-sm" />
                            ) : (
                              <Icon size={14} className="shrink-0 text-[var(--color-muted)]" />
                            )}
                            <span
                              className="truncate text-[13px]"
                              style={{
                                color: it.hidden ? "var(--color-faint)" : "var(--color-text-2)",
                              }}
                            >
                              {it.label}
                            </span>
                            <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--color-faint)]">
                              {it.group}
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {isLink ? (
                              <button
                                onClick={() => removeItem(it.id)}
                                title="unpin"
                                className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-danger)]"
                              >
                                <Trash2 size={13} />
                              </button>
                            ) : (
                              <button
                                onClick={() => toggleHidden(it.id, !it.hidden)}
                                title={it.hidden ? "show" : "hide"}
                                className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
                              >
                                {it.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </Card>
                  <div className="flex justify-end pt-1">
                    <button onClick={() => resetSidebar()} className={`${GHOST_BTN} px-3 py-1.5`}>
                      <RotateCcw size={13} />
                      reset sidebar to default
                    </button>
                  </div>
                </>
              )}

              {section === "notifications" && (
                <>
                  <Card label="alerts">
                    <Row label="native alerts" sub="os notifications outside the cockpit window">
                      <Segmented<NotificationNativeMode>
                        value={s.notificationNativeMode}
                        onChange={(v) => patch({ notificationNativeMode: v })}
                        options={[
                          { value: "important", label: "important" },
                          { value: "all", label: "all" },
                          { value: "off", label: "off" },
                        ]}
                      />
                    </Row>
                    <Row label="quiet mode" sub="hold events in the bell without interrupting">
                      <Toggle
                        checked={s.notificationQuietMode}
                        onChange={(v) => patch({ notificationQuietMode: v })}
                      />
                    </Row>
                  </Card>

                  <Card label="sound & motion">
                    <Row
                      label="soundscape"
                      sub="a whisper-quiet cue when a run lands or fails — synthesized, off by default"
                    >
                      <Toggle checked={s.soundscape} onChange={(v) => patch({ soundscape: v })} />
                    </Row>
                    <Row
                      label="playful effects"
                      sub="click sparks, confetti on a long clean run, the liveness ripple — reduce-motion still wins"
                    >
                      <Toggle checked={s.funFx} onChange={(v) => patch({ funFx: v })} />
                    </Row>
                  </Card>
                </>
              )}

              {section === "diagnostics" && <DiagnosticsSection />}

              {section === "plugins" && <PluginsSummarySection onClose={onClose} />}

              {section === "channels" && <ChannelsSummarySection onClose={onClose} />}

              {section === "oracles" && (
                <Card label="agents">
                  <Row
                    label="default oracle name"
                    sub="identity for the one-tap “spawn an oracle” shortcut (osai-<id>) — blank uses your name, else “agent”. shares the terminal socket set in general."
                  >
                    <input
                      value={s.primaryOracleId}
                      onChange={(e) => patch({ primaryOracleId: e.target.value })}
                      placeholder="agent"
                      spellCheck={false}
                      className={`w-[160px] ${FIELD_MONO}`}
                    />
                  </Row>
                  <Row
                    label="auto-refresh interval"
                    sub="how often the roster re-reads live sessions"
                  >
                    <Stepper
                      value={s.autoRefreshSeconds}
                      min={5}
                      max={120}
                      step={5}
                      suffix="s"
                      onChange={(v) => patch({ autoRefreshSeconds: v })}
                    />
                  </Row>
                  <Row
                    label="show non-osai tmux sessions"
                    sub="include sessions not started by osai"
                  >
                    <Toggle
                      checked={s.showNonOsaiSessions}
                      onChange={(v) => patch({ showNonOsaiSessions: v })}
                    />
                  </Row>
                </Card>
              )}

              {section === "shortcuts" && (
                <>
                  {shortcutGroups().map((g) => (
                    <Card key={g.title} label={g.title}>
                      {g.items.map((sc) => (
                        <div
                          key={sc.action}
                          className="flex items-center justify-between gap-3 py-2.5"
                        >
                          <span className="min-w-0">
                            <span className="block text-[13px] text-[var(--color-text-2)]">{sc.action}</span>
                            {sc.note && (
                              <span className="block font-mono text-[10px] text-[var(--color-faint)]">{sc.note}</span>
                            )}
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            {sc.keys.map((k, i) => (
                              <Keycap key={i}>{k}</Keycap>
                            ))}
                          </span>
                        </div>
                      ))}
                    </Card>
                  ))}
                </>
              )}

              {section === "about" && (
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                  {/* the OSAI diamond — same mark as the app icon + sidebar */}
                  <span className="grid h-20 w-20 place-items-center rounded-2xl border border-[color-mix(in_srgb,var(--color-accent)_34%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] shadow-[var(--osai-glow-soft)]">
                    <span className="block h-9 w-9 rotate-45 rounded-[9px] bg-[linear-gradient(135deg,var(--color-accent),var(--osai-accent-2))] shadow-[0_0_18px_color-mix(in_srgb,var(--color-accent)_70%,transparent)]" />
                  </span>
                  <div>
                    <div className="text-[16px] font-medium text-[var(--color-text)]">
                      OSAI cockpit
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-[var(--color-muted)]">
                      v2.2.1 · Jul.Nazz
                    </div>
                  </div>
                  <p className="text-[12px] text-[var(--color-text-2)]">
                    your AI co-founder&apos;s command deck
                  </p>

                  <UpdateCard />

                  {/* reset preferences — restores behavioral/appearance settings to
                      defaults, but keeps identity, engine, and onboarding state. */}
                  <div className="surface-card mt-1 w-full max-w-[360px] px-3.5 py-3 text-left">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[12px] font-medium text-[var(--color-text)]">reset preferences</div>
                        <p className="mt-0.5 text-[11px] leading-snug text-[var(--color-muted)]">
                          appearance, behavior, and notifications back to defaults — keeps your name, engine, and chats.
                        </p>
                      </div>
                      {confirmReset ? (
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            onClick={doResetAll}
                            className="press rounded-lg border border-[color-mix(in_srgb,var(--color-danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-danger)_15%,transparent)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--color-danger)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-danger)_25%,transparent)]"
                          >
                            confirm
                          </button>
                          <button
                            onClick={() => setConfirmReset(false)}
                            className="rounded-lg px-2 py-1.5 text-[12px] text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
                          >
                            cancel
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmReset(true)} className={`${GHOST_BTN} shrink-0`}>
                          <RotateCcw size={13} /> reset
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </m.div>
    </m.div>
      )}
    </AnimatePresence>
  );
}
