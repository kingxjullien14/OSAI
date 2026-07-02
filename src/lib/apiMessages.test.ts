// @ts-nocheck -- executed directly by node's test runner, outside the browser app.
import assert from "node:assert/strict";
import test from "node:test";

import { turnsToApiMessages, messagesUpToLastUser } from "./apiMessages.ts";

const U = (text) => ({ kind: "user", id: Math.random().toString(36), text });
const A = (text) => ({ kind: "assistant", id: Math.random().toString(36), text, streaming: false });
const R = () => ({ kind: "result", id: Math.random().toString(36), text: "3s · 10 tok" });

test("turnsToApiMessages keeps user/assistant text, drops the rest + empties", () => {
  const turns = [U("hi"), { kind: "thinking", id: "t", text: "hmm" }, A("yo"), R(), A("  ")];
  assert.deepEqual(turnsToApiMessages(turns), [
    { role: "user", content: "hi" },
    { role: "assistant", content: "yo" },
  ]);
});

test("messagesUpToLastUser drops the trailing answer (regenerate re-send)", () => {
  // u1 → a1 → u2 → a2  ⇒ regenerating a2 re-sends [u1,a1,u2]
  const turns = [U("u1"), A("a1"), U("u2"), A("a2"), R()];
  assert.deepEqual(messagesUpToLastUser(turns), [
    { role: "user", content: "u1" },
    { role: "assistant", content: "a1" },
    { role: "user", content: "u2" },
  ]);
});

test("messagesUpToLastUser on a single prompt = just that prompt", () => {
  assert.deepEqual(messagesUpToLastUser([U("only"), A("answer"), R()]), [
    { role: "user", content: "only" },
  ]);
  assert.deepEqual(messagesUpToLastUser([]), []);
});
