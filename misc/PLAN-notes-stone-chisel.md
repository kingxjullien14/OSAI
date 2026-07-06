# PLAN — Notes reborn: the Stone & Chisel bridge (W7.2)

> **EPIC CLOSED 2026-07-04** (owner: "please finish up on the notes").
> N0–N4 + polish + diff3 merge + agent hooks + offline outbox all shipped
> and verified (final: 294/294 · tsc 0 · vite build · cargo 0). What remains
> below under N5 is a PARKED menu, not open work. Needs a Rust restart
> (control timeout, snc commands, write_text_file parent-dirs).

Owner ask (2026-07-04): "please rethink the whole notes… since im not using it
at all, please make it into something that i can use. or maybe, can find a way
to connect this to my other app C:\FHE-Work\MarkdownEditor. stone n chisel is
my own markdown notes app. maybe can integrate the whole app as is… not as a
browser page, but a complete mini app. where the chats/agents can use and put
the markdowns there where i can also later check and read on my other devices."

## The concept

Today's NotesPane is a bare textarea over `~/.aios/notes/*.md` — a scratch
store nothing feeds and nothing reads. It dies.

The new NotesPane is a **native Stone & Chisel client**. Not an iframe, not a
browser page — an AIOS-built pane (React, Neon Glass) that speaks to S&C's
existing REST API. Stone & Chisel's Neon Postgres becomes the ONE notes truth:

- you write in AIOS → it's in S&C → readable on the phone/laptop via the web app
- chats/agents drop markdown into it (control-plane verb) → same place
- you write on the phone → it shows up in the AIOS pane

S&C is the owner's own app (kingxjullien14/MarkdownEditor) — no license issue,
and BOTH sides are ours to modify. That's the unlock: instead of scraping a
cookie-authed web app, we give S&C a proper "connected apps" token layer and
AIOS a first-class client.

## What was studied (2026-07-04)

**Stone & Chisel** (`C:\FHE-Work\MarkdownEditor`) — Next.js 16 App Router +
React 19 + Tailwind v4/shadcn, Drizzle on **Neon Postgres (cloud, already)**,
Auth.js v5 credentials + JWT cookie, Vercel Blob for images, built for Vercel.
v1.6.3. Full REST surface already exists: `/api/documents` (list w/ server
FTS + tag/folder filters, create w/ templates), `/api/documents/[id]` (GET /
PATCH w/ **baseUpdatedAt → 409 conflict guard** / soft-delete), trash/restore/
hard-delete, versions (auto-snapshot 5-min interval), share links, folders
(nested), tags, workspaces, journal-templates, import/export, stats, graph,
backlinks. Schema: documents(id uuid, title, content ≤1MB, kind md|mdx,
tags[], pinned, folderId, isTemplate, wordGoal, shareSlug, deletedAt,
searchVector GIN, timestamps).

**Auth reality**: NO middleware.ts — every route independently calls
`await auth()` (42 call sites / 26 files). So token auth = one `requireUser()`
helper swapped into the routes AIOS needs; nothing else moves.

**AIOS side**: `lib/notes.ts` + `NotesPane.tsx` are the only consumers of the
disk store. AIOS has NO markdown-preview deps (chat uses its own formatter) —
react-markdown pipeline would be new. Keychain storage pattern exists
(`apikeys.rs`, Tier-4 BYOK). Control plane (aios-control MCP) exists for the
agent verb.

## Decisions (locked unless owner objects)

- D1 **Truth = S&C's Neon DB.** AIOS holds a read cache + unsent drafts, never
  a competing store. `~/.aios/notes` migrates in, then retires.
