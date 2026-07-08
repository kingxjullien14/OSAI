// @ts-nocheck -- executed directly by node's test runner, outside the browser app.
import test from "node:test";
import assert from "node:assert/strict";

import {
  basename,
  dirname,
  isAbsolutePath,
  joinPath,
  normalizeSlashes,
  samePath,
  toFileUrl,
} from "./paths.ts";

test("basename handles both separator styles and trailing separators", () => {
  assert.equal(basename("/Users/osai/report.md"), "report.md");
  assert.equal(basename("C:\\Users\\kingx\\report.md"), "report.md");
  assert.equal(basename("C:/Users/kingx/report.md"), "report.md");
  assert.equal(basename("/Users/osai/dir/"), "dir");
  assert.equal(basename("C:\\Users\\kingx\\dir\\"), "dir");
  assert.equal(basename("report.md"), "report.md");
  assert.equal(basename("C:\\"), "C:");
});

test("dirname ascends one level and respects platform roots", () => {
  assert.equal(dirname("/Users/osai/report.md"), "/Users/osai");
  assert.equal(dirname("/report.md"), "/");
  assert.equal(dirname("C:\\Users\\kingx\\report.md"), "C:\\Users\\kingx");
  assert.equal(dirname("C:\\Users"), "C:\\");
  assert.equal(dirname("C:\\"), "C:\\");
  assert.equal(dirname("C:/Users/kingx"), "C:/Users");
  assert.equal(dirname("C:/Users"), "C:/");
  assert.equal(dirname("relative/file.ts"), "relative");
  assert.equal(dirname("file.ts"), "file.ts");
  assert.equal(dirname("\\\\server\\share\\file"), "\\\\server\\share");
});

test("isAbsolutePath accepts POSIX, drive, UNC and home-relative roots", () => {
  assert.ok(isAbsolutePath("/etc/hosts"));
  assert.ok(isAbsolutePath("~/notes.md"));
  assert.ok(isAbsolutePath("C:\\Users\\kingx"));
  assert.ok(isAbsolutePath("c:/repo"));
  assert.ok(isAbsolutePath("\\\\server\\share"));
  assert.ok(!isAbsolutePath("src/lib/paths.ts"));
  assert.ok(!isAbsolutePath("file.ts"));
});

test("joinPath matches the base separator style", () => {
  assert.equal(joinPath("C:\\Users\\kingx", "repo", "file.ts"), "C:\\Users\\kingx\\repo\\file.ts");
  assert.equal(joinPath("/home/user/", "repo/", "file.ts"), "/home/user/repo/file.ts");
  assert.equal(joinPath("C:/mixed\\style", "x"), "C:/mixed\\style/x");
});

test("samePath ignores separator style and trailing separators", () => {
  assert.ok(samePath("C:\\Users\\kingx\\repo", "C:/Users/kingx/repo/"));
  assert.ok(samePath("/a/b", "/a/b/"));
  assert.ok(!samePath("/a/b", "/a/c"));
});

test("normalizeSlashes and toFileUrl build valid file URLs on Windows", () => {
  assert.equal(normalizeSlashes("C:\\Users\\kingx"), "C:/Users/kingx");
  assert.equal(toFileUrl("C:\\Users\\My Files\\page.html"), "file:///C:/Users/My%20Files/page.html");
  assert.equal(toFileUrl("/srv/www/index.html"), "file:///srv/www/index.html");
});
