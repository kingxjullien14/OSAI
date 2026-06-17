// Scheduled Agents — recurring AI tasks. Each agent has a mission (the prompt it
// runs) and a schedule (cadence); the in-app scheduler (App.tsx) runs due agents
// in a background chat and notifies. Health/run-state is derived purely from the
// cadence + the last-run stamp — the old launchd/state-file runner is gone (the
// in-app tick replaced it), so there are no more state/queue/log files to read.

export type ScheduledAgentHealth = "scheduled" | "due" | "manual";

export interface ScheduledAgentConfig {
  id: string;
  label: string;
  shortLabel: string;
  cwd: string;
  mission: string;
  schedule?: string;
}

export interface ScheduledAgentSummary {
  id: ScheduledAgentConfig["id"];
  label: string;
  health: ScheduledAgentHealth;
  /** Short metric for compact rows — the cadence, "due now", or "manual". */
  primaryMetric: string;
  nextAction: string;
  /** The mission, surfaced as the "current job" line. */
  currentJob: string;
  schedule: string;
  lastRunAt: number | null;
  nextDueAt: number | null;
}

export interface ScheduledAgentDetail extends ScheduledAgentSummary {
  mission: string;
}

export interface ScheduledAgentChatSession {
  sessionId: string;
  title: string;
  updatedAt: number;
}

// The agent home (only used as the default cwd now) is resolved from the backend
// at runtime — nothing here bakes in a developer's home directory.
let runtimeHome = "";
export async function ensureScheduledAgentHome(): Promise<string> {
  if (runtimeHome) return runtimeHome;
  try {
    const { homeDir } = await import("./fs");
    runtimeHome = (await homeDir()) || "";
  } catch {
    runtimeHome = "";
  }
  return runtimeHome;
}

const agentHome = () => runtimeHome || "~";

const customAgentsKey = "aios.chatAgents.custom";
const lastScheduledRunKey = (id: string) => `aios.chatAgents.lastScheduledRun:${id}`;
const agentChatSessionKey = (id: string) => `aios.scheduledAgent.chatSession:${id}`;

/** Empty catalog — the shell ships with no agents; only the ones users create
 *  exist. (Kept as an export for type/id lookups.) */
export const SCHEDULED_AGENTS: ScheduledAgentConfig[] = [];

function normalizeAgentId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^aios-/, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Drop stored absolute home paths baked by an older build (possibly on another
 *  machine) — deriving fresh ones from the current home self-heals, so we never
 *  trust a persisted `/Users/<x>/…`, `/home/<x>/…`, or `C:\Users\<x>\…`. */
const cleanseStored = (value: unknown): string | undefined => {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) return undefined;
  if (/^(?:\/Users\/|\/home\/|[A-Za-z]:[\\/]Users[\\/])/.test(s)) return undefined;
  return s;
};

function readStoredAgents(): Partial<ScheduledAgentConfig>[] {
  if (typeof localStorage === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(customAgentsKey) || "[]") as Partial<ScheduledAgentConfig>[];
  } catch {
    return [];
  }
}

export function loadCustomScheduledAgents(): ScheduledAgentConfig[] {
  if (typeof localStorage === "undefined") return [];
  try {
    return readStoredAgents().reduce<ScheduledAgentConfig[]>((agents, agent) => {
      const id = normalizeAgentId(String(agent.id || agent.label || ""));
      if (!id || !agent.label) return agents;
      agents.push({
        id,
        label: String(agent.label).trim(),
        shortLabel: String(agent.shortLabel || id).trim(),
        cwd: cleanseStored(agent.cwd) ?? agentHome(),
        mission: String(agent.mission || "custom aios agent").trim(),
        schedule: String(agent.schedule || "manual").trim(),
      });
      return agents;
    }, []);
  } catch {
    return [];
  }
}

export function loadConfiguredScheduledAgents(): ScheduledAgentConfig[] {
  // Default: NO agents. Only the ones the user explicitly creates show up.
  const seen = new Set<string>();
  return loadCustomScheduledAgents().filter((agent) => {
    if (seen.has(agent.id)) return false;
    seen.add(agent.id);
    return true;
  });
}

