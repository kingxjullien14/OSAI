/**
 * Pet simulator: pure state + metrics + event bus.
 *
 * No images, no external assets, all visuals come from the companion
 * `PetPane.tsx` + CSS. The shell's chat session feeds this service with
 * usage signals so the face stays tied to AI behavior (usage, latency,
 * error rate, memory usage pressure).
 */

export type PetMood =
  | "happy"
  | "content"
  | "hungry"
  | "bloated"
  | "overloaded"
  | "tired"
  | "critical";

export interface PetState {
  health: number;
  hunger: number;
  bloat: number;
  stress: number;
  mood: PetMood;
  label: string;
  lastUpdated: number;
}

type PetActionInput = {
  textLength?: number;
  memoryCount?: number;
  imageCount?: number;
};

type PetResultInput = {
  tokens?: number;
  durationMs?: number;
  ok?: boolean;
};

type PetUsageInput = {
  provider?: string;
  pct?: number | null;
};

type Listener = (state: PetState) => void;

/** Momentary expression layered over the slow metabolic mood — the pet
 *  visibly REACTS to live activity (result ok → celebrate, error/failed →
 *  wince, user send → attentive). Visual layers subscribe and play ~1.5s. */
export type PetReaction = "celebrate" | "wince" | "attentive";
type ReactionListener = (reaction: PetReaction) => void;
const reactionListeners = new Set<ReactionListener>();

export function subscribePetReactions(listener: ReactionListener): () => void {
  reactionListeners.add(listener);
  return () => reactionListeners.delete(listener);
}

function react(reaction: PetReaction) {
  reactionListeners.forEach((l) => l(reaction));
}

/** Companion bubbles — an OCCASIONAL line of speech driven by real state
 *  (context draining, a failed run, a long clean finish). Hard per-kind
 *  cooldowns keep it charming; a chatty pet is Clippy. Visual layers
 *  (PetPane + the idle-home companion) subscribe and show ~7s. */
export interface PetBubble {
  id: number;
  text: string;
}
type BubbleListener = (b: PetBubble) => void;
const bubbleListeners = new Set<BubbleListener>();
export function subscribePetBubbles(listener: BubbleListener): () => void {
  bubbleListeners.add(listener);
  return () => bubbleListeners.delete(listener);
}
let bubbleSeq = 0;
const bubbleLastAt: Record<string, number> = {};
function maybeBubble(kind: string, text: string, cooldownMs: number) {
  const t = now();
  if (t - (bubbleLastAt[kind] ?? 0) < cooldownMs) return;
  bubbleLastAt[kind] = t;
  const bubble = { id: ++bubbleSeq, text };
  bubbleListeners.forEach((l) => l(bubble));
}

/** Confetti — the pet's ONE celebratory burst, fired from the idle companion
 *  tile on a long clean run. Rate-limited like bubbles so it's an event, not a
 *  habit; the visual layer (PetDashboardCompanion) gates it on the funFx
 *  setting + reduce-motion before drawing (W5-5). */
type ConfettiListener = () => void;
const confettiListeners = new Set<ConfettiListener>();
export function subscribePetConfetti(listener: ConfettiListener): () => void {
  confettiListeners.add(listener);
  return () => confettiListeners.delete(listener);
}
let confettiLastAt = 0;
function maybeConfetti(cooldownMs: number) {
  const t = now();
  if (t - confettiLastAt < cooldownMs) return;
  confettiLastAt = t;
  confettiListeners.forEach((l) => l());
}

const STORAGE_KEY = "osai.pet.state.v1";
const TICK_MS = 10000;

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const now = () => Date.now();

const baseMoodLabel: Record<PetMood, string> = {
  happy: "feeling alive",
  content: "processing calmly",
  hungry: "getting neglected",
  bloated: "bloated with memory",
  overloaded: "overloaded by bursts",
  tired: "winding down",
  critical: "critical instability",
};

