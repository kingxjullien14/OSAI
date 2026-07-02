/**
 * Minimal line-level diff (LCS) for the inline Edit/MultiEdit change cards (P4).
 *
 * The old `DiffBlock` printed every old line (red) then every new line (green),
 * which reads terribly for a small edit inside a big block. This interleaves
 * unchanged context with removed/added lines like a real unified diff.
 *
 * Bounded: a very large pair falls back to remove-all / add-all so a huge paste
 * can't blow up the O(m·n) LCS table.
 */
export type DiffLineKind = "context" | "add" | "del";

/** A word-level segment of a refined del/add line. `changed` tokens get the
 *  brighter highlight; the rest stays the lighter whole-line tint (2-tone). */
export interface WordSeg {
  text: string;
  changed: boolean;
}

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  /** Present on del/add lines that form a 1:1 replace pair — drives the
   *  word-level highlight. Absent → treat the whole line as the change. */
  segments?: WordSeg[];
}

/** ~500×500 lines — above this we skip the LCS and just show del-all/add-all. */
const LCS_CELL_CAP = 250_000;

export function lineDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const m = a.length;
  const n = b.length;
  if (m * n > LCS_CELL_CAP) {
    return [
      ...a.map((text): DiffLine => ({ kind: "del", text })),
      ...b.map((text): DiffLine => ({ kind: "add", text })),
    ];
  }
  // dp[i][j] = length of the longest common subsequence of a[i:] and b[j:]
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ kind: "context", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: "del", text: a[i] });
      i++;
    } else {
      out.push({ kind: "add", text: b[j] });
      j++;
    }
  }
  while (i < m) out.push({ kind: "del", text: a[i++] });
  while (j < n) out.push({ kind: "add", text: b[j++] });
  return out;
}

/** +adds / −dels counts for the change-card stat line. */
export function diffStat(lines: DiffLine[]): { adds: number; dels: number } {
  let adds = 0;
  let dels = 0;
  for (const l of lines) {
    if (l.kind === "add") adds++;
    else if (l.kind === "del") dels++;
  }
  return { adds, dels };
}

/** Tokenize a line for word-level diffing: whitespace runs, identifier runs, and
 *  punctuation runs are each their own token (so `DIFF_CAP = 14` → changing 14
 *  highlights just `14`, not the whole line). */
function tokenize(line: string): string[] {
  return line.match(/\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_]+/g) ?? [];
}

/** Word-level diff of two lines → the tokens that changed on each side, merged
 *  into contiguous segments. Used to refine a 1:1 replace pair. */
export function wordDiff(
  oldLine: string,
  newLine: string,
): { old: WordSeg[]; new: WordSeg[] } {
  const a = tokenize(oldLine);
  const b = tokenize(newLine);
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const oldSeg: WordSeg[] = [];
  const newSeg: WordSeg[] = [];
  const push = (arr: WordSeg[], text: string, changed: boolean) => {
    const last = arr[arr.length - 1];
    if (last && last.changed === changed) last.text += text;
    else arr.push({ text, changed });
  };
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      push(oldSeg, a[i], false);
      push(newSeg, b[j], false);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push(oldSeg, a[i], true);
      i++;
    } else {
      push(newSeg, b[j], true);
      j++;
    }
  }
  while (i < m) push(oldSeg, a[i++], true);
  while (j < n) push(newSeg, b[j++], true);
  return { old: oldSeg, new: newSeg };
}

/** Adds word-level `segments` to del/add lines that form a 1:1 replace pair (a
 *  maximal del run immediately followed by an add run, paired by index). Lines
 *  that share no tokens are left plain (a full rewrite → just the line tint). */
export function refineDiff(lines: DiffLine[]): DiffLine[] {
  const out = lines.map((l) => ({ ...l }));
  let i = 0;
  while (i < out.length) {
    if (out[i].kind !== "del") {
      i++;
      continue;
    }
    let d = i;
    while (d < out.length && out[d].kind === "del") d++;
    let a = d;
    while (a < out.length && out[a].kind === "add") a++;
    const pairs = Math.min(d - i, a - d);
    for (let k = 0; k < pairs; k++) {
      const del = out[i + k];
      const add = out[d + k];
      const w = wordDiff(del.text, add.text);
      // only refine when there's shared content — else everything would light up
      if (w.old.some((s) => !s.changed) || w.new.some((s) => !s.changed)) {
        del.segments = w.old;
        add.segments = w.new;
      }
    }
    i = a > i ? a : i + 1;
  }
  return out;
}
