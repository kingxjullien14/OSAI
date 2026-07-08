/** Pet soul persistence + migration (P0's I/O half — the engine stays pure).
 *
 *  MIGRATION PROMISE (plan): nobody's pet dies. An install that already has a
 *  pet identity (`osai.pet.variant.v2` / v1 from the current PetPane) but no
 *  soul yet gets a soul born A WEEK AGO with a warmed-up bond — the companion
 *  that's been on the dashboard all along "remembers you", instead of
 *  resetting to a stranger hatchling. */

import { createSoul, parseSoul, type PetSoul } from "./engine";
import { scheduleUiMirrorSave } from "../uiMirror";

const SOUL_KEY = "osai.pet.soul.v1";
const VARIANT_KEYS = ["osai.pet.variant.v2", "osai.pet.variant.v1"];

const DAY = 24 * 3_600_000;

let cache: PetSoul | null = null;
const listeners = new Set<(soul: PetSoul) => void>();

function hasLegacyPet(): boolean {
  try {
    return VARIANT_KEYS.some((k) => Boolean(localStorage.getItem(k)));
  } catch {
    return false;
  }
}

export function loadSoul(now = Date.now()): PetSoul {
  if (cache) return cache;
  try {
    const revived = parseSoul(JSON.parse(localStorage.getItem(SOUL_KEY) || "null"));
    if (revived) {
      cache = revived;
      return revived;
    }
  } catch {
    /* corrupt → fall through to adoption */
  }
  const soul = hasLegacyPet()
    ? { ...createSoul(now, { bornAt: now - 7 * DAY }), bond: 20 }
    : createSoul(now);
  cache = soul;
  saveSoul(soul);
  return soul;
}

export function saveSoul(soul: PetSoul): void {
  cache = soul;
  try {
    localStorage.setItem(SOUL_KEY, JSON.stringify(soul));
  } catch {
    /* keep the in-memory soul */
  }
  // Write through to the durable disk mirror — the webview's localStorage isn't
  // durable across installed-app restarts, and the soul must survive a wipe.
  scheduleUiMirrorSave();
  listeners.forEach((fn) => fn(soul));
}

/** Reconcile the live soul against one recovered from the disk mirror at boot.
 *  The mirror wins only when it represents MORE progress — bond is monotonic, so
 *  a higher bond is strictly the more-real soul (tie broken by the newer tick).
 *  This repairs the boot race: a pane's synchronous loadSoul() during render can
 *  mint a fresh soul (localStorage was wiped) BEFORE the async mirror hydrate
 *  runs, so restore-if-missing isn't enough — we must overwrite the fresh soul
 *  with the mirrored one. A no-op when the mirror is absent, corrupt, or staler. */
export function reconcileSoulFromMirror(mirrorRaw: string | null | undefined): void {
  if (!mirrorRaw) return;
  let mirrored: PetSoul | null;
  try {
    mirrored = parseSoul(JSON.parse(mirrorRaw));
  } catch {
    return;
  }
  if (!mirrored) return;
  const current = loadSoul();
  const mirrorWins =
    mirrored.bond > current.bond ||
    (mirrored.bond === current.bond && mirrored.lastTick > current.lastTick);
  if (mirrorWins) saveSoul(mirrored);
}

/** Subscribe to soul changes (any writer). Returns an unsubscribe fn. */
export function subscribeSoul(fn: (soul: PetSoul) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// ── the name ─────────────────────────────────────────────────────────────────
// Kept OUTSIDE the soul so the pure engine's shape stays stable (parseSoul
// would strip it anyway). Empty string = unnamed.

const NAME_KEY = "osai.pet.name.v1";

export function loadPetName(): string {
  try {
    return (localStorage.getItem(NAME_KEY) ?? "").trim();
  } catch {
    return "";
  }
}

export function savePetName(name: string): void {
  try {
    // Store "" (not removeItem) when cleared: loadPetName treats "" as unnamed,
    // and an explicit "" lets the disk mirror's merge honor the clear instead of
    // resurrecting the old name from its last-seen fallback.
    localStorage.setItem(NAME_KEY, name.trim().slice(0, 24));
  } catch {
    /* unavailable — the room keeps its in-state copy */
  }
  scheduleUiMirrorSave();
}
