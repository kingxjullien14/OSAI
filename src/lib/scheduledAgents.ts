import { joinPath } from "./paths.ts";

export type ScheduledAgentHealth = "running" | "scheduled" | "needs-steer" | "failed" | "unknown";

export interface ScheduledAgentConfig {
  id: string;
  label: string;
  shortLabel: string;
  launchdLabel: string;
  statePath: string;
  queuePath: string;
  stdoutPath: string;
  stderrPath: string;
  cwd: string;
  mission: string;
  schedule?: string;
}

export interface ScheduledAgentLaunchdState {
  running: boolean;
  lastExit: number | null;
}

export interface ScheduledAgentRawState {
  status?: Record<string, any> | null;
  queue?: any[] | Record<string, any> | null;
  launchd?: ScheduledAgentLaunchdState | null;
}

export interface ScheduledAgentSummary {
  id: ScheduledAgentConfig["id"];
  label: string;
  health: ScheduledAgentHealth;
  primaryMetric: string;
  nextAction: string;
  currentJob: string;
  schedule?: string;
  lastRunAt?: number | null;
}

export interface ScheduledAgentDetail extends ScheduledAgentSummary {
  mission: string;
  schedule: string;
  stdoutPath: string;
  stderrPath: string;
  statePath: string;
  queuePath: string;
  logTail: string[];
}

export interface ScheduledAgentChatSession {
  sessionId: string;
  title: string;
  updatedAt: number;
}

// The agent home is resolved from the backend at runtime — nothing in this
// module may bake in a developer's home directory. Sync callers read the
// cached value; async loaders await ensureScheduledAgentHome() first. Until the
// cache is warm, derived paths use "~" (readJson fails soft → health unknown).
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
const defaultStatePath = (id: string) => joinPath(agentHome(), ".aios", "state", "chat-agents", id, "status.json");
const defaultQueuePath = (id: string) => joinPath(agentHome(), ".aios", "state", "chat-agents", id, "queue.json");
const defaultStdoutPath = (id: string) => joinPath(agentHome(), ".aios", "logs", "chat-agents", `${id}-out.log`);
const defaultStderrPath = (id: string) => joinPath(agentHome(), ".aios", "logs", "chat-agents", `${id}-err.log`);

const customAgentsKey = "aios.chatAgents.custom";
const lastScheduledRunKey = (id: string) => `aios.chatAgents.lastScheduledRun:${id}`;

/** Legacy catalog — intentionally empty. The shell ships with no agents; only
 *  the fleets users create exist. (Kept as an export for type/id lookups.) */
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
    const raw = readStoredAgents();
    return raw.reduce<ScheduledAgentConfig[]>((agents, agent) => {
        const id = normalizeAgentId(String(agent.id || agent.label || ""));
        if (!id || !agent.label) return agents;
        const label = String(agent.label).trim();
        const mission = String(agent.mission || "custom aios chatpane agent").trim();
        agents.push({
          id,
          label,
          shortLabel: String(agent.shortLabel || id).trim(),
          launchdLabel: `aios.chatpane.${id}`,
          statePath: cleanseStored(agent.statePath) ?? defaultStatePath(id),
          queuePath: cleanseStored(agent.queuePath) ?? defaultQueuePath(id),
          stdoutPath: cleanseStored(agent.stdoutPath) ?? defaultStdoutPath(id),
          stderrPath: cleanseStored(agent.stderrPath) ?? defaultStderrPath(id),
          cwd: cleanseStored(agent.cwd) ?? agentHome(),
          mission,
          schedule: String(agent.schedule || "manual").trim(),
        });
        return agents;
      }, []);
  } catch {
    return [];
  }
}

export function loadConfiguredScheduledAgents(): ScheduledAgentConfig[] {
  // Default: NO agents. The shell ships with an empty sidebar — only agents the
  // user explicitly creates show up. `SCHEDULED_AGENTS` stays as a catalog of known
  // ids (for seed/role lookups), but is no longer auto-populated.
  const seen = new Set<string>();
  return loadCustomScheduledAgents().filter((agent) => {
    if (seen.has(agent.id)) return false;
    seen.add(agent.id);
    return true;
  });
}

/** Removes a user-created agent and its persisted chat session / schedule state.
 *  Built-in catalog agents (SCHEDULED_AGENTS) aren't shown by default, so this only
 *  ever needs to drop a custom agent. No-op if the id isn't a custom agent. */
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
    launchdLabel: `aios.chatpane.${id}`,
    statePath: defaultStatePath(id),
    queuePath: defaultQueuePath(id),
    stdoutPath: defaultStdoutPath(id),
    stderrPath: defaultStderrPath(id),
    cwd: input.cwd?.trim() || agentHome(),
    mission: input.mission?.trim() || "custom aios chatpane agent",
    schedule: input.schedule?.trim() || "manual",
  };
  // Persist only the user's inputs — derived paths re-resolve at load so they
  // always track the runtime home, never a frozen snapshot.
  const stored: Partial<ScheduledAgentConfig> = {
    id,
    label,
    mission: agent.mission,
    schedule: agent.schedule,
    ...(input.cwd?.trim() ? { cwd: input.cwd.trim() } : {}),
  };
  const next = [...readStoredAgents(), stored];
  localStorage.setItem(customAgentsKey, JSON.stringify(next));
  return agent;
}

