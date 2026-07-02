# PLAN — Projects → **Workspaces** (structured, agent‑aware)

Status: **decisions locked (§10) — ready to build P0.** Planning + Settings cut‑off fix done; no feature code yet.
Owner: Jul.Nazz. Drafted 2026-06-22; decisions resolved 2026-06-22.
Supersedes the flat project model in `src/lib/run.ts` + `src/lib/projects.ts` + the
`list_projects` scan in `src-tauri/src/files.rs`.

---

## 0. TL;DR

Today a "project" is a flat `{ name, root, kind, commands[], mtime }`. That can't
describe how the owner's repos are actually laid out (front/back splits, Beta/Staging
environments, N components per env), the scanner only looks in `~/Repo` (so on this
Windows machine under `C:\FHE-Work` **nothing is auto‑found** — every project was added
by hand as `custom` / `UNKNOWN`), and agents launched on a project get **only a `cwd`** —
no structured understanding of which folder is the frontend, which is the API, which
environment is live, or what stack each runs.

This plan replaces the flat model with a **Workspace** tree:

```
Workspace (C:\FHE-Work\WRMS)
└─ Environments?  (Beta, Staging …)        ← optional grouping layer
   └─ Components  (admin-web, api, …)       ← the runnable units
      └─ { role, path, stack, runCommands, port }
```

…makes the scan **root‑configurable** + Windows‑correct, gives Settings a real
structure editor, and — the crux — **generates native context files** (`CLAUDE.md` /
`AGENTS.md`) from the manifest so any agent launched in the workspace inherits a true
map of the project. The manifest itself lives **with the repo** (`aios.workspace.json`)
so it's portable and the agent can read it directly.

---

## 1. Why the current system doesn't fit

Evidence (this machine, `C:\FHE-Work`):

| Workspace | Real shape | What today's model shows |
|---|---|---|
| `MarkdownEditor` | **fullstack** (Next.js; already has `AGENTS.md`+`CLAUDE.md`) | custom · UNKNOWN |
| `Trading-Portal` | **split** `front/` (Next.js) + `back/` (node) | custom · UNKNOWN, root only |
| `Vendor-Portal`, `I2-Passport`, `BaseTemplate-NewTechStack` | **split** `front/` + `back/` | custom · UNKNOWN |
| `WRMS` | **environments** `Beta/` + `Staging/`, each with N components (`admin-web`, `admin-web-next`, `api`, `api-nitro` …) | custom · UNKNOWN, root only |
| `PoC-Site` | **variants** `current/` + `fresh/` | custom · UNKNOWN |

Concrete failures:

1. **Wrong scan root.** `list_projects()` (`files.rs:508`) walks `std::env::var("HOME") + "/Repo"`.
   On Windows `HOME` is usually unset → it scans `\Repo` (nothing), and the owner's root is
   `C:\FHE-Work` regardless. Result: zero auto‑discovery; everything is a manual `custom` entry.
2. **No nesting.** `ProjectInfo` (`run.ts:35`) is one root + one kind. A split or env‑grouped
   repo collapses to a single folder with `kind: unknown` and no run command.
3. **No component awareness.** There's no concept of "this is the frontend, that's the API,"
   no per‑component stack/port/run‑command, no env (Beta vs Staging) dimension.
4. **No agent context.** Opening a project just does `spawn({ type: "shell"|"chat", cwd: root })`
   (`App.tsx:1425`, `:2922`, `:1276`). The agent sees a directory of sub‑folders and has to
   guess. There is **no manifest, no preamble** — and per the codebase's own rule
   (*"Session identity belongs in CLAUDE.md / AGENTS.md … no per‑turn preamble"*,
   `ChatPane` history) the right home for that context is a **native context file**, which
   we don't currently generate.

---

## 2. The taxonomy (generalized from the real repos)

Three observed shapes, unified into **one recursive tree** so we never have to special‑case:

- **A · fullstack** — one runnable root (`MarkdownEditor`). The workspace *is* the component.
- **B · split** — the root contains several **components**, no env layer
  (`front/`+`back/`; could be `web`/`api`/`mobile`/`infra`).
- **C · environments** — the root contains **environment folders** (`Beta/`, `Staging/`,
  arbitrary names), and **each environment** contains its own components (`admin-web`, `api`, …).

`current/`+`fresh/` (PoC‑Site) is just shape **C** with env‑like grouping names — handled for
free because env names are arbitrary.

