/** Separator-agnostic path helpers.
 *
 * The Rust backend emits OS-native paths (backslashes on Windows), while most
 * of the UI was written against POSIX strings. Everything here tolerates both
 * `/` and `\` so the same component code works on either platform. Use these
 * instead of hand-rolled `split("/")` — that pattern is the root cause of the
 * Windows breakage catalogued in audit-synthesis.json.
 */

const TRAILING_SEPS = /[\\/]+$/;
const ANY_SEP = /[\\/]/;

/** Last path segment: `C:\a\b.txt` → `b.txt`, `/a/b/` → `b`. */
export function basename(path: string): string {
  const clean = path.replace(TRAILING_SEPS, "");
  return clean.split(ANY_SEP).filter(Boolean).pop() ?? (clean || path);
}

/** Parent directory, preserving the input's separator style.
 * Drive roots stay themselves (`C:\` → `C:\`), POSIX root stays `/`,
 * a bare segment returns itself (no parent to ascend to). */
export function dirname(path: string): string {
  const clean = path.replace(TRAILING_SEPS, "");
  if (/^[A-Za-z]:$/.test(clean)) return clean + "\\";
  if (!clean) return path.startsWith("/") ? "/" : path;
  const idx = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  if (idx < 0) return clean;
  if (idx === 0) return clean[0] === "/" ? "/" : clean;
  const head = clean.slice(0, idx);
  if (/^[A-Za-z]:$/.test(head)) return head + clean[idx];
  return head;
}

/** Forward-slash form, for URLs and separator-insensitive comparisons. */
export function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, "/");
}

/** Absolute on either platform: `/x`, `~/x`, `C:\x`, `C:/x`, `\\server\share`. */
export function isAbsolutePath(path: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/|~[\\/])/.test(path);
}

/** Join segments onto a base, matching the base's separator style. */
export function joinPath(base: string, ...parts: string[]): string {
  const sep = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  let out = base.replace(TRAILING_SEPS, "");
  if (!out && base.startsWith("/")) out = "";
  for (const part of parts) {
    const seg = part.replace(/^[\\/]+/, "").replace(TRAILING_SEPS, "");
    if (seg) out += sep + seg;
  }
  return out || base;
}

/** True when two paths refer to the same location modulo separators and a
 * trailing separator. (Case-sensitive: the backend emits consistent casing.) */
export function samePath(a: string, b: string): boolean {
  return (
    normalizeSlashes(a).replace(/\/+$/, "") ===
    normalizeSlashes(b).replace(/\/+$/, "")
  );
}

/** `file://` URL for a local path, correct for both POSIX and Windows. */
export function toFileUrl(path: string): string {
  const fwd = normalizeSlashes(path);
  const prefixed = fwd.startsWith("/") ? fwd : `/${fwd}`;
  return `file://${encodeURI(prefixed).replace(/#/g, "%23").replace(/\?/g, "%3F")}`;
}
