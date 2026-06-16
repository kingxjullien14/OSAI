/**
 * UsageGlance — the ONE source for the live provider-usage rendering shared by
 * the sidebar (SidebarUsage) and the idle home (IdleControlCenter). Lifted out of
 * SidebarUsage so both surfaces use a single component + a single data poll
 * shape — no duplicated bar markup, no drift between the two.
 *
 * `ProviderBlock` is the titled claude/codex block (5h + 7d bars + a pace
 * warning). `UsageGlance` is the self-loading section (claude + codex, polled on
 * a 30s interval, hides itself when neither provider has data) used directly by
 * the sidebar; the idle home composes `ProviderBlock` itself so it can lay the
 * two providers out horizontally + quiet.
 *
 * Color thresholds match IdleDashboard's Meter / the chat-pane meters:
 *   accent under ~65% · warning to ~85% · danger above.
 */
import { useEffect, useState } from "react";

import {
  claudeRate,
  codexRate,
  resetIn,
  type ClaudeRate,
  type CodexRate,
  type ModelRate,
} from "../../lib/dashboard";
import { usagePaceRisk, type UsagePaceRisk } from "../../lib/usagePace";
import { reportDiag } from "../../lib/diag";
import { loadSettings, subscribe as subscribeSettings } from "../../lib/settings";
import { NumberTicker } from "../fx/NumberTicker";

const FIVE_HOURS = 5 * 3600;
const SEVEN_DAYS = 7 * 24 * 3600;

/** accent < 65% · warning < 85% · danger above — matches IdleDashboard's Meter. */
function barColor(pct: number): string {
  if (pct >= 85) return "var(--color-danger)";
  if (pct >= 65) return "var(--color-warning)";
  return "var(--color-accent)";
}

function UsageBar({
  label,
  pct,
  resetsAt,
  showRemaining = false,
}: {
  label: string;
  pct: number | null;
  resetsAt: number | null;
  showRemaining?: boolean;
}) {
  if (pct == null) return null;
  const clamped = Math.min(Math.max(pct, 0), 100);
  const reset = resetsAt ? resetIn(resetsAt) : "";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-[10px]">
        <span className="font-medium uppercase tracking-widest text-[var(--color-muted)]">{label}</span>
        <span className="flex items-baseline gap-1.5">
          {reset && <span className="text-[var(--color-faint)]">resets {reset}</span>}
          <span className="font-mono text-[var(--color-text-2)]">
            <NumberTicker value={showRemaining ? 100 - pct : pct} suffix="%" />
            {showRemaining ? " left" : ""}
          </span>
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--color-panel-2)]">
        <div
          className="h-full rounded-full transition-[width] duration-700"
          style={{ width: `${clamped}%`, background: barColor(pct) }}
        />
      </div>
    </div>
  );
}

function PaceWarning({ risk }: { risk: UsagePaceRisk | null }) {
  if (!risk) return null;
  return (
    <div
      className={`rounded-md border px-2 py-1 text-[10px] leading-snug ${
        risk.level === "danger"
          ? "border-[color-mix(in_srgb,var(--color-danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-danger)_12%,transparent)] text-[var(--color-danger)]"
          : "border-[color-mix(in_srgb,var(--color-warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_12%,transparent)] text-[var(--color-warning)]"
      }`}
    >
      <span className="font-medium">{risk.title}</span>
      <span className="text-[var(--color-muted)]"> · {risk.detail}</span>
    </div>
  );
}

function topRisk(...risks: Array<UsagePaceRisk | null>): UsagePaceRisk | null {
  return risks.find((risk) => risk?.level === "danger") ?? risks.find(Boolean) ?? null;
}

/**
 * Per-model carve-out rows nested under a provider block — the weekly windows
 * some models carry on top of the account ones (claude sonnet/opus, codex
 * spark). One quiet row each: name + its 7d window (5h when that's all there
 * is) + a hairline bar, indented behind a left rule so they read as children.
 */