- D2 **Auth = personal access tokens** minted in S&C settings ("Connected
  apps"), sent as `Authorization: Bearer snc_…`. No cookie scraping, no
  second credentials flow in AIOS; agents can use the same token via curl.
- D3 **Not an embed.** The pane is native AIOS UI over the API. S&C's *client
  logic* (editor actions, markdown utils) may be ported file-by-file — it's
  the owner's own code.
- D4 **Conflict-safe writes**: every content PATCH carries `baseUpdatedAt`;
  409 → conflict banner (keep mine / take theirs), never silent clobber.
- D5 **v1 preview is lean**: react-markdown + remark-gfm + rehype-highlight.
  KaTeX + Mermaid are a later phase (heavy deps; chat doesn't have them
  either).
- D6 **Offline = full outbox with merge** (owner 2026-07-04: "queued for
  network, then once connected, if new, then can just add it. if notes
  updated, then it needs a way to merge it"). Design:
  - Ops journal at `~/.aios/cache/snc/outbox/<seq>-<op>.json`. Creates carry
    a tempId; updates COALESCE per doc (newest local content wins locally)
    but keep the base snapshot `{baseUpdatedAt, baseContent}` from the FIRST
    offline edit — that's the three-way merge anchor.
  - Replay in order on reconnect/app start. Create → POST, remap tempId →
    real id everywhere (open pane, later queue entries). Trash → DELETE
    (404 = already gone, fine). Update → PATCH w/ baseUpdatedAt:
    - 200 → done. 409 → **three-way merge** (line-based diff3): base =
      stored baseContent, ours = queued content, theirs = server current.
    - Merge clean → PATCH the merged text with theirs' updatedAt as the new
      base (re-merge on a second 409 — someone's typing on the phone).
    - Overlapping hunks → entry parked "needs attention": pane badges the
      doc, conflict card shows the merged view with inline conflict blocks +
      keep-mine / take-theirs / edit-then-save. The local version is NEVER
      dropped until the owner resolves.
  - diff3 lives in `src/lib/snc/merge.ts` (pure TS, node:test coverage —
    same suite as everything else). The queue itself is plain JSON on disk so
    a crash mid-replay loses nothing (entries delete only after a 2xx).

## Owner answers (2026-07-04) — all three questions closed

- Q1 ✔ deployed: **https://stone-n-chisel.vercel.app** (default base URL;
  overridable in settings for local dev).
- Q2 ✔ retire `~/.aios/notes`. Checked: the dir doesn't even exist on this
  machine — nothing to import, N4 is pure code deletion.
- Q3 ✔ full outbox with merge → decision D6 above. (Supersedes the earlier
  "parked drafts" recommendation.)

## Phases

### N0 — S&C grows "Connected apps" (in the MarkdownEditor repo)
**STATUS 2026-07-04: CODE DONE, verified (vitest 89/89 · next build clean ·
tsc clean). NOT yet deployed** — remaining, owner-side:
1. `npm run db:push` in MarkdownEditor (sandbox declined to touch the prod
   Neon DB; the exact SQL is `drizzle/0012_api-tokens.sql` — one additive
   CREATE TABLE, nothing destructive),
2. commit + push → Vercel deploy,
3. mint a token: stone-n-chisel.vercel.app → Account → **Connected apps**.
GOTCHA found during build: Next 16 renamed middleware → `src/proxy.ts`, which
runs the Auth.js `authorized` callback and cookie-gates `/api/documents*` —
Bearer requests are now let through there and validated for real in-route
(routes 401 on bad tokens; nothing weakened). Files: schema `api_tokens` +
`lib/api-tokens.ts` (mint/hash/shape, sha256, shown-once) + `lib/api-auth.ts`
(`requireUserId`: Bearer→hash lookup w/ 10-min lastUsed throttle, else
session; malformed Bearer = hard 401, no cookie fallthrough) + swaps in
documents/, documents/[id]/(+restore), trash, folders/, folders/[id],
tags + NEW `/api/tokens` (mint/list, session-ONLY so a leaked token can't
mint tokens) + `/api/tokens/[id]` (revoke = timestamp) + NEW
`/api/documents/[id]/append` (atomic in-SQL concat — concurrent appends both
land; same 5-min snapshot policy as PATCH) + Connected-apps card in the
account dialog (mint form, shown-once copy strip, list w/ prefix + last-used,
revoke).
- `api_tokens` table: id, userId, name, tokenHash (sha256), tokenPrefix
  (display), lastUsedAt, createdAt, revokedAt. `npm run db:push`.
- `requireUser(req)` helper: `Bearer snc_<rand>` → hash lookup → userId
  (stamps lastUsedAt), else fall back to `auth()`. Swap into the routes AIOS
  uses: documents/*, folders/*, tags. Others stay cookie-only.
- Settings → **Connected apps** card: mint (token shown ONCE), list w/
  last-used, revoke.
- Nice-to-have for agents: `POST /api/documents/[id]/append` (server-side
  append beats read-modify-write for concurrent agent writes).
- Vitest coverage for the helper; deploy; version bump (1.7.0).

### N1 — AIOS backend: the S&C client (`src-tauri/src/snc.rs`)
**STATUS 2026-07-04: DONE** (cargo check 0 · tsc 0 · tests 273/273 (13 new) ·
vite build clean). Owner deployed N0 + minted a token; live probe against the
deployment confirms Bearer handling end-to-end (fake token → JSON 401, not a
login redirect). Shape as built:
- `snc.rs`: token in keychain (`aios-snc`/`token`), base URL in
  `~/.aios/snc.json` (Rust-owned so the N3 control plane needs no webview);
  commands = `snc_status` / `snc_configure` (LIVE-verifies via GET
  /api/folders before storing; 401 → friendly re-mint message) /
  `snc_disconnect` / generic `snc_fetch(method, path, body)` with /api/
  prefix + method allowlist. Every HTTP status flows back as
  `{status, data}`; only transport/config problems are Err. `pub fn call()`
  is the control plane's direct entry.
- TS split for testability: `src/lib/sncCore.ts` = shapes + pure protocol
  (listQuery, errorMessage, toError→SncConflictError|SncHttpError,
  collectTags — S&C has no tags GET, tags ride the doc list) with NO tauri
  import; `src/lib/snc.ts` = invoke transport + typed doc/folder/trash API
  (re-exports core). 409-with-current → SncConflictError.current = the D6
  merge input. New test file wired into test:chatpane.
- NOTE: the pane cache/outbox (D6) intentionally NOT here — it lands with
  the UI in N2 where the edit lifecycle lives.
- Base URL + token in the OS keychain via the existing apikeys pattern
  (service `aios-snc`); settings field for the URL.
- Commands: `snc_verify` (cheap GET /api/tags → connected? whoami-ish),
  `snc_list` (sort/q/tag/folder passthrough), `snc_get`, `snc_create`,
  `snc_update` (baseUpdatedAt; 409 surfaced as typed error), `snc_trash`,
  `snc_folders`, `snc_tags`, `snc_append`.
- Read cache: last list + opened docs to `~/.aios/cache/snc/` → instant paint
  + offline reading. Failed saves → `~/.aios/cache/snc/drafts/` (Q3).
- `cargo check` + unit tests where testable.

### N2 — AIOS UI: the NotesPane mini app
**STATUS 2026-07-04: N2a SHIPPED** (tsc 0 · 273/273 · build clean) — the
pane is a WORKING S&C client; owner connects by pasting the minted token.
Built: ConnectCard (live-verify via snc_configure, inline error, open-web-app
link) · list column (server-FTS search debounced 300ms, folder Dropdown w/
inline new-folder, tag chip rail from collectTags, trash view w/ restore,
offline strip, foot = open-s&c / disconnect-token / sync) · stage (title
input w/ S&C's auto-title rule — auto until the owner types a title, pin,
tags menu w/ add-input, move-to-folder menu, send-to-oracle kept, two-click
trash) · autosave 800ms PATCH w/ baseUpdatedAt → 409 = conflict banner
(keep mine = deliberate overwrite basing on server row / take theirs);
offline saves show "queued (offline)" + 10s retry; 20s poll pulls
other-device edits into the open note only when it's clean. Icon Dropdowns
use triggerClassName (default pill is for chips). NOTE: needs a RUST
rebuild (new snc commands) — restart the dev app, not just a reload.
**N2b ROUND 1 SHIPPED 2026-07-04 (owner: "polish it alot… dropdowns, the
important features, the viewers"; tsc 0 · 273/273 · build clean):**
- THE VIEWER: write / split / read stage modes (⌘1/2/3 segmented control in
  the header) — the reader REUSES chat/Markdown.tsx (zero new deps, notes
  read exactly like chat prose: fences w/ copy + run-in-terminal, tables,
  interactive checklists, link/file chips). Read mode = centered 46rem
  column w/ big title + folder/tags/edited meta line.
- DROPDOWN FIX + REDESIGN: MenuItem renders its OWN check + wraps children
  in a non-flex span — the pane's extra <Check> + flex-1 caused the wrapped
  double-check in the owner's screenshot. Children are now self-contained
  flex spans. Menus got section headers (MenuHeader caps-label), folder rows
  = tinted Folder icon + name + right-aligned mono count, tag rows = accent-2
  "#" + name, "new folder ⏎"/"add tag ⏎" inputs styled.
- FOLDER COLOR system: folderTint() maps S&C's free-form color names to CSS
  KEYWORDS (ratchet forbids hex) — tints menu rows, the filter chip, list-row
  folder dots, reader meta, footer dot.
- LIST: rounded inset rows w/ gradient accent rail on the active row (the
  MenuItem/ResumeRow language), pin glyph, folder dot+name shown in
  all-notes view, hover-reveal restore on trash rows, accent-soft "+" CTA,
  borderless filter rails w/ hairline divider.
- STAGE: collapsible list column (PanelLeft toggle), segmented view control,
  tag trigger glows accent when the note has tags, footer = folder dot +
  tags | words · edited · sync dot (accent-2 synced / pulsing accent saving
  / danger queued). Editor: Tab inserts two spaces. Keys: ⌘N new · ⌘S flush
  · ⌘1/2/3 views. Connect card got the filament top edge + Sparkles kicker.
**N2b ROUND 2 (next): owner screenshot pass · D6 disk outbox + diff3 merge
card. (Share-link button needs the S&C share route swapped to requireUserId
first — do it with N3's repo touch.)**
- Three zones, Neon Glass: **rail** (All · Pinned · folders tree · tag chips ·
  Trash; collapsible) → **list** (search box = server FTS; pinned-first;
  title/preview/relative-time rows) → **stage** (editor).
- Stage: Edit / Split / Preview toggle (⌘1/2/3 in-pane); autosave ~800ms via
  PATCH + baseUpdatedAt; 409 conflict banner per D4; word count; pin, tag
  editor, move-to-folder, trash (restore from Trash view).
- Preview pipeline per D5 (new deps: react-markdown, remark-gfm,
  rehype-highlight — bundle-size note in the PR).
- Port, don't rewrite, S&C's pure client helpers where they fit
  (editor-actions, markdown-utils, format) with their tests.
- Not-connected state = onboarding card (paste token + URL, live verify) —
  mirrors the BYOK onboarding pattern.
- Keep "send to oracle". Pane title = note title.

### N3 — agents write notes
**SHIPPED 2026-07-04 together with D6 (owner: "heavily connected to the
chats/terminal/agents"; 287/287 · tsc 0 · build clean · cargo 0):**
- **Control plane**: `notes.list` (q/tag → trimmed metas), `notes.read`,
  `notes.create` (content required; default tags from-aios+agent),
  `notes.append` — in lib/control.ts vocabulary + capabilities, ASYNC cases
  (routeControl now returns `ControlResult | Promise<ControlResult>`;
  App's listener awaits before emitting the reply; malformed input errors
  synchronously and never reaches a handler; rejections → ok:false).
  App handlers call lib/snc directly ("external == UI"). control.rs reply
  wait raised 5s→15s (Neon cold start > 5s would've 504'd real writes).
- **Chat**: assistant-bubble hover row got a NotebookPen "save to notes"
  button (idle→busy→saved✓/error states, auto-settle) + a right-click "Save
  to notes" entry — tags from-aios+chat, title from first line
  (sncCore.deriveTitle, now shared).
- **Terminal**: ⋯ menu "Save selection to notes" (disabled w/o selection) —
  wraps the selection in a ```console fence, title "terminal · <first
  line>", tags from-aios+terminal.
- lib/snc `saveToNotes(text, {title?, tags?})` = the one shared capture
  helper (bubble/terminal/control all go through it).
- D6 STATUS: **diff3 merge SHIPPED** (src/lib/sncMerge.ts, 11 tests —
  git-style: one-side regions take that side, identical both-side changes
  collapse, overlaps fence with markers; LCS with prefix/suffix peel + a
  25M-cell guard that degrades to one big conflict, never a wrong merge).
  Pane flow: 409 → diff3(base=last-acked doc, ours=draft, theirs=409 body);
  CLEAN → auto-applies + saves on theirs' updatedAt + fading "merged edits
  from another device" strip; OVERLAP → banner "N overlapping edits" with
  **merge in editor** (drops the marked text into the editor, bases on
  theirs, saves as you resolve; slim hint strip while markers remain) ·
  keep mine · take theirs.
- **OUTBOX SHIPPED 2026-07-04 (D6 complete; 294/294 · cargo 0):** new
  `src/lib/sncOutbox.ts` (PURE queue logic + injected-deps replay, 7 tests:
  per-note create coalescing, local-trash cancels its create, idempotent
  trash, in-order drain, transport-failure HALTS keeping order, server
  rejections drop instead of wedging). Disk anchor in lib/snc
  (`~/.aios/cache/snc/outbox.json` — survives restarts; write_text_file now
  create_dir_all's parents in files.rs). Pane: offline create → a fully
  editable **local draft** (id `local-…`, accent-2 "local" chip in the list,
  saves update the queued op, tags/folder ride it, trash cancels it);
  offline trash of a real note queues + hides optimistically; replay runs on
  boot / on a 15s (offline) / 30s loop / on the offline-strip tap (which now
  shows queue depth), swaps the temp id for the real row in-place, and the
  strip clears when the queue drains. Edits to existing notes stay on the
  dirty-retry + diff3 path (not outbox — by design).
- Notes pane now contributes to its window ⋯ menu like the terminal does
  (paneMenuExtras via new paneKey prop): New note (⌘N) · Sync now · Open
  stone & chisel.

### N4 — retirement (import cancelled — the notes dir doesn't exist)
**DONE 2026-07-04** with N2a: `lib/notes.ts` deleted (the rewritten pane was
its only importer), old pane internals + 5s disk poll gone with the rewrite.
- Verify ritual: tsc 0 · full test suite · build clean · cargo check.

### N5 — later menu (each its own small session)
- Journals (calendar picker) in-pane · version-history viewer + restore ·
  share-link button (copy public URL) · image paste → S&C images API ·
  KaTeX + Mermaid preview parity · S&C workspaces ↔ AIOS Workspaces mapping ·
  notes as a Ctrl+K palette scope.

## Sequencing note

N0 lives in the OTHER repo (MarkdownEditor) and must deploy before N1 is
testable end-to-end. N1+N2 are one AIOS arc; N3 rides once N1's client
exists; N4 closes the loop. This is a true epic (two repos), so it runs like
the ChatPane-history epic: this doc is the board, W7 in PLAN-odysseus-feel.md
points here, and W7 per-pane polish continues underneath it.
