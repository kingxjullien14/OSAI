/** Pet soul persistence + migration (P0's I/O half — the engine stays pure).
 *
 *  MIGRATION PROMISE (plan): nobody's pet dies. An install that already has a
 *  pet identity (`aios.pet.variant.v2` / v1 from the current PetPane) but no
 *  soul yet gets a soul born A WEEK AGO with a warmed-up bond — the companion
 *  that's been on the dashboard all along "remembers you", instead of
 *  resetting to a stranger hatchling. */

import { createSoul, parseSoul, type PetSoul } from "./engine";

const SOUL_KEY = "aios.pet.soul.v1";
const VARIANT_KEYS = ["aios.pet.variant.v2", "aios.pet.variant.v1"];

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
  listeners.forEach((fn) => fn(soul));
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

const NAME_KEY = "aios.pet.name.v1";

export function loadPetName(): string {
  try {
    return (localStorage.getItem(NAME_KEY) ?? "").trim();
  } catch {
    return "";
  }
}

export function savePetName(name: string): void {
  try {
    const trimmed = name.trim().slice(0, 24);
    if (trimmed) localStorage.setItem(NAME_KEY, trimmed);
    else localStorage.removeItem(NAME_KEY);
  } catch {
    /* unavailable — the room keeps its in-state copy */
  }
}