function ModelRows({
  models,
  showRemaining,
}: {
  models?: Record<string, ModelRate>;
  showRemaining: boolean;
}) {
  const entries = Object.entries(models ?? {})
    .map(([name, m]) => {
      const tag = m.sevenDay.pct != null ? "7d" : "5h";
      const win = m.sevenDay.pct != null ? m.sevenDay : m.fiveHour;
      return { name, tag, win };
    })
    .filter((e) => e.win.pct != null)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 border-l border-[var(--color-border)] pl-2">
      {entries.map(({ name, tag, win }) => {
        const pct = Math.min(Math.max(win.pct!, 0), 100);
        const reset = win.resetsAt ? resetIn(win.resetsAt) : "";
        return (
          <div
            key={name}
            className="flex flex-col gap-0.5"
            title={`${name} has its own ${tag === "7d" ? "weekly" : "5-hour"} window on top of the account one${reset ? ` · resets ${reset}` : ""}`}
          >
            <div className="flex items-baseline justify-between gap-2 text-[10px]">
              <span className="truncate lowercase text-[var(--color-muted)]">{name}</span>
              <span className="shrink-0 font-mono text-[var(--color-text-2)]">
                {tag} <NumberTicker value={showRemaining ? 100 - pct : pct} suffix="%" />
                {showRemaining ? " left" : ""}
              </span>
            </div>
            <div className="h-0.5 w-full overflow-hidden rounded-full bg-[var(--color-panel-2)]">
              <div
                className="h-full rounded-full transition-[width] duration-700"
                style={{ width: `${pct}%`, background: barColor(pct) }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** One provider's titled block (e.g. "claude" / "codex") with its 5h + 7d bars. */
export function ProviderBlock({
  name,
  fiveHour,
  sevenDay,
  models,
  showRemaining = false,
}: {
  name: string;
  fiveHour: { pct: number | null; resetsAt: number | null };
  sevenDay: { pct: number | null; resetsAt: number | null };
  models?: Record<string, ModelRate>;
  showRemaining?: boolean;
}) {
  if (fiveHour.pct == null && sevenDay.pct == null) return null;
  const fiveHourRisk = usagePaceRisk({
    pct: fiveHour.pct,
    resetsAt: fiveHour.resetsAt,
    windowSeconds: FIVE_HOURS,
  });
  const sevenDayRisk = usagePaceRisk({
    pct: sevenDay.pct,
    resetsAt: sevenDay.resetsAt,
    windowSeconds: SEVEN_DAYS,
  });
  const risk = topRisk(fiveHourRisk, sevenDayRisk);
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] font-medium lowercase tracking-wide text-[var(--color-text-2)]">
        {name}
      </span>
      <UsageBar label="5h" pct={fiveHour.pct} resetsAt={fiveHour.resetsAt} showRemaining={showRemaining} />
      <UsageBar label="7d" pct={sevenDay.pct} resetsAt={sevenDay.resetsAt} showRemaining={showRemaining} />
      <ModelRows models={models} showRemaining={showRemaining} />
      <PaceWarning risk={risk} />
    </div>
  );
}

/**
 * Hook that polls claude + codex usage every 30s. Shared by both the sidebar and
 * the idle home so they draw from one source. Returns the raw rate shapes plus
 * `hasClaude` / `hasCodex` flags so the caller can hide empty providers.
 */
export function useUsageRates() {
  const [claude, setClaude] = useState<ClaudeRate | null>(null);
  const [codex, setCodex] = useState<CodexRate | null>(null);
  // false until the first poll settles — lets callers show a skeleton instead of
  // a blank-then-pop (we can't tell "loading" from "no data" by the rates alone).
  const [loaded, setLoaded] = useState(false);
  // The "show codex usage" setting — gates BOTH the fetch and the display, so
  // the sidebar AND the idle home honor it from this one source. Reactive so
  // flipping it in Settings takes effect without a reload.
  const [showCodex, setShowCodex] = useState(() => loadSettings().showCodexUsage);
  useEffect(() => subscribeSettings((s) => setShowCodex(s.showCodexUsage)), []);

  useEffect(() => {
    let alive = true;
    const load = () => {
      const c = claudeRate()
        .then((v) => alive && setClaude(v))
        .catch((e) => reportDiag("usage.load", e, { action: "claudeRate" }));
      // Codex usage reads ~/.codex/auth.json (a ChatGPT-sub token). When the
      // block is hidden we don't fetch at all — no point pinging ChatGPT's
      // usage API with a token that may not be the user's own.
      const x = showCodex
        ? codexRate()
            .then((v) => alive && setCodex(v))
            .catch((e) => reportDiag("usage.load", e, { action: "codexRate" }))
        : Promise.resolve();
      if (!showCodex && alive) setCodex(null);
      void Promise.allSettled([c, x]).then(() => {
        if (alive) setLoaded(true);
      });
    };
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [showCodex]);

  const hasClaude = !!claude && (claude.fiveHour.pct != null || claude.sevenDay.pct != null);
  const hasCodex =
    showCodex && !!codex && (codex.fiveHour.pct != null || codex.sevenDay.pct != null);
  return { claude, codex, hasClaude, hasCodex, loaded };
}

/** Skeleton shimmer shown during the first usage poll (reduce-motion-safe via
 *  the master guard in App.css). */
function UsageSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-3 border-t border-[var(--color-border)] pt-3">
      <span className="text-[10px] font-medium uppercase tracking-widest text-[var(--color-muted)]">usage</span>
      {[0, 1].map((i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <div className="h-2 w-12 rounded bg-[var(--color-panel-2)]" />
          <div className="h-1.5 w-full rounded-full bg-[var(--color-panel-2)]" />
          <div className="h-1.5 w-full rounded-full bg-[var(--color-panel-2)]" />
        </div>
      ))}
    </div>
  );
}

/** Sidebar usage section — the narrow stacked claude+codex blocks. */
export function UsageGlance() {
  const { claude, codex, hasClaude, hasCodex, loaded } = useUsageRates();
  if (!loaded) return <UsageSkeleton />; // first poll in flight → shimmer, not blank
  if (!hasClaude && !hasCodex)
    // never silently hide — say WHY there's nothing (user-reported: "I can't
    // see my usage limits"). claude's 5h/7d only exist once its statusline
    // hook writes ~/.aios/state/usage.json; codex once its CLI reports.
    return (
      <div
        className="flex flex-col gap-1 border-t border-[var(--color-border)] pt-3"
        title={"the 5h/7d windows appear after the engine's first usage report:\nclaude — the aios statusline hook writes ~/.aios/state/usage.json on each tick\ncodex — the CLI pushes its ChatGPT-sub windows"}
      >
        <span className="text-[10px] font-medium uppercase tracking-widest text-[var(--color-muted)]">usage</span>
        <span className="text-[10.5px] leading-snug text-[var(--color-faint)]">
          waiting for the first usage report from claude / codex
        </span>
      </div>
    );

  return (
    <div className="flex flex-col gap-3 border-t border-[var(--color-border)] pt-3">
      <span className="text-[10px] font-medium uppercase tracking-widest text-[var(--color-muted)]">usage</span>
      {hasClaude ? (
        <ProviderBlock
          name="claude"
          fiveHour={claude!.fiveHour}
          sevenDay={claude!.sevenDay}
          models={claude!.models}
          showRemaining
        />
      ) : (
        // one provider reporting while claude is silent looked like fake data
        // (user-reported) — say explicitly why claude has no bars yet.
        <div
          className="flex flex-col gap-0.5"
          title={"claude reports its 5h/7d windows through the aios statusline hook,\nwhich writes ~/.aios/state/usage.json on every claude-code tick.\nsnapshots older than 3h are ignored — run an interactive claude\nsession (e.g. the claude code terminal pane) to refresh."}
        >
          <span className="text-[10px] font-medium lowercase tracking-wide text-[var(--color-text-2)]">claude</span>
          <span className="text-[10.5px] leading-snug text-[var(--color-faint)]">
            no recent usage report — start a claude session to refresh
          </span>
        </div>
      )}
      {hasCodex && (
        // labeled with its true source: the ChatGPT-subscription account
        // windows (read via ~/.codex/auth.json), live even without the CLI.
        <ProviderBlock
          name="codex · chatgpt sub"
          fiveHour={codex!.fiveHour}
          sevenDay={codex!.sevenDay}
          models={codex!.models}
          showRemaining
        />
      )}
    </div>
  );
}