> **Insight from WRMS:** an environment can hold **more than two** components and they
> overlap roles (`admin-web` *and* `admin-web-next` are both frontends mid‑migration). So:
> components are a **list**, role is an **attribute** (not a slot), and the folder **name is
> preserved verbatim**.

---

## 3. Data model

A discriminated tree. (TypeScript shape; the Rust structs mirror it.)

```ts
type ComponentRole =
  | "frontend" | "backend" | "fullstack"
  | "mobile" | "desktop" | "infra" | "docs" | "db" | "other";

interface Component {
  id: string;                 // stable, e.g. "beta/admin-web"
  name: string;               // folder name verbatim ("admin-web-next")
  path: string;               // relative to workspace root ("Beta/admin-web-next")
  role: ComponentRole;        // inferred, user-overridable
  stack: string;              // detected: "next" | "node" | "nitro" | "flutter" | "rust" | …
  runCommands: RunCommand[];  // detected (reuses project_at), first = primary
  port?: number;              // optional, for "open in browser" + agent hints
  status?: "current" | "legacy" | "wip" | "deprecated"; // lifecycle (default "current")
  supersedes?: string;        // id of the component this replaces (admin-web-next → admin-web)
  notes?: string;             // freeform, flows into the context file
}

interface Environment {
  id: string;               // "beta"
  name: string;             // "Beta" (verbatim)
  path: string;             // "Beta"
  components: Component[];
}

type Structure =
  | { kind: "fullstack"; component: Component }
  | { kind: "split"; components: Component[] }
  | { kind: "environments"; defaultEnv?: string; environments: Environment[] };

interface Workspace {
  id: string;               // hash of root
  name: string;             // display ("WRMS"), overridable
  root: string;             // absolute ("C:\\FHE-Work\\WRMS")
  structure: Structure;
  tags?: string[];          // e.g. "fhe", "client" — for grouping/filter
  hidden?: boolean;
  source: "scanned" | "custom";
  mtime: number;
  manifestPath?: string;    // "aios.workspace.json" if one exists on disk
  schemaVersion: 1;
}
```

Back‑compat: today's `ProjectInfo` is exactly a **fullstack Workspace** flattened. A thin
adapter (`workspaceToProjectInfo`) keeps existing consumers (palette, F5, homescreen) working
during the migration.

### Source of truth: a per‑workspace manifest file

