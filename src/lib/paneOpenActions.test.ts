// @ts-nocheck -- executed directly by node's test runner, outside the browser app.
import test from "node:test";
import assert from "node:assert/strict";

import { containingDir, paneFileTarget } from "./paneOpenActions.ts";

test("paneFileTarget returns file path and display name for file-backed panes", () => {
  assert.deepEqual(
    paneFileTarget({ type: "editor", path: "/tmp/report.md", name: "report.md" }),
    { path: "/tmp/report.md", name: "report.md" },
  );
  assert.deepEqual(
    paneFileTarget({ type: "file", path: "/tmp/screenshot.png" }),
    { path: "/tmp/screenshot.png", name: "screenshot.png" },
  );
  assert.equal(paneFileTarget({ type: "shell", cwd: "/tmp" }), null);
});

test("containingDir returns the parent directory for reveal-in-files actions", () => {
  assert.equal(containingDir("/Users/aios/report.md"), "/Users/aios");
  assert.equal(containingDir("/report.md"), "/");
  assert.equal(containingDir("C:\\Users\\kingx\\report.md"), "C:\\Users\\kingx");
  assert.equal(containingDir("C:\\report.md"), "C:\\");
});