export function scheduledAgentById(id: string): ScheduledAgentConfig | undefined {
  return loadConfiguredScheduledAgents().find((agent) => agent.id === id);
}

const agentChatSessionKey = (id: string) => `aios.scheduledAgent.chatSession:${id}`;

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
 *  phrasings the old inline scheduler accepted ("always" → 6h, "work block" →
 *  daily, any "…hour…" → hourly). "manual"/empty/unknown returns null = the
 *  scheduler never fires it. */
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

/** True when an agent's cadence says it should pulse now. A never-stamped
 *  agent with a cadence is due immediately (the user asked for autonomy —
 *  the first pulse starts the clock). */
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
    `- state file: ${agent.statePath}`,
    `- queue file: ${agent.queuePath}`,
    "",
    "operating rules:",
    "- act like a live goal-moving operator, not a logger.",
    "- start by inspecting current state, queue, recent outputs, and repo context before proposing work.",
    "- do not ask the user to continue, approve, or tell you what to do next inside this agent chat.",
    "- treat this chat as an ordered execution log for the aios shell to monitor and control.",
    "- continue autonomously inside your policy limits; when blocked, write a concise pending approval item instead of asking a question.",
    "- report concrete next actions, current blockers, and what moves the goal.",
    "- do not execute irreversible external actions. produce concrete next steps, artifacts, observable run state, and pending approval items for the shell control plane.",
    "- if work needs background execution, create/steer the right local process and report exactly where it is observable.",
    "",
    "first task:",
    "load your current state, take the next useful action, and leave an ordered status entry for the shell control plane.",
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
    "- inspect your current state, queue, prior outputs, and relevant local context.",
    "- choose the single highest-leverage action for today.",
    "- produce the artifact or draft inside this chatpane.",
    "- do not ask the user what to do next.",
    "- if approval is needed, write a pending approval item for the shell control plane.",
    "- report blocker, next step, and the control decision needed.",
  ].join("\n");
}

function queueCount(queue: ScheduledAgentRawState["queue"]): number {
  if (Array.isArray(queue)) return queue.length;
  if (queue && typeof queue === "object") {
    const values = Object.values(queue);
    const firstArray = values.find(Array.isArray);
    if (Array.isArray(firstArray)) return firstArray.length;
  }
  return 0;
}

export function summarizeScheduledAgentState(
  agent: ScheduledAgentConfig,
  raw: ScheduledAgentRawState,
): ScheduledAgentSummary {
  const status = raw.status ?? {};
  const launchd = raw.launchd;
  const queued = typeof status.queued === "number" ? status.queued : queueCount(raw.queue);
  const dryRun = Boolean(status.dryRun ?? status.mode === "dry-run");
  const next = status.next ?? status.agents?.["social-media-agent"]?.next;
  const nextName = next?.name ?? next?.id ?? next?.route ?? "";

  let health: ScheduledAgentHealth = "unknown";
  if (launchd?.lastExit && launchd.lastExit !== 0) health = "failed";
  else if (launchd?.running) health = dryRun ? "needs-steer" : "running";
  else if (launchd && launchd.lastExit === 0) health = "scheduled";
  else if (status.ok === true) health = dryRun ? "needs-steer" : "running";

  return {
    id: agent.id,
    label: agent.label,
    health,
    primaryMetric: `${queued} queued`,
    currentJob: nextName || "no active job",
    nextAction: dryRun
      ? "review the pending draft before approving"
      : "open the agent chat to steer",
    schedule: agent.schedule || "manual",
    lastRunAt: loadScheduledAgentLastScheduledRun(agent.id),
  };
}

async function readJson(path: string): Promise<any | null> {
  try {
    const { readTextFile } = await import("./fs");
    return JSON.parse(await readTextFile(path));
  } catch {
    return null;
  }
}

export async function loadScheduledAgentSummaries(): Promise<ScheduledAgentSummary[]> {
  await ensureScheduledAgentHome();
  const rows = await Promise.all(
    loadConfiguredScheduledAgents().map(async (agent) => {
      const [status, queue] = await Promise.all([
        readJson(agent.statePath),
        readJson(agent.queuePath),
      ]);
      return summarizeScheduledAgentState(agent, { status, queue });
    }),
  );
  return rows;
}

async function tailText(path: string, maxLines = 28): Promise<string[]> {
  try {
    const { readTextFile } = await import("./fs");
    return (await readTextFile(path)).split(/\r?\n/).filter(Boolean).slice(-maxLines);
  } catch {
    return [];
  }
}

export async function loadScheduledAgentDetails(): Promise<ScheduledAgentDetail[]> {
  await ensureScheduledAgentHome();
  return Promise.all(
    loadConfiguredScheduledAgents().map(async (agent) => {
      const [status, queue, stdout, stderr] = await Promise.all([
        readJson(agent.statePath),
        readJson(agent.queuePath),
        tailText(agent.stdoutPath, 18),
        tailText(agent.stderrPath, 10),
      ]);
      return {
        ...summarizeScheduledAgentState(agent, { status, queue }),
        mission: agent.mission,
        schedule: agent.schedule || "manual",
        stdoutPath: agent.stdoutPath,
        stderrPath: agent.stderrPath,
        statePath: agent.statePath,
        queuePath: agent.queuePath,
        logTail: [...stdout, ...stderr].slice(-28),
      };
    }),
  );
}