Store the structure **in the repo** as `aios.workspace.json` at the workspace root
(git‑ignorable or committed — owner's call). Benefits:

- **Portable** — clone the repo elsewhere, structure travels with it.
- **Agent‑readable** — the manifest sits in `cwd`; an agent can open it directly, and the
  generated `CLAUDE.md`/`AGENTS.md` block points at it.
- **Diffable** — changes show up in git.

The app keeps a **central registry** (localStorage `aios.workspaces`, evolved from
`aios.projects`) of: scan **roots**, per‑workspace UI prefs (hidden / pinned / order /
name override), and a cache of last‑scanned structures. The manifest file wins over the
cache when present.

---

## 4. Detection / auto‑config (backend)

Goal: point the app at `C:\FHE-Work`, hit **rescan**, and get the table in §1 — correct shapes,
components, stacks — with **zero manual entry**, and everything overridable.

**4a. Configurable roots + Windows fix.** Replace the hardcoded `HOME/Repo` with a
user‑settable **list of roots** (`scanRoots: string[]`), defaulting to best‑effort detection
(`%USERPROFILE%\…`, `~/Repo`, the dir the app launched from) and surfaced in Settings. The
owner adds `C:\FHE-Work`. Use `USERPROFILE` on Windows; never silently scan `\Repo`.

**4b. `scan_workspace(root)` shape inference** (best‑effort, never blocks, always overridable):

```
for each immediate child dir of a scan root  →  candidate Workspace:
  let kids = child dirs (pruned: node_modules/.git/dist/build/target/.next/…)
  1. ENVIRONMENTS?  if ≥2 kids match an env-name set
       (Beta|Staging|Prod|Production|Dev|current|fresh|… case-insensitive, configurable)
       AND those kids themselves contain component-ish subdirs
     → kind:"environments"; for each env folder, run component-detect on its kids
  2. SPLIT?  else if ≥2 kids each look like a component
       (each has its own project marker via project_at, OR name matches a role hint)
     → kind:"split"; components = those kids
  3. FULLSTACK?  else if project_at(child) recognizes a marker at the root
     → kind:"fullstack"
  4. else → unconfigured workspace (show it, let the user pick a shape)
```

**4c. Component detection** (per candidate component dir):
- **stack** via an extended `project_at` (today: flutter/node/rust/go/python/make). Extend with:
  `next` (next.config.*), `nitro` (nitro.config.* / `nuxt`), `vite`, `angular`, `php/laravel`
  (`composer.json`/`artisan`), `dotnet` (`*.csproj`). Keep `node` as the fallback when only
  `package.json` is present.
- **role** by name hint, then stack: `front|web|client|ui|admin|portal|app|site` → frontend;
  `back|api|server|svc|service|nitro|gateway` → backend; `mobile|ios|android|flutter` → mobile;
  `infra|deploy|terraform|docker` → infra. Ambiguous → `other`, flagged for the user.
- **runCommands** straight from the detected stack (reuse `project_at`'s command derivation).
- **status / supersedes** by name pattern: a `<base>-next` / `<base>-nitro` / `<base>-v2` /
  `<base>2` sibling of an existing `<base>` → `status:"wip"` + `supersedes:<base>`, and the base
  → `status:"legacy"`. Advisory + overridable (WRMS: `admin-web-next` supersedes the legacy
  `admin-web`; `api-nitro` likewise vs `api`).

**4d. Output** = a `Workspace` manifest. Detection is **advisory**: the user can correct any
field, and a present `aios.workspace.json` overrides detection entirely.

New/changed Rust commands (`files.rs`): `set_scan_roots`/`get_scan_roots`, `scan_workspaces()`
(replaces/augments `list_projects`), `detect_workspace(root)`, extended `project_at`. Keep
`list_projects` as a deprecated shim returning flattened fullstack workspaces until consumers
migrate.

---

## 5. Configuration UI (Settings → projects, redesigned)

- **[DONE] cut‑off fix** — the projects list no longer has an inner `max-h-[330px]` scroll box;
  it flows in the (hidden‑scrollbar) content pane, so the last rows aren't clipped.
- **Scan roots card** — list of roots with add/remove + a **rescan** button + last‑scan time.
  This is where `C:\FHE-Work` lives.
- **Workspace cards** (one per workspace, Neon‑Glass `Card`):
  - header: name (editable) · shape badge (`fullstack`/`split` · *N* comps / `environments` · *N* envs) · tags · hide/pin.
  - **environments → tabs** (Beta | Staging); **components → a small tree** with a role chip,
    stack chip, path (mono), and primary run command. Inline edit role / path / command / port.
  - actions: **auto‑detect** (re‑infer this workspace), **+ component**, **+ environment**,
    **set default env/component**, **open** (component picker), **generate context file** (§6).
- **Manual add** still supported (now seeds a Workspace; pick a shape or auto‑detect after).
- **Homescreen** (`IdleControlCenter` `RecentProjects`): each project row gains a tiny
  component/env affordance — click the row → open root; click a component chip → open that
  component's dir; an env switch when applicable. The git‑pulse dot can aggregate per workspace.

---

## 6. Agent‑context integration (the crux)

**Principle (carried from the codebase):** don't inject per‑turn preambles (context bloat +
re‑inflates resumed threads). Put project context where the CLIs already look — **`CLAUDE.md`
(Claude) and `AGENTS.md` (Codex)** — and choose the right `cwd`.

### 6a. Generate a context block from the manifest

From each `Workspace`, generate a **managed, delimited block** written into the root context
file(s) (and optionally per component). Delimiters let us regenerate without clobbering the
owner's hand‑written notes:

```md
<!-- AIOS:workspace BEGIN (generated — edit above/below, not inside) -->
## Workspace: WRMS
Layout: environments → Beta, Staging. Default env: Beta.

### Beta
- admin-web      — frontend · legacy stack          · :3000  (Beta/admin-web)
- admin-web-next — frontend · next · **WIP**, supersedes admin-web · `pnpm dev` · :3001 (Beta/admin-web-next)
- api            — backend  · node · legacy          · :4000  (Beta/api)
- api-nitro      — backend  · nitro · **WIP**, supersedes api · :4001 (Beta/api-nitro)

### Staging
- admin-web — frontend · legacy stack (Staging/admin-web)
- api       — backend  · node · legacy (Staging/api)

When working here: pick the environment first; the frontend talks to the matching api.
admin-web / api are the LEGACY stack; admin-web-next (Next.js) and api-nitro are the in-progress
rewrites that supersede them — default NEW work to the *-next / *-nitro components unless told otherwise.
<!-- AIOS:workspace END -->
```

- Written to **whichever context files the workspace's engine uses** (detect existing
  `CLAUDE.md`/`AGENTS.md`; offer to create). MarkdownEditor already has both — we update the
  managed block in place.
