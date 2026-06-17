# Plan — convert "money agents" → **Scheduled Agents**

> Repurpose the existing (mis-named, cruft-laden) "money agents" feature into a
> clear, genuinely-useful **Scheduled Agents** surface: recurring AI tasks that
> run a prompt on a cadence in a background claude/codex chat and notify you.

## The reality we're building on (verified)

The engine ALREADY exists and is cross-platform:
- In-app scheduler tick — [App.tsx:2587](../src/App.tsx) runs every 60s, finds
  `dueMoneyAgents()` (cadence + last-run stamp, all in localStorage), and fires
  each one's prompt into a **background chat** + a deep-link notification.
- Scheduling: `scheduleIntervalMs` / `isMoneyAgentDue` / `dueMoneyAgents` /
  `load|saveMoneyAgentLastScheduledRun` — keep, rename.
- Prompt builders: `buildMoneyAgentRunCommand` / `buildMoneyAgentChatSeed` — keep.
- Per-agent chat session: `load|saveMoneyAgentChatSession` — keep.
- UI: `MoneyAgentsPane`, `MoneyAgentsSection`, idle-dashboard via
  `controlCenter.ts` / `IdleControlCenter.tsx` — rename + reshape.

**Cruft (vestigial — the in-app tick replaced it):** the `launchd*` fields
(`launchdLabel`, `statePath`, `queuePath`, `stdout/stderrPath`,
`MoneyAgentLaunchdState`) and the launchd-derived health in
`summarizeMoneyAgentState`. The real run signal is the in-app last-run stamp +
the background chat result. Rip the launchd model out.

## Target model

`ScheduledAgentConfig { id, name, prompt, schedule, cwd?, engine?, model? }`
- **name** — human label.
- **prompt** — what it does each run (was "mission").
- **schedule** — cadence (`hourly` | `daily` | `weekly` | `every N m|h|d`).
- **cwd** — working dir (reuse the composer's `CwdPicker`).
- run-state (derived, not launchd): `lastRunAt`, `lastOk`, `lastResult` (short),
  `nextDueAt`, status (`idle | running | ok | failed`).

## Phases

### Phase 1 — rename + de-cruft (safe foundation; keeps working)
- `money agents` → **Scheduled Agents** everywhere (label/UI/comments).
- Files: `moneyAgents.ts`→`scheduledAgents.ts`, `MoneyAgentsPane`→
  `ScheduledAgentsPane`, `MoneyAgentsSection`→`ScheduledAgentsSection`; symbols
  renamed; `apps.ts` pane kind `money-agents`→`scheduled-agents`; the ~50 App.tsx
  refs; `controlCenter.ts`; tests + `bundleBoundaries.test.ts` assertions.
- Remove the `launchd*` config fields + `MoneyAgentLaunchdState`; rewrite
  `summarize*` to derive health from the in-app run stamp + last result.
- localStorage migration: `aios.chatAgents.custom` → `aios.scheduledAgents`
  (read old key once, copy forward, so existing agents survive).

### Phase 2 — clarify create/manage UX
- Create form: name, **prompt** (multiline), **cadence picker**, **cwd picker**
  (reuse `CwdPicker`), optional engine/model.
- **Run now** button (fire immediately, independent of cadence).
- Rows show: status dot, next-due, last-run relative time, last-result preview.

### Phase 3 — templates (make the purpose obvious)
Seed a one-click template catalog:
- **Repo digest** — daily: summarize git activity / what changed in `<cwd>`.
- **Nightly tests** — run the test suite, report the first failures.
- **Dependency/security audit** — weekly: outdated + advisories.
- **URL/API watch** — hourly: fetch `<url>`, alert on change.
- **Morning briefing** — daily: repos + notes + todos recap.

### Phase 4 — capture results (optional, later)
Surface the background chat's result as the agent's `lastResult` (read the run's
final message), so the dashboard shows real outcomes, not just "ran".

## Risk / sequencing
Phase 1 is the big mechanical lift (rename across ~12 files + migration + tests)
but low-risk — the feature behaves the same, just clearer. Phases 2-4 are
additive. Land Phase 1 as its own commit, verify (tsc + cargo + tests), then 2/3.
