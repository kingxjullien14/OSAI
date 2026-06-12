/**
 * Soundscape — whisper-quiet synthesized audio cues (no assets, pure
 * WebAudio oscillators). DEFAULT OFF; gated on the `soundscape` setting at
 * every call so flipping the toggle applies instantly, no listener wiring.
 *
 * One shared AudioContext, created lazily on the first enabled cue. The
 * webview may start it suspended until a user gesture — every play attempts
 * a resume, and chat activity always follows a gesture, so cues just work.
 */
import { loadSettings } from "./settings";

export type SoundCue = "done" | "fail";

let ctx: AudioContext | null = null;

function ensureCtx(): AudioContext | null {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null; // no audio device / denied — soundscape silently no-ops
  }
}

/** Tiny melodies, as {freq, start-offset, duration} notes. Kept gentle and
 *  SHORT — a finished run earns a soft major step up, a failure a low sigh. */
const CUES: Record<SoundCue, Array<{ f: number; t: number; d: number }>> = {
  done: [
    { f: 659.25, t: 0, d: 0.09 }, // E5
    { f: 880.0, t: 0.1, d: 0.14 }, // A5
  ],
  fail: [
    { f: 233.08, t: 0, d: 0.14 }, // Bb3
    { f: 185.0, t: 0.13, d: 0.22 }, // F#3
  ],
};

export function playCue(cue: SoundCue): void {
  if (!loadSettings().soundscape) return;
  const ac = ensureCtx();
  if (!ac) return;
  const t0 = ac.currentTime;
  for (const note of CUES[cue]) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = note.f;
    // whisper-quiet envelope: fast attack, exponential tail — no clicks.
    gain.gain.setValueAtTime(0.0001, t0 + note.t);
    gain.gain.linearRampToValueAtTime(0.045, t0 + note.t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0008, t0 + note.t + note.d);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0 + note.t);
    osc.stop(t0 + note.t + note.d + 0.05);
  }
}