- **Per‑component** context optional: a short managed block in `Beta/api/AGENTS.md` ("you are in
  the WRMS Beta API; the frontend is ../admin-web on :3000").
- Regeneration is **explicit** (a button) or **on structure change** (owner‑toggle), never silent.

### 6b. Launch the agent in the right place

- Spawn descriptor gains an optional component/env target: `spawn({ type, cwd })` already takes
  `cwd` — feed it the **component dir** for focused work, the **workspace root** for cross‑cutting
  work. The generated context file at each level does the explaining.
- A **component/env picker** appears when opening a structured workspace (homescreen card,
  command palette `proj:` entries, and the chat/oracle "open in…" affordance). Default = the
  workspace's `defaultEnv`/primary component.
- The picker is the *only* new runtime surface; everything else is the native context file +
  cwd, so it stays cheap and CLI‑idiomatic.

### 6c. Later (optional, links to existing plans)

Expose the manifest as a **control‑plane / MCP resource** (`misc/PLAN-control-plane.md`) so an
agent can query "what components does WRMS have?" live, and so cross‑workspace orchestration
(e.g. "run the Beta api + admin-web together") becomes a first‑class action.

---

## 7. Persistence & migration

- **Store v2** (`aios.workspaces`, versioned): `{ schemaVersion, scanRoots[], workspaces:
  Record<root, WorkspacePrefs>, structureCache }`. `WorkspacePrefs` = name override, hidden,
  pinned, order, tags.
- **Migrate** existing `aios.projects`: each `custom` entry → a `fullstack` (or `unconfigured`)
  Workspace at the same root; `hidden`/`overrides` carry over. No data loss; runs once on load
  (mirrors the `settings.ts` back‑fill pattern).
- **Manifest files** are opt‑in per workspace; absence just means "use detection + central cache."

---

## 8. Backend (Rust) work — `src-tauri/src/files.rs`

- Configurable `scanRoots` (persisted app‑side; passed into the command) + `USERPROFILE` on Win.
- `scan_workspaces() -> Vec<Workspace>` with the §4 inference; `detect_workspace(root)`.
- Extend `project_at` with next/nitro/vite/angular/php/dotnet stacks.
- `read_workspace_manifest(root)` / `write_workspace_manifest(root, ws)`.
- `generate_context_block(root)` — render §6a into `CLAUDE.md`/`AGENTS.md` managed blocks
  (read → replace‑between‑delimiters → write; create if missing, never touch outside the block).

---

## 9. Phasing (each phase gated: `tsc 0` · `test:chatpane` 145 · `build ✓` · `cargo check` if Rust)

- **P0 — unblock (small).** ✅ Settings projects cut‑off fixed. Add **scan‑roots config +
  Windows `USERPROFILE` fix** so `C:\FHE-Work` actually auto‑scans (immediate value even before
  the tree lands; fullstack/split/env all still show as flat until P2).
- **P1 — model + store + migration.** ✅ **DONE** (gated: tsc 0 · 161 tests · build ✓).
  `src/lib/projectWorkspaces.ts` — full `ProjectWorkspace` tree model, v2 store
  (`aios.workspaces.projects`), pure one-time migration from `aios.projects`
  (`migrateProjectsStore`), the `workspaceToProjectInfo` back-compat adapter, and pure
  inference helpers (`inferRole`, `supersedesBase`, `stackToKind`, `primaryComponent`,
  `projectShapeLabel`, …). 16 unit tests in `projectWorkspaces.test.ts`. **Not yet wired into
  any consumer** (purely additive — nothing depends on it, so it's safe); P2/P3 rewire.
  *(Naming: `ProjectWorkspace`, not `Workspace`, since `lib/workspaces.ts` already owns
  `Workspace` for saved pane layouts — see §12.)*
- **P2 — detection backend.** ✅ **DONE** (gated: cargo check ✓ · tsc 0 · 161 tests · build ✓).
  `src-tauri/src/files.rs`: `scan_workspaces(roots)` + `detect_workspace(root)` +
  `suggested_scan_roots()` (registered in `lib.rs`); shape inference (environments → split →
  fullstack → unconfigured); `detect_stack` extends `project_at` with next/nitro/nuxt/vite/
  angular/php/dotnet; role + supersedes (`-next`/`-nitro`/`v2`) + legacy/wip heuristics; the
  `current`+`fresh` "variant" case (env folder that's itself one app); configurable roots with
  the Windows `USERPROFILE` path (reuses `home_dir`); 4 Rust helper unit tests. TS bindings in
  `run.ts` (`scanWorkspaces`/`detectWorkspace`/`suggestedScanRoots`). **Verified on the real
  `C:\FHE-Work`** via a throwaway example (since removed): WRMS→environments with
  admin-web(legacy)/admin-web-next(wip⇒sup) + api(legacy)/api-nitro(wip⇒sup) across Beta+Staging;
  Trading/Vendor/I2-Passport/BaseTemplate→split[front:next, back:nitro]; MarkdownEditor→fullstack;
  PoC-Site→environments[current, fresh]; non-projects→unconfigured. serde JSON matches the TS
  types (camelCase, `kind`-tagged structure). **Not yet wired into the UI** (P3).
  *(Note: `cargo test` can't link on Windows due to a pre-existing macOS-`cfg` bug in
  `browser.rs`'s test module — unrelated to P2; the lib `cargo check` is clean and the P2 helper
  logic is mirrored by the 16 passing TS tests + the real-FS smoke test.)*
- **P3 — wiring + config UI.** ✅ **DONE** (gated: tsc 0 · 161 tests · build ✓).
  *Wiring (P2.5, folded in):* unified the project source on the structured backend —
  `App.tsx` and `FilesPane.tsx` now load `scanWorkspaces(getScanRoots())`, merge via the store,
  and flatten through `workspaceToProjectInfo` for the legacy `ProjectInfo[]` consumers
  (homescreen / palette / files picker) — so they auto-discover `C:\FHE-Work` (default root =
  parent of the launch dir) with no behavior change, one source of truth. *Config UI:* Settings →
  projects rebuilt — a **scan-roots card** (add/remove/rescan + suggested-root chips) and
  **workspace cards** showing the detected shape badge + an env-grouped **component tree** with
  role / stack / **legacy·wip** / "↑ replaces" chips, plus rename / hide / delete and **manual add
  (auto-detects shape via `detectWorkspace`)**. The old flat `ProjectsSection` + the `aios.projects`
  consumers are retired (lib/projects.ts kept only as the migration source + `ProjectsStore` type).
- **P4a — context files.** ✅ **DONE** (gated: tsc 0 · cargo check ✓ · 161 tests · build ✓).
  Rust (`files.rs`): `render_workspace_context` → a managed `<!-- AIOS:workspace BEGIN/END -->`
  block (structure · components · stacks · run-cmds · paths · legacy/wip/supersedes · guidance);
  `upsert_managed_block` (idempotent, only touches between markers; unit-tested);
  `generate_workspace_context(root)` writes `aios.workspace.json` + upserts the block into **both
  CLAUDE.md AND AGENTS.md** + `.gitignore`s the manifest (owner §10.2/§10.3);
  `preview_workspace_context(root)` (read-only) for consent-first preview. `detect_workspace_impl`
  now sets `manifestPath` when present. Bindings in `run.ts`
  (`previewWorkspaceContext`/`generateWorkspaceContext`). Settings: each workspace card has a
  **context button → inline preview + "write CLAUDE.md · AGENTS.md"**; an **"agent context" card
  with the on-change toggle** (`regenerateContextOnChange`, off by default — owner §10.4) that
  regenerates manifest'd workspaces on rescan. **Verified** the rendered block on WRMS (Beta/Staging
  + legacy/wip/supersedes), Trading-Portal (split), MarkdownEditor (fullstack), PoC-Site (variants)
  via a throwaway read-only preview (since removed).
- **P4b — launch wiring.** ✅ **DONE** (gated: tsc 0 · 161 tests · build ✓). New
  `src/components/WorkspaceLaunchPicker.tsx` (Neon-Glass, token-only): opening a **structured**
  workspace from the homescreen (`openProject` in App.tsx, routed via `onOpenProject`) shows a
  picker — the workspace **root** plus each **component** (env-grouped, default env marked, role/
  stack/status chips), each openable as a **terminal** or a **chat agent** in that component's
  `cwd`. Fullstack workspaces open at the root directly (no picker). The P4a context file at the
  root explains the structure; this sets the landing folder.
- **P5 — homescreen/palette polish.** ✅ **DONE** (gated: tsc 0 · 161 tests · build ✓).
  *Palette:* `appCommands.ts` now emits per-component **"open ‹workspace› · ‹component›"** entries
  for structured workspaces (env-qualified, role/stack/status in the description) → ⌘K straight to
  a component's terminal in its `cwd`; fullstack covered by the existing "run" entry.
  `projectWorkspaces` threaded into the command-builder deps. *Homescreen:* `RecentProjects` shows a
  **shape-hint chip** (`split · N` / `environments · N`) on structured rows (signaling the launch
  picker), threaded App → IdleDashboard → IdleControlCenter via `shapeByRoot`; fixed the stale
  "no projects under ~/Repo" copy. **Deferred (optional, own effort):** exposing the manifest as an
  MCP / control-plane resource (`misc/PLAN-control-plane.md`) for live agent queries.

**Epic status: P1–P5 SHIPPED.** The flat project model is fully replaced by structured, agent-aware
workspaces — auto-discovered, configurable, context-generating, and component/env-launchable.

Backups before heavy edits per `TRACKER` convention.

---

## 10. Decisions — **RESOLVED** (2026-06-22, owner)

1. **Env‑name set** → **auto‑treat** a configurable list — `Beta, Staging, Prod, Production, Dev,
   current, fresh` (case‑insensitive) — as environment folders. Editable in Settings.
2. **Manifest location** → **`aios.workspace.json` at the workspace root** (portable +
   agent‑readable). Git‑ignored by default with a "commit it to share" hint (flip per repo).
3. **Context file target** → write the managed block into **both `CLAUDE.md` AND `AGENTS.md`**
   (create whichever is missing). No neutral `AIOS.md`.
4. **Regeneration trigger** → an **explicit "generate / update context" button** PLUS an
   **on‑change toggle** (off by default) that regenerates when the structure changes.
5. **Role taxonomy** → the §3 `ComponentRole` set is **sufficient** as‑is.
6. **Component lifecycle / overlap** → components carry **`status`** (`current` | `legacy` | `wip`
   | `deprecated`) + an optional **`supersedes`** link. WRMS: `admin-web` = **legacy** (the older
   stack), `admin-web-next` = **wip**, a Next.js rewrite that **supersedes `admin-web`** (and
   `api-nitro` supersedes `api`). The generated context block states this so agents default new
   work to the `*-next`/`*-nitro` components.

---

## 11. Constraints / non‑goals

- Detection is **advisory + overridable**; never force a shape or move/rename the owner's folders.
- The managed context block must be **idempotent** and only ever touch text between its delimiters.
- Keep `ProjectInfo` + `list_projects` shim alive until all consumers (palette `appCommands.ts`,
  F5 `App.tsx`, `IdleControlCenter`/`IdleDashboard`, `FilesPane`) move to `Workspace`.
- No multi‑agent fan‑out for the build (quota). Standard gates every phase.
- Accent/Neon‑Glass tokens only in any new UI (design‑token ratchet).

---

## 12. Files this will touch (map)

> **Naming note:** `src/lib/workspaces.ts` is already taken — it's the **saved
> pane-layout** feature (`Workspace` = a named set of open panes). To avoid the
> clash, the project concept lives in **`src/lib/projectWorkspaces.ts`** and its
> core type is **`ProjectWorkspace`** (`ProjectComponent` / `ProjectEnvironment` /
> `ProjectStructure`). "Workspace" stays the conceptual/UI word in this doc.

- **New:** `src/lib/projectWorkspaces.ts` (model + store + migration + adapter), `aios.workspace.json` (per repo).
- **Rust:** `src-tauri/src/files.rs` (scan/detect/manifest/context‑gen), command registration in `lib.rs`.
- **Changed:** `src/lib/run.ts` (types), `src/lib/projects.ts` (fold into workspaces or thin shim),
  `src/components/Settings.tsx` (`ProjectsSection` → workspace editor),
  `src/components/IdleControlCenter.tsx` + `IdleDashboard.tsx` (component/env affordance),
  `src/lib/appCommands.ts` (palette `proj:` entries → component targets),
  `src/App.tsx` (cwd‑aware spawn + component/env picker).