const defaultState: PetState = {
  health: 82,
  hunger: 72,
  bloat: 18,
  stress: 18,
  mood: "content",
  label: baseMoodLabel.content,
  lastUpdated: now(),
};

const listeners = new Set<Listener>();
let state: PetState = loadState();
let tickRef: number | null = null;
let lastTick = now();

function persist(next: PetState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota/unavailable
  }
}

function loadState(): PetState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaultState };
    const parsed = JSON.parse(raw) as Partial<PetState>;
    if (!parsed || typeof parsed !== "object") return { ...defaultState };
    const seeded = {
      ...defaultState,
      ...parsed,
      health: clamp(Number(parsed.health) || defaultState.health),
      hunger: clamp(Number(parsed.hunger) || defaultState.hunger),
      bloat: clamp(Number(parsed.bloat) || defaultState.bloat),
      stress: clamp(Number(parsed.stress) || defaultState.stress),
      lastUpdated: Number(parsed.lastUpdated) || now(),
    } as PetState;
    return normalize(seeded);
  } catch {
    return { ...defaultState };
  }
}

function deriveMood(s: PetState): PetMood {
  if (s.health < 24) return "critical";
  if (s.bloat >= 78) return "bloated";
  if (s.stress >= 72 && s.hunger < 45) return "overloaded";
  if (s.hunger <= 26) return "hungry";
  if (s.stress >= 62 && s.bloat >= 58) return "overloaded";
  if (s.stress >= 60) return "tired";
  if (s.health >= 78 && s.hunger >= 64 && s.stress <= 34 && s.bloat <= 38) return "happy";
  return "content";
}

function normalize(input: PetState): PetState {
  const s = { ...input };
  s.health = clamp(s.health);
  s.hunger = clamp(s.hunger);
  s.bloat = clamp(s.bloat);
  s.stress = clamp(s.stress);
  s.mood = deriveMood(s);
  s.label = baseMoodLabel[s.mood];
  s.health = clamp(
    Math.round(
      (s.hunger * 0.45 +
        (100 - s.bloat) * 0.26 +
        (100 - s.stress) * 0.29 -
        (s.bloat >= 70 ? (s.bloat - 70) * 0.7 : 0) +
        (s.hunger >= 70 ? 6 : 0)) /
        1,
    ),
  );
  s.mood = deriveMood(s);
  s.label = baseMoodLabel[s.mood];
  s.lastUpdated = Number.isFinite(s.lastUpdated) ? s.lastUpdated : now();
  return s;
}

function notify(next: PetState) {
  const payload = normalize(next);
  state = payload;
  persist(payload);
  listeners.forEach((l) => l(payload));
}

function apply(fn: (s: PetState) => PetState) {
  notify(fn({ ...state }));
}

function startTicker() {
  if (tickRef !== null) return;
  lastTick = now();
  tickRef = window.setInterval(() => {
    const current = now();
    const dt = (current - lastTick) / 1000;
    lastTick = current;
    apply((s) => {
      const minutes = dt / 60;
      s.hunger = clamp(s.hunger - 1.2 * minutes);
      s.bloat = clamp(s.bloat - 0.8 * minutes);
      s.stress = clamp(s.stress - 0.5 * minutes);
      s.health = clamp(
        s.health -
          (s.hunger < 18 ? 1.4 * minutes : 0.0) -
          (s.bloat > 84 ? 1.0 * minutes : 0.0),
      );
      s.lastUpdated = current;
      return s;
    });
  }, TICK_MS);
}

function scoreFromTokens(tokens?: number): number {
  if (!Number.isFinite(tokens) || (tokens ?? 0) <= 0) return 0;
  const value = tokens ?? 0;
  const raw = Math.log10(value + 1) * 2.2;
  return clamp(Math.round(raw), 0, 28);
}

function decayByProvider(pct?: number | null) {
  if (pct == null) return 0;
  if (pct >= 95) return 14;
  if (pct >= 85) return 8;
  if (pct >= 75) return 3;
  return -1;
}

