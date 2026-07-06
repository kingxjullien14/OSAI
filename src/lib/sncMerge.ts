/** Line-based three-way merge — decision D6 of the Notes × S&C epic
 *  (misc/PLAN-notes-stone-chisel.md).
 *
 *  When a save 409s, the pane holds three texts: BASE (the last server copy
 *  this edit was based on), OURS (the local draft), THEIRS (the live server
 *  row from the 409 body). diff3Merge combines them the way git's diff3
 *  does: regions only one side touched take that side; regions both touched
 *  identically take either; regions both touched differently become a
 *  conflict block with git-style markers. Pure — no tauri import — so the
 *  node:test suite exercises it directly. */

export const MARK_OURS = "<<<<<<< this device";
export const MARK_SEP = "=======";
export const MARK_THEIRS = ">>>>>>> other device";

export type MergeResult =
  | { clean: true; text: string }
  | { clean: false; text: string; conflicts: number };

/** True when a draft still carries unresolved conflict markers. */
export function hasConflictMarkers(text: string): boolean {
  return /^<{7} /m.test(text) && /^>{7} /m.test(text);
}

/** LCS alignment between `a` and `b`: monotonically increasing matched index
 *  pairs. Common prefix/suffix are peeled first so the DP only sees the
 *  changed middle; a pathological middle (>25M cells) skips interior anchors
 *  rather than freezing the pane — the merge then degrades to one big
 *  conflict, never a wrong answer. */
function align(a: string[], b: string[]): Array<[number, number]> {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let endA = a.length;
  let endB = b.length;
  while (endA > pre && endB > pre && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < pre; i++) pairs.push([i, i]);

  const n = endA - pre;
  const m = endB - pre;
  if (n > 0 && m > 0 && n * m <= 25_000_000) {
    const width = m + 1;
    const dp = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      const ai = a[pre + i];
      for (let j = m - 1; j >= 0; j--) {
        dp[i * width + j] =
          ai === b[pre + j]
            ? dp[(i + 1) * width + j + 1] + 1
            : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[pre + i] === b[pre + j]) {
        pairs.push([pre + i, pre + j]);
        i++;
        j++;
      } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
        i++;
      } else {
        j++;
      }
    }
  }

  const tail = a.length - endA; // === b.length - endB by construction
  for (let t = 0; t < tail; t++) pairs.push([endA + t, endB + t]);
  return pairs;
}

function eq(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function diff3Merge(base: string, ours: string, theirs: string): MergeResult {
  // fast paths: no real divergence
  if (ours === theirs) return { clean: true, text: ours };
  if (base === ours) return { clean: true, text: theirs };
  if (base === theirs) return { clean: true, text: ours };

  const B = base.split("\n");
  const O = ours.split("\n");
  const T = theirs.split("\n");
  const oMatch = new Map(align(B, O));
  const tMatch = new Map(align(B, T));

  const out: string[] = [];
  let conflicts = 0;
  let bi = 0;
  let oi = 0;
  let ti = 0;

  for (;;) {
    // next ANCHOR: a base line both sides kept, at/after every cursor
    let anchor = -1;
    let anchorO = -1;
    let anchorT = -1;
    for (let k = bi; k < B.length; k++) {
      const om = oMatch.get(k);
      const tm = tMatch.get(k);
      if (om !== undefined && tm !== undefined && om >= oi && tm >= ti) {
        anchor = k;
        anchorO = om;
        anchorT = tm;
        break;
      }
    }

    const bEnd = anchor === -1 ? B.length : anchor;
    const oEnd = anchor === -1 ? O.length : anchorO;
    const tEnd = anchor === -1 ? T.length : anchorT;
    const bChunk = B.slice(bi, bEnd);
    const oChunk = O.slice(oi, oEnd);
    const tChunk = T.slice(ti, tEnd);

    const oursSame = eq(bChunk, oChunk);
    const theirsSame = eq(bChunk, tChunk);
    if (oursSame && theirsSame) {
      out.push(...bChunk);
    } else if (oursSame) {
      out.push(...tChunk); // only they touched it
    } else if (theirsSame) {
      out.push(...oChunk); // only we touched it
    } else if (eq(oChunk, tChunk)) {
      out.push(...oChunk); // both made the identical change
    } else {
      conflicts++;
      out.push(MARK_OURS, ...oChunk, MARK_SEP, ...tChunk, MARK_THEIRS);
    }

    if (anchor === -1) break;
    out.push(B[anchor]);
    bi = anchor + 1;
    oi = anchorO + 1;
    ti = anchorT + 1;
  }

  const text = out.join("\n");
  return conflicts > 0 ? { clean: false, text, conflicts } : { clean: true, text };
}
