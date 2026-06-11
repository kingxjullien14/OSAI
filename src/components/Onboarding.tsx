/** First-run onboarding — a calm, skippable, 5-step flow that feels like the
 *  chat surface (same tokens / utilities). welcome → name → engine (live CLI
 *  detection) → MCP review → theme & accent. Gated on settings.onboardingComplete
 *  and mounted after the splash in App.tsx. Esc / backdrop = skip-and-persist.
 *  See PLAN-superapp-uiux.md §5. */
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Monitor,
  Moon,
  Plug,
  RefreshCw,
  Sparkles,
  Sun,
} from "lucide-react";

import { loadSettings, saveSettings } from "../lib/settings";
import { defaultAiForProvider, engineForProvider, type ChatEngine } from "../lib/chat";
import { detectProviders, type ProviderStatus } from "../lib/providerDetect";
import { listPlugins } from "../lib/plugins";
import {
  ACCENT_ORDER,
  ACCENT_PRESETS,
  getAccent,
  getTheme,
  setAccent,
  setTheme,
  type Accent,
  type Theme,
} from "../lib/theme";

const ENGINES: { id: ChatEngine; label: string; note: string }[] = [
  { id: "claude", label: "claude code", note: "anthropic's cli · opus / sonnet / haiku" },
  { id: "codex", label: "codex", note: "chatgpt subscription · gpt-5.x" },
  { id: "opencode", label: "opencode", note: "openrouter + one free model" },
];

const STEPS = ["welcome", "name", "engine", "plugins", "look"] as const;

