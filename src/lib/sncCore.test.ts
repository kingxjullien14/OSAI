// @ts-nocheck -- node:test suite; runs under --experimental-strip-types.
import assert from "node:assert/strict";
import test from "node:test";

import {
  collectTags,
  errorMessage,
  listQuery,
  SncConflictError,
  SncHttpError,
  toError,
  type SncDoc,
} from "./sncCore.ts";

// ---------------------------------------------------------------------------
// listQuery

test("listQuery: empty opts → empty string (no stray '?')", () => {
  assert.equal(listQuery(), "");
  assert.equal(listQuery({}), "");
});

test("listQuery: default sort 'updated' is omitted, others sent", () => {
  assert.equal(listQuery({ sort: "updated" }), "");
  assert.equal(listQuery({ sort: "alpha" }), "?sort=alpha");
  assert.equal(listQuery({ sort: "created" }), "?sort=created");
});

test("listQuery: q/tag are trimmed and skipped when blank", () => {
  assert.equal(listQuery({ q: "  beacon notes  " }), "?q=beacon+notes");
  assert.equal(listQuery({ q: "   " }), "");
  assert.equal(listQuery({ tag: " aios " }), "?tag=aios");
  assert.equal(listQuery({ tag: "" }), "");
});

test("listQuery: folder passes through (uuid or the 'none' sentinel)", () => {
  assert.equal(listQuery({ folder: "none" }), "?folder=none");
  assert.equal(
    listQuery({ folder: "6f9619ff-8b86-d011-b42d-00c04fc964ff" }),
    "?folder=6f9619ff-8b86-d011-b42d-00c04fc964ff",
  );
});

test("listQuery: values are url-encoded (websearch operators survive)", () => {
  assert.equal(listQuery({ q: 'exact "phrase" -minus' }), "?q=exact+%22phrase%22+-minus");
});

// ---------------------------------------------------------------------------
// errorMessage / toError

test("errorMessage: prefers the API's {error} field", () => {
  assert.equal(errorMessage(401, { error: "Unauthorized" }), "Unauthorized");
});

test("errorMessage: HTML/string bodies (vercel error pages) are truncated, not lost", () => {
  const msg = errorMessage(502, "<html>" + "x".repeat(500));
  assert.ok(msg.startsWith("HTTP 502: <html>"));
  assert.ok(msg.length < 170);
});

test("errorMessage: null body falls back to the bare status", () => {
  assert.equal(errorMessage(500, null), "HTTP 500");
  assert.equal(errorMessage(404, {}), "HTTP 404");
});

const liveDoc = {
  id: "d1",
  title: "t",
  content: "server text",
  kind: "md",
  tags: [],
  pinned: false,
  isPublic: false,
  shareSlug: null,
  folderId: null,
  isTemplate: false,
  wordGoal: null,
  updatedAt: "2026-07-04T10:00:00Z",
  createdAt: "2026-07-01T10:00:00Z",
} satisfies SncDoc;

test("toError: 409 WITH a live row → SncConflictError carrying it (the D6 merge input)", () => {
  const err = toError(409, { error: "conflict", current: liveDoc });
  assert.ok(err instanceof SncConflictError);
  assert.equal(err.current.content, "server text");
});

test("toError: 409 without a row degrades to a plain http error (never a crash)", () => {
  const err = toError(409, { error: "conflict" });
  assert.ok(err instanceof SncHttpError);
  assert.equal(err.status, 409);
});

test("toError: other statuses → SncHttpError with the API message", () => {
  const err = toError(401, { error: "Unauthorized" });
  assert.ok(err instanceof SncHttpError);
  assert.equal(err.status, 401);
  assert.equal(err.message, "Unauthorized");
});

// ---------------------------------------------------------------------------
// collectTags

test("collectTags: most-used first, alphabetical tie-break, deduped", () => {
  const docs = [
    { tags: ["work", "aios"] },
    { tags: ["aios"] },
    { tags: ["zeta", "work"] },
    { tags: ["aios"] },
  ];
  assert.deepEqual(collectTags(docs), ["aios", "work", "zeta"]);
});

test("collectTags: empty input → empty list", () => {
  assert.deepEqual(collectTags([]), []);
});
