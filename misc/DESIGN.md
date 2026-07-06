# OSAI Design System — **Neon Glass**

The reference every OSAI surface follows. This is the owner's house style (it
replaces the earlier "calm/restrained" spec). Tokens live in `src/App.css`; this
doc is the *why* and *when*.

If you're styling any pane or component, read this first. The bar: it should look
like it belongs next to the chat — frosted, lit, deliberate.

---

## 1. Philosophy — frosted glass, lit by a restrained glow

OSAI is a **dark, futuristic glass console.** Depth comes from *translucency and
light*, not heavy slabs or hard borders.

- **A deep near-black ground.** Everything floats above it.
- **Frosted glass surfaces.** Cards, the composer, menus, popovers, the sidebar —
  translucent fills with a real `backdrop-blur`, so what's behind them bleeds
  through softly. Surfaces feel like panes of lit glass, not opaque boxes.
- **Light is the accent.** The accent shows up as a **glow** — a soft halo on the
  focused composer, the active nav row, the primary action, live/streaming state.
  A thin accent-tinted edge + an outer bloom. This is the signature move.
- **Hairlines + edge-highlights.** Borders are faint; the top edge of a glass card
  catches a 1px highlight (like light hitting a glass lip). Dividers whisper.
- **Calm type, high clarity.** Quiet four-step text hierarchy; mono for the
  machine's voice (status, paths, counts).
- **Motion is subtle and physical.** Glows breathe on live state; surfaces settle
  with a soft ease; a faint sheen can sweep a primary surface. Never busy.

Accent is bolder here than a "precious orange" rule would allow — **glow is a
first-class material** — but it still *means* something: focus, active, primary,
alive. It is not every border or every hover. When everything glows, nothing does.

> The accent is **runtime-themeable** (`lib/theme.ts` overrides `--color-accent*`).
> The owner runs a **violet/purple** accent — never hardcode a hue; always consume
> `var(--color-accent*)` so the glow re-tints with the theme.

---

## 2. The glass + glow materials (`src/App.css`)

New token layer (added beneath the frozen `--color-*` / `--aios-*` tokens):

| Token | Role |
|-------|------|
| `--aios-glass-bg` | Standard glass fill — `panel-2` at ~70% over blur. The card/menu/composer surface. |
| `--aios-glass-bg-strong` | Denser glass (~86%) for the composer + floating menus that need more legibility. |
| `--aios-glass-blur` | The blur radius (16px) + slight saturation lift. |
| `--aios-glass-edge` | The top 1px highlight (white ~10%) — the "glass lip". |
| `--aios-glow-accent` | The signature halo: accent-tinted 1px ring + outer accent bloom. Focus / active / primary. |
| `--aios-glow-soft` | A quieter accent bloom (no ring) — ambient/live hints. |
| `--aios-glow-live` | Status-colored breathing glow for streaming/running surfaces. |

Utility classes (use the class for the skeleton, Tailwind for one-offs):

- **`.glass`** — translucent fill + `backdrop-blur` + hairline + top edge-highlight.
  The default for any discrete floating thing (cards, dropdowns, popovers, chips).
- **`.glass-strong`** — denser glass + strong border. The composer, menus, modals.
- **`.glow-accent`** — apply the accent halo now (active/selected/primary surfaces).
- **`.glow-focus`** — applies the halo on `:focus-within` (text-entry surfaces). The
  composer's focus treatment; replaces the old `.focus-accent`.
- **`.glow-live`** — the breathing status glow for live/streaming surfaces.
- **`.edge-grad`** — a gradient hairline (accent→transparent) for signature edges.

Depth recipe: **blur for separation, edge-highlight for the glass lip, glow for
emphasis.** Reach for `--aios-shadow-pop` only when a surface must also cast a
real drop shadow (large floating modals).

---

## 3. Color, type, spacing, radii — unchanged token names

The `--color-*`, `--aios-text-*`, `--aios-space-*`, `--aios-radius-*` tokens keep
their names and values (see §6). What changes is *how surfaces are filled* (glass,
not flat panel) and *how accent appears* (glow, not just a flat soft wash).

- **Surfaces:** prefer `.glass` / `.glass-strong` over flat `bg-panel-2`. Keep
  `bg-bg` as the ground behind the glass.
- **Text:** body is `text-2`; reserve `text` for the one thing pulling the eye.
- **Radii:** composer = `--aios-radius-xl` (16, the signature). Cards = lg (12).
- **Type scale:** unchanged; composer body is 14px (was 15 — owner wanted tighter).

---

## 4. Accent & glow rules

**Glow/accent is for PRIMARY, ACTIVE, FOCUS, and ALIVE — that's it.**

Use it for:
- The **one** primary action per surface (send button — accent fill + halo).
- The **active / selected** state (current nav row, selected pill, the user's own
  bubble, current menu item) — soft wash **+** a quiet glow.
- The **focus** edge on inputs (`.glow-focus`).
- **Live/streaming** surfaces (the composer while a run streams, a working card) —
  `.glow-live` breathing.
- **Links** and the brand wordmark.

Never:
- A glow on every card or hover. Resting surfaces are glass with a *hairline*, no
  halo. Hover lifts the border/edge one step — it does not bloom.
- More than one primary glow per surface.
- A hardcoded accent hue (breaks theming).

Litmus: kill all glow on a screen — only "what's primary / selected / focused /
alive" should become ambiguous. If anything else changes, glow was overused.

---

## 5. Applying it to a surface

1. **Ground stays `bg-bg`.** Float `.glass` cards on it.
2. **Discrete things → `.glass`** (lg radius). **Floating things → `.glass-strong`**
   (menus, composer, modals) with `--aios-shadow-pop` if they need a drop shadow.
3. **Active/selected → soft wash + `.glow-accent`.** Focus → `.glow-focus`.
4. **Live → `.glow-live`.**
5. **Controls are `.pill`s** (now glassy); `.pill--active` for on/selected.
6. **Honor the type hierarchy** and mono-for-machine.
7. **Leave room.** Blur + glow read best with breathing space; don't crowd.

Build it, then put it beside the chat. If it reads flatter, opaquer, or louder
than the chat composer, pull it toward glass + restrained glow until it matches.

---

## 6. Token quick map

- **Colors:** `--color-{bg,panel,panel-2,pane,border,border-strong,text,text-2,muted,faint,accent,accent-hover,accent-dim,accent-soft,accent-fg,cursor,selection,highlight,success,warning,info,danger,cold,spark}` — `@theme` dark fallback + per-`data-theme`; accent family runtime-overridden by `lib/theme.ts`.
- **Glass/glow (NEW):** `--aios-glass-{bg,bg-strong,blur,edge}`, `--aios-glow-{accent,soft,live}`.
- **Radii:** `--aios-radius-{xs,sm,md,lg,xl,pill}` · **Type:** `--aios-text-{hero,title,lg,body,sm,xs,2xs,micro}` · **Spacing:** `--aios-space-{1..6}` · **Heights:** `--aios-h-{chrome,header}` · **Elevation:** `--aios-shadow-pop` · **Motion:** `--aios-dur-*`, `--ease-*`.
- **Utilities:** `.glass`, `.glass-strong`, `.glow-accent`, `.glow-focus`, `.glow-live`, `.edge-grad`, `.pane-header(__title)`, `.surface(-card|-pop)`, `.pill(--active)`, `.hero-title`, `.helper-line`, `.status-dot(--active|--idle|--dormant|--cold)`.

All source-of-truth values live in `src/App.css`.