startTicker();

export function getPetState(): PetState {
  return normalize(state);
}

export function subscribePetState(listener: Listener): () => void {
  listeners.add(listener);
  listener(normalize(state));
  startTicker();
  return () => listeners.delete(listener);
}

export function resetPetState() {
  notify({ ...defaultState, lastUpdated: now() });
}

export function feedPet() {
  apply((s) => {
    s.hunger = clamp(s.hunger + 34);
    s.stress = clamp(s.stress - 9);
    s.health = clamp(s.health + 4);
    s.lastUpdated = now();
    return s;
  });
}

export function flushPet() {
  apply((s) => {
    s.bloat = clamp(s.bloat - 36, 0, 100);
    s.stress = clamp(s.stress - 6);
    s.health = clamp(s.health + 3);
    s.lastUpdated = now();
    return s;
  });
}

export function calmPet() {
  apply((s) => {
    s.stress = clamp(s.stress - 12);
    s.health = clamp(s.health + 2);
    s.lastUpdated = now();
    return s;
  });
}

export function onPetUserMessage(input: PetActionInput = {}) {
  startTicker();
  react("attentive");
  apply((s) => {
    const textLength = clamp(input.textLength ?? 0, 0, 5000);
    const memoryCount = clamp(input.memoryCount ?? 0, 0, 12);
    const imageCount = clamp(input.imageCount ?? 0, 0, 8);

    s.hunger = clamp(s.hunger + 14 + Math.min(10, Math.floor(textLength / 90)));
    s.stress = clamp(s.stress - 2 - Math.min(4, imageCount * 0.5));
    s.bloat = clamp(s.bloat + Math.min(12, memoryCount * 1.8));
    s.health = clamp(s.health + 1);
    s.lastUpdated = now();
    return s;
  });
}

export function onPetResult(input: PetResultInput = {}) {
  startTicker();
  react(input.ok === false ? "wince" : "celebrate");
  if (input.ok === false) {
    maybeBubble("wince", "ouch — that run failed", 10 * 60_000);
  } else if ((input.durationMs ?? 0) > 120_000) {
    maybeBubble("longrun", "that was a long one — clean finish", 20 * 60_000);
    maybeConfetti(20 * 60_000);
  }
  apply((s) => {
    const stressFromTokens = scoreFromTokens(input.tokens);
    const durationPenalty = Number.isFinite(input.durationMs ?? 0)
      ? clamp(Math.floor((input.durationMs as number) / 1000), 0, 10) / 1.8
      : 0;
    s.stress = clamp(s.stress + stressFromTokens + durationPenalty);
    s.bloat = clamp(s.bloat + clamp(Math.floor((input.tokens ?? 0) / 150), 0, 24));
    s.hunger = clamp(s.hunger - 5 - Math.min(8, durationPenalty));
    if (input.ok === false) {
      s.stress = clamp(s.stress + 23);
      s.health = clamp(s.health - 14);
    } else {
      s.health = clamp(s.health + 1);
    }
    s.lastUpdated = now();
    return s;
  });
}

export function onPetError(text?: string) {
  startTicker();
  react("wince");
  apply((s) => {
    s.stress = clamp(s.stress + (text ? 12 : 8));
    s.health = clamp(s.health - 5);
    s.lastUpdated = now();
    return s;
  });
}

export function onPetUsage(input: PetUsageInput = {}) {
  startTicker();
  const pct = input.pct == null ? null : Number(input.pct);
  if (pct == null || !Number.isFinite(pct)) return;
  // pct = consumed; ≥85% means the context window is running out
  if (pct >= 85) {
    maybeBubble("lowctx", "context is getting low — consider /handoff", 15 * 60_000);
  }
  apply((s) => {
    s.stress = clamp(s.stress + decayByProvider(pct));
    s.bloat = clamp(s.bloat + (pct >= 80 ? 1.1 : -0.3));
    s.lastUpdated = now();
    return s;
  });
}