/** Removes a user-created agent and its persisted chat session / schedule state. */
export function removeScheduledAgent(id: string): void {
  if (typeof localStorage === "undefined") return;
  const next = readStoredAgents().filter(
    (agent) => normalizeAgentId(String(agent.id || agent.label || "")) !== id,
  );
  localStorage.setItem(customAgentsKey, JSON.stringify(next));
  try {
    localStorage.removeItem(agentChatSessionKey(id));
    localStorage.removeItem(lastScheduledRunKey(id));
  } catch {
    /* ignore */
  }
}

export function createScheduledAgent(input: {
  label: string;
  mission?: string;
  schedule?: string;
  cwd?: string;
}): ScheduledAgentConfig | null {
  if (typeof localStorage === "undefined") return null;
  const label = input.label.trim();
  const id = normalizeAgentId(label);
  if (!id) return null;
  const existing = loadConfiguredScheduledAgents().find((agent) => agent.id === id);
  if (existing) return existing;
  const agent: ScheduledAgentConfig = {
    id,
    label,
    shortLabel: id,
    cwd: input.cwd?.trim() || agentHome(),
    mission: input.mission?.trim() || "custom aios agent",
    schedule: input.schedule?.trim() || "manual",
  };
  // Persist only the user's inputs; the cwd default re-resolves at load.
  const stored: Partial<ScheduledAgentConfig> = {
    id,
    label,
    mission: agent.mission,
    schedule: agent.schedule,
    ...(input.cwd?.trim() ? { cwd: input.cwd.trim() } : {}),
  };
  localStorage.setItem(customAgentsKey, JSON.stringify([...readStoredAgents(), stored]));
  return agent;
}

export function scheduledAgentById(id: string): ScheduledAgentConfig | undefined {
  return loadConfiguredScheduledAgents().find((agent) => agent.id === id);
}

export function loadScheduledAgentChatSession(id: string): ScheduledAgentChatSession | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(agentChatSessionKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ScheduledAgentChatSession>;
    if (!parsed.sessionId || !parsed.title) return null;
    return {
      sessionId: parsed.sessionId,
      title: parsed.title,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

export function saveScheduledAgentChatSession(id: string, session: ScheduledAgentChatSession): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(agentChatSessionKey(id), JSON.stringify(session));
  } catch {
    /* ignore */
  }
}

export function loadScheduledAgentLastScheduledRun(id: string): number | null {
  if (typeof localStorage === "undefined") return null;
  const value = Number(localStorage.getItem(lastScheduledRunKey(id)) || "0");
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function saveScheduledAgentLastScheduledRun(id: string, at: number): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(lastScheduledRunKey(id), String(at));
  } catch {
    /* ignore */
  }
}

/** Parse the free-text `schedule` into a pulse interval. Supported cadences:
 *  "hourly" / "daily" / "weekly", "every N min|hours|days", and the legacy
 *  phrasings ("always" → 6h, "work block" → daily, any "…hour…" → hourly).
 *  "manual"/empty/unknown returns null = the scheduler never fires it. */
export function scheduleIntervalMs(schedule: string | undefined | null): number | null {
  const HOUR = 60 * 60_000;
  const DAY = 24 * HOUR;
  const s = (schedule ?? "").trim().toLowerCase();
  if (!s || s.includes("manual")) return null;
  const m = s.match(/^every\s+(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)$/);
  if (m) {
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) return null;
    const unit = m[2][0]; // m | h | d
    const ms = unit === "m" ? n * 60_000 : unit === "h" ? n * HOUR : n * DAY;
    // floor at 5 minutes — a runaway "every 1 min" agent is a quota incident
    return Math.max(ms, 5 * 60_000);
  }
  if (s.includes("hour")) return HOUR;
  if (s.includes("always")) return 6 * HOUR;
  if (s.includes("daily") || s.includes("work block")) return DAY;
  if (s.includes("week")) return 7 * DAY;
  return null;
}

/** True when an agent's cadence says it should pulse now. A never-stamped agent
 *  with a cadence is due immediately (the first pulse starts the clock). */
