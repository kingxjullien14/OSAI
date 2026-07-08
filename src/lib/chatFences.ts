/** Fenced-code splitter for chat markdown (extracted from components/chat/Markdown
 *  so it's unit-testable without React). LINE-BASED per CommonMark: a fence only
 *  opens when 3+ backticks are the first non-whitespace on a line AND the info
 *  string (language) after them contains no backtick; it closes on a line that is
 *  only 3+ backticks + whitespace. This is load-bearing — a match-```-anywhere
 *  regex turned prose that merely MENTIONS fence syntax (e.g. "a ```dbml block",
 *  or "fenced ```dbml / ```excalidraw") into spurious code blocks by pairing up
 *  the inline triple-backticks and swallowing the prose between them. Tolerates an
 *  unclosed trailing fence (mid-stream) by treating the remainder as an open block. */
export type FenceSegment =
  | { code: true; lang: string; body: string }
  | { code: false; body: string };

export function splitFences(text: string): FenceSegment[] {
  const out: FenceSegment[] = [];
  const lines = text.split("\n");
  // opener: optional indent, 3+ backticks, then an info string with NO backtick.
  const OPEN = /^\s*(`{3,})([^`]*)$/;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push({ code: false, body: para.join("\n") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(OPEN);
    if (!m) {
      para.push(lines[i]);
      continue;
    }
    const fenceLen = m[1].length;
    const lang = m[2].trim();
    const isClose = (l: string) => {
      const c = l.match(/^\s*(`{3,})\s*$/);
      return !!c && c[1].length >= fenceLen;
    };
    const body: string[] = [];
    let j = i + 1;
    let closed = false;
    for (; j < lines.length; j++) {
      if (isClose(lines[j])) {
        closed = true;
        break;
      }
      body.push(lines[j]);
    }
    flushPara();
    out.push({ code: true, lang, body: body.join("\n") });
    // skip the closing fence; if unclosed (streaming), we've consumed to EOF.
    i = closed ? j : j - 1;
  }
  flushPara();
  return out;
}
