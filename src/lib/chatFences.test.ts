// @ts-nocheck -- executed directly by node's test runner, outside the browser app.
import assert from "node:assert/strict";
import test from "node:test";

import { splitFences } from "./chatFences.ts";

const codes = (t: string) => splitFences(t).filter((s) => s.code);

test("prose that mentions ```lang inline mid-sentence is NOT a code block", () => {
  const text = "A `/dbml` entry inserts a starter ```dbml block into the doc.";
  const segs = splitFences(text);
  assert.deepEqual(segs, [{ code: false, body: text }]);
});

test("two inline ```lang mentions do not pair into a swallowing block (the bug)", () => {
  const text = [
    "do you want inline diagrams (fenced ```dbml / ```excalidraw)",
    "as the priority, or whole-document diagrams like your ```mmd flow?",
  ].join("\n");
  // regression: the old match-anywhere regex turned the span between the first
  // and second ``` into a "dbml" code block, eating the prose in between.
  assert.equal(codes(text).length, 0);
  assert.equal(splitFences(text).length, 1);
});

test("a real line-start fence still renders as a code block", () => {
  const text = "before\n```python\nprint('hi')\n```\nafter";
  const segs = splitFences(text);
  assert.deepEqual(segs, [
    { code: false, body: "before" },
    { code: true, lang: "python", body: "print('hi')" },
    { code: false, body: "after" },
  ]);
});

test("fence language is trimmed; empty language allowed", () => {
  assert.deepEqual(splitFences("```\nx\n```"), [{ code: true, lang: "", body: "x" }]);
  assert.deepEqual(splitFences("```  ts \nx\n```"), [{ code: true, lang: "ts", body: "x" }]);
});

test("an unclosed fence (mid-stream) renders the remainder as an open block", () => {
  const text = "intro\n```js\nconst a = 1;\nconst b = 2;";
  const segs = splitFences(text);
  assert.deepEqual(segs, [
    { code: false, body: "intro" },
    { code: true, lang: "js", body: "const a = 1;\nconst b = 2;" },
  ]);
});

test("an opener line whose info string contains a backtick is not a fence", () => {
  // "```dbml / ```excalidraw" alone on a line: info string has backticks → prose.
  const text = "```dbml / ```excalidraw";
  assert.deepEqual(splitFences(text), [{ code: false, body: text }]);
});

test("indented fences open and close; closing fence needs matching length", () => {
  const text = "  ```js\n  code\n  ```";
  assert.deepEqual(splitFences(text), [{ code: true, lang: "js", body: "  code" }]);
  // a shorter run of backticks does not close a longer opening fence
  const text2 = "````\ninner ```\n````";
  assert.deepEqual(splitFences(text2), [{ code: true, lang: "", body: "inner ```" }]);
});

test("multiple real fences are each captured with the prose between them", () => {
  const text = "```a\n1\n```\nmid\n```b\n2\n```";
  const segs = splitFences(text);
  assert.deepEqual(segs, [
    { code: true, lang: "a", body: "1" },
    { code: false, body: "mid" },
    { code: true, lang: "b", body: "2" },
  ]);
});