export function Onboarding({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(() => loadSettings().userName);
  const [provider, setProvider] = useState(() => loadSettings().chatProvider);
  const [statuses, setStatuses] = useState<ProviderStatus[] | null>(null);
  const [mcps, setMcps] = useState<string[] | null>(null);
  const [theme, setThemeLocal] = useState<Theme>(getTheme());
  const [accent, setAccentLocal] = useState<Accent>(getAccent());
  const nameRef = useRef<HTMLInputElement>(null);

  // probe installed engine CLIs (auto-select the first detected) + read MCPs.
  useEffect(() => {
    detectProviders().then((s) => {
      setStatuses(s);
      const firstAvail = s.find((x) => x.available);
      // only auto-pick if the user hasn't already got a saved non-default choice
      if (firstAvail) setProvider(`${firstAvail.id}-cli`);
    });
    refreshMcps();
  }, []);

  function refreshMcps() {
    setMcps(null);
    listPlugins()
      .then((p) => setMcps(p.mcps))
      .catch(() => setMcps([]));
  }

  // autofocus the name field when its step opens.
  useEffect(() => {
    if (step === 1) setTimeout(() => nameRef.current?.focus(), 60);
  }, [step]);

  const selectedEngine = engineForProvider(provider);
  const availableOf = (id: ChatEngine) =>
    statuses?.find((s) => s.id === id)?.available ?? null;

  function finish() {
    saveSettings({
      userName: name.trim(),
      chatProvider: provider,
      chatModel: null, // base derives from the chosen provider (PLAN §13)
      defaultAi: defaultAiForProvider(provider),
      onboardingComplete: true,
      onboardedAt: Date.now(),
    });
    onClose();
  }

  function skip() {
    // persist completion so it never re-shows; keep whatever's been set so far.
    saveSettings({ onboardingComplete: true, onboardedAt: Date.now() });
    onClose();
  }

  const last = STEPS.length - 1;
  const next = () => (step >= last ? finish() : setStep((s) => s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  // Esc anywhere = skip-and-persist.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        skip();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-[var(--color-bg)]/70 px-6 backdrop-blur-md"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) skip();
      }}
    >
      <div className="surface-pop focus-accent w-full max-w-[440px] p-6" role="dialog" aria-modal="true">
        {/* progress pips */}
        <div className="mb-5 flex items-center justify-center gap-1.5">
          {STEPS.map((s, i) => (
            <span
              key={s}
              className="h-1.5 rounded-full transition-all"
              style={{
                width: i === step ? 22 : 6,
                background:
                  i <= step ? "var(--color-accent)" : "var(--color-border-strong)",
                transitionDuration: "var(--aios-dur-base)",
              }}
            />
          ))}
        </div>

        {/* step body (re-keyed so each step animates in) */}
        <div key={step} className="fade-in-up min-h-[230px]">
          {step === 0 && (
            <div className="flex flex-col items-center text-center">
              <span className="brand-logo mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
                <Sparkles size={26} />
              </span>
              <h1 className="hero-title mb-2">welcome to aios</h1>
              <p className="max-w-[320px] text-[14px] leading-relaxed text-[var(--color-text-2)]">
                a calm, agent-first workspace — chat, terminal, browser and files,
                working together. let's set it up in a few quick steps.
              </p>
            </div>
          )}

          {step === 1 && (
            <div>
              <h2 className="hero-title mb-1">what should we call you?</h2>
              <p className="mb-5 text-[13px] text-[var(--color-muted)]">
                shown in your homescreen greeting. you can skip this.
              </p>
              <input
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") next();
                }}
                placeholder="your name"
                spellCheck={false}
                className="focus-accent w-full rounded-[var(--aios-radius-md)] border border-[var(--color-border-strong)] bg-[var(--color-bg)] px-4 py-3 text-[var(--aios-text-lg)] text-[var(--color-text)] placeholder:text-[var(--color-faint)] focus:outline-none"
              />
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 className="hero-title mb-1">choose your engine</h2>
              <p className="mb-4 text-[13px] text-[var(--color-muted)]">
                {statuses === null
                  ? "looking for installed clis…"
                  : "the agent that powers your chats. you can change it later."}
              </p>
              <div className="flex flex-col gap-2">
                {ENGINES.map((eng) => {
                  const avail = availableOf(eng.id);
                  const selected = selectedEngine === eng.id;
                  return (
                    <button
                      key={eng.id}
                      type="button"
                      onClick={() => setProvider(`${eng.id}-cli`)}
                      className={`press flex items-center gap-3 rounded-[var(--aios-radius-md)] border px-3 py-2.5 text-left transition-colors ${
                        selected
                          ? "border-[var(--color-accent)]/50 bg-[var(--color-accent-soft)]"
                          : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]"
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13.5px] text-[var(--color-text)]">
                          {eng.label}
                        </span>
                        <span className="block truncate text-[11.5px] text-[var(--color-muted)]">
                          {eng.note}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5 font-mono text-[10.5px] text-[var(--color-muted)]">
                        <span
                          className={`status-dot ${
                            avail === null
                              ? "status-dot--dormant"
                              : avail
                                ? "status-dot--active"
                                : "status-dot--cold"
                          }`}
                        />
                        {avail === null ? "" : avail ? "installed" : "not found"}
                      </span>
                      {selected && <Check size={15} className="shrink-0 text-[var(--color-accent)]" />}
                    </button>
                  );
                })}
              </div>
              {statuses && !statuses.some((s) => s.available) && (
                <p className="mt-3 text-[12px] text-[var(--color-faint)]">
                  no agent cli detected — opencode ships a free model, or install one
                  later (you can still explore the app).
                </p>
              )}
            </div>
          )}

          {step === 3 && (
            <div>
              <h2 className="hero-title mb-1">connect your tools</h2>
              <p className="mb-4 text-[13px] text-[var(--color-muted)]">
                aios reads your MCP servers from <span className="font-mono text-[12px]">~/.claude.json</span>.
              </p>
              {mcps === null ? (
                <div className="flex items-center gap-2 text-[13px] text-[var(--color-muted)]">
                  <RefreshCw size={14} className="animate-spin" /> checking…
                </div>
              ) : mcps.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {mcps.map((m) => (
                    <span
                      key={m}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-panel)]/70 px-2.5 py-1 text-[11.5px] text-[var(--color-text-2)]"
                    >
                      <span className="status-dot status-dot--active" />
                      {m}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="surface-card flex flex-col items-center gap-2 px-4 py-6 text-center">
                  <Plug size={22} className="text-[var(--color-faint)]" />
                  <span className="text-[13px] text-[var(--color-muted)]">no MCP servers yet</span>
                  <span className="font-mono text-[11px] text-[var(--color-faint)]">
                    claude mcp add &lt;name&gt; …
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={refreshMcps}
                className="press mt-3 inline-flex items-center gap-1.5 text-[12px] text-[var(--color-muted)] hover:text-[var(--color-text)]"
              >
                <RefreshCw size={12} /> recheck
              </button>
            </div>
          )}

          {step === 4 && (
            <div>
              <h2 className="hero-title mb-1">make it yours</h2>
              <p className="mb-4 text-[13px] text-[var(--color-muted)]">
                theme and accent — changes apply live.
              </p>
              <div className="mb-4 grid grid-cols-3 gap-2">
                {(
                  [
                    { id: "system", label: "system", icon: Monitor },
                    { id: "light", label: "light", icon: Sun },
                    { id: "dark", label: "dark", icon: Moon },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setTheme(t.id);
                      setThemeLocal(t.id);
                    }}
                    className={`press flex flex-col items-center gap-1.5 rounded-[var(--aios-radius-md)] border px-2 py-3 transition-colors ${
                      theme === t.id
                        ? "border-[var(--color-accent)]/50 bg-[var(--color-accent-soft)] text-[var(--color-text)]"
                        : "border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-border-strong)]"
                    }`}
                  >
                    <t.icon size={16} />
                    <span className="text-[11.5px]">{t.label}</span>
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {ACCENT_ORDER.map((a) => (
                  <button
                    key={a}
                    type="button"
                    aria-label={a}
                    onClick={() => {
                      setAccent(a);
                      setAccentLocal(a);
                    }}
                    className="press h-7 w-7 rounded-full border-2 transition-transform"
                    style={{
                      background: ACCENT_PRESETS[a],
                      borderColor:
                        accent === a ? "var(--color-text)" : "transparent",
                    }}
                  />
                ))}
              </div>
              <p className="mt-4 text-[12px] text-[var(--color-faint)]">
                chatting with <span className="text-[var(--color-text-2)]">{selectedEngine}</span> ·
                greeting <span className="text-[var(--color-text-2)]">{name.trim() || "there"}</span>
              </p>
            </div>
          )}
        </div>

        {/* footer */}
        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={step === 0 ? skip : back}
            className="press text-[12.5px] text-[var(--color-muted)] hover:text-[var(--color-text)]"
          >
            {step === 0 ? "skip setup" : "back"}
          </button>
          <button
            type="button"
            onClick={next}
            className="btn-glow flex items-center gap-1.5 rounded-[var(--aios-radius-pill)] bg-[var(--color-accent)] px-4 py-2 text-[13px] font-medium text-[var(--color-accent-fg)]"
          >
            {step === 0 ? "get started" : step === last ? "enter aios" : "continue"}
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