export function isScheduledAgentDue(
  agent: Pick<ScheduledAgentConfig, "id" | "schedule">,
  now: number,
  lastRun: number | null = loadScheduledAgentLastScheduledRun(agent.id),
): boolean {
  const interval = scheduleIntervalMs(agent.schedule);
  if (interval == null) return false;
  return lastRun == null || now - lastRun >= interval;
}

/** Every configured agent whose schedule is due. */
export function dueScheduledAgents(now = Date.now()): ScheduledAgentConfig[] {
  return loadConfiguredScheduledAgents().filter((agent) => isScheduledAgentDue(agent, now));
}

export function buildScheduledAgentChatSeed(agent: ScheduledAgentConfig): string {
  return [
    `you are the aios ${agent.label} agent. execute this mission from this chatpane: ${agent.mission}.`,
    "",
    "context:",
    `- agent: ${agent.label}`,
    `- mission: ${agent.mission}`,
    `- schedule: ${agent.schedule || "manual"}`,
    `- workspace: ${agent.cwd}`,
    "",
    "operating rules:",
    "- act like a live goal-moving operator, not a logger.",
    "- start by inspecting the workspace + recent context before proposing work.",
    "- do not ask the user to continue, approve, or tell you what to do next inside this agent chat.",
    "- treat this chat as an ordered execution log for the aios shell to monitor and control.",
    "- continue autonomously inside your policy limits; when blocked, write a concise pending approval item instead of asking a question.",
    "- report concrete next actions, current blockers, and what moves the goal.",
    "- do not execute irreversible external actions. produce concrete next steps, artifacts, and pending approval items for the shell control plane.",
    "- if work needs background execution, create/steer the right local process and report exactly where it is observable.",
    "",
    "first task:",
    "take the next useful action toward the mission and leave an ordered status entry for the shell control plane.",
  ].join("\n");
}

export function buildScheduledAgentRunCommand(
  agent: { label: string; mission?: string },
  reason = "manual",
): string {
  return [
    `run a ${reason} pulse for ${agent.label}.`,
    "",
    `goal: ${agent.mission?.trim() || "move this agent's mission forward"}.`,
    "",
    "do now:",
    "- inspect the workspace + relevant local context.",
    "- choose the single highest-leverage action for today.",
    "- produce the artifact or draft inside this chatpane.",
    "- do not ask the user what to do next.",
    "- if approval is needed, write a pending approval item for the shell control plane.",
    "- report blocker, next step, and the control decision needed.",
  ].join("\n");
}

/** Derives the run-state summary purely from the cadence + last-run stamp (no
 *  state files). "running"/"failed" would need run-result capture (a later
 *  phase), so today health reflects scheduling. */
export function summarizeScheduledAgentState(agent: ScheduledAgentConfig): ScheduledAgentSummary {
  const interval = scheduleIntervalMs(agent.schedule);
  const lastRunAt = loadScheduledAgentLastScheduledRun(agent.id);
  const hasCadence = interval != null;
  const due = hasCadence && (lastRunAt == null || Date.now() - lastRunAt >= interval);
  const nextDueAt = hasCadence ? (lastRunAt == null ? Date.now() : lastRunAt + interval) : null;
  const health: ScheduledAgentHealth = !hasCadence ? "manual" : due ? "due" : "scheduled";
  return {
    id: agent.id,
    label: agent.label,
    health,
    primaryMetric: !hasCadence ? "manual" : due ? "due now" : agent.schedule || "scheduled",
    nextAction: due ? "run now" : "open chat to run or steer",
    currentJob: agent.mission,
    schedule: agent.schedule || "manual",
    lastRunAt,
    nextDueAt,
  };
}

export async function loadScheduledAgentSummaries(): Promise<ScheduledAgentSummary[]> {
  await ensureScheduledAgentHome();
  return loadConfiguredScheduledAgents().map(summarizeScheduledAgentState);
}

export async function loadScheduledAgentDetails(): Promise<ScheduledAgentDetail[]> {
  await ensureScheduledAgentHome();
  return loadConfiguredScheduledAgents().map((agent) => ({
    ...summarizeScheduledAgentState(agent),
    mission: agent.mission,
  }));
}
