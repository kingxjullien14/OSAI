// @ts-nocheck -- executed directly by node's test runner, outside the browser app.
import assert from "node:assert/strict";
import test from "node:test";

import { cleanSessionLabel } from "./sessionLabel.ts";

test("strips claude-code local-command XML down to the command name", () => {
  assert.equal(
    cleanSessionLabel(
      "<command-name>/usage</command-name> <command-message>usage</command-message>",
    ),
    "/usage",
  );
});

test("drops command args/stdout wrappers and collapses whitespace", () => {
  assert.equal(
    cleanSessionLabel(
      "<command-name>/model</command-name>  <command-args>opus</command-args>\n<local-command-stdout>Set model to opus</local-command-stdout>",
    ),
    "/model",
  );
});

test("tolerates truncated trailing tags (preview cut mid-wrapper)", () => {
  // the store truncates previews — a half-open tag must not leak raw XML
  assert.equal(
    cleanSessionLabel("<command-name>/usage</command-name> <command-message>usage</command-me"),
    "/usage usage",
  );
});

test("leaves ordinary titles untouched (fast path, no angle brackets)", () => {
  assert.equal(cleanSessionLabel("fix the drag and drop"), "fix the drag and drop");
  assert.equal(cleanSessionLabel("compare a < b output"), "compare a < b output");
});
