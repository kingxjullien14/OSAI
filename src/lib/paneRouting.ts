import { basename as pathBasename, dirname as pathDirname, isAbsolutePath, normalizeSlashes } from "./paths.ts";

const FILE_SCHEME = /^file:\/\//i;
const HTTP_SCHEME = /^https?:\/\//i;
const LINE_SUFFIX = /:\d+(?::\d+)?$/;
const HASH_SUFFIX = /#[^/]*$/;

const RELATIVE_ROOTS = /^(docs|src|src-tauri|scripts|tests?|lib|app|public|assets|config|\.agents|\.codex)[\\/]/;
const FILEISH_SEGMENT = /(^|[\\/])[^\\/\s]+\.[a-z0-9]{1,12}$/i;

export function isHttpPaneTarget(target: string): boolean {
  return HTTP_SCHEME.test(target.trim());
}

export function normalizePaneFileTarget(target: string): string {
  let s = target.trim();
  if ((s.startsWith("<") && s.endsWith(">")) || (s.startsWith('"') && s.endsWith('"'))) {
    s = s.slice(1, -1).trim();
  }
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith("`") && s.endsWith("`"))) {
    s = s.slice(1, -1).trim();
  }
  s = s.replace(HASH_SUFFIX, "");
  if (FILE_SCHEME.test(s)) {
    try {
      s = decodeURIComponent(new URL(s).pathname);
      // Windows file URLs decode to "/C:/x" — drop the artificial lead slash.
      if (/^\/[A-Za-z]:[\\/]/.test(s)) s = s.slice(1);
    } catch {
      s = s.replace(FILE_SCHEME, "");
    }
  }
  // A drive-letter path's ":<line>" suffix is real (C:\x\y.ts:12), but the
  // bare "C:" prefix must survive the strip.
  return s.replace(LINE_SUFFIX, "") || s;
}

export function isPaneFileTarget(target: string): boolean {
  const s = normalizePaneFileTarget(target);
  if (!s) return false;
  // Absolute paths may legitimately contain spaces ("C:\Users\My Name\…");
  // for relative heuristics whitespace still disqualifies — too noisy.
  if (isAbsolutePath(s)) return !/[\r\n\t]/.test(s);
  if (/\s/.test(s)) return false;
  return (
    s.startsWith("./") ||
    s.startsWith("../") ||
    s.startsWith(".\\") ||
    s.startsWith("..\\") ||
    RELATIVE_ROOTS.test(s) ||
    FILEISH_SEGMENT.test(s)
  );
}

function normalizePosix(path: string): string {
  const absolute = path.startsWith("/");
  const drive = path.match(/^([A-Za-z]:)\//);
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  if (drive) return parts.join("/");
  return `${absolute ? "/" : ""}${parts.join("/")}`;
}

export function resolvePaneFileTarget(target: string, baseFilePath?: string): string {
  const s = normalizePaneFileTarget(target);
  if (!baseFilePath || isAbsolutePath(s)) return s;
  const relative = s.startsWith("./") || s.startsWith("../") || s.startsWith(".\\") || s.startsWith("..\\");
  if (!relative) return s;
  const base = normalizeSlashes(pathDirname(baseFilePath));
  return normalizePosix(`${base}/${normalizeSlashes(s)}`);
}

export function targetLabel(target: string): string {
  const s = normalizePaneFileTarget(target);
  return pathBasename(s) || s || "file";
}
