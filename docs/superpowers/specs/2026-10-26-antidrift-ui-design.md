# antidrift UI module — design tokens + component specs (design)

Status: draft for approval · 2026-10-26 · targets antidrift v0.4.0

## Intent

antidrift already does one thing for data: **mark an item in an index, then see (and get warned about)
every place it is used across the project**. The UI module applies the same idea to UI elements.

Example: a **Pagar** (pay) button exists on web (a `div`-based component in the web design system) and
on mobile (a Flutter widget in the mobile design system), and is placed on many screens. The developer
wants:

1. one general index entry, `pagar_button`, holding the **spec** (variants, states, and which token
   each visual property uses in each variant × state);
2. pointers to its **implementations** — one per design-system (DS) folder;
3. the **uses** — every screen that places it.

When the spec changes, the implementations are flagged. When a use points at something that no longer
exists, it is flagged.

**Tokens** (colors, radii, spacing, font sizes…) live in antidrift as the **single source of truth for
values**, and antidrift **generates each DS's token file** from them (CSS custom properties for web,
Dart for Flutter). A token value changes once and every platform follows on regeneration.

Two further goals stated by the user:

- **Feed agents just enough to work.** `show pagar_button` must give an agent the full spec with
  token values resolved, so it can build or review an implementation on any platform without reading
  either design system.
- **Catch hardcoded values.** In the user's previous project (IGM v1), UI drifted inside a single app
  and was fixed by hand. `scan` flags hardcoded color literals in UI code that match a token value —
  the signature of someone typing `#1E5BFF` instead of using the token.

### Project layout this must fit (user's convention)

- If every app in the project shares the same drawing tech (e.g. JS for web and mobile), a **single DS
  folder** serves all apps.
- If more than one drawing tech exists (e.g. Flutter mobile + Angular web), **each app has its own DS
  folder inside its app folder**.

antidrift needs no configuration for this beyond the generated-token-file targets (below):
implementation tags say where each implementation lives, so "one DS" and "one DS per app" both work.

## Positioning: complementary, suggested, never forced (user requirement)

This is one opinionated way to handle UI elements. It must be **opt-in**:

- Nothing changes for a project without `.antidrift/tokens/` or `.antidrift/components/`: no new scan
  output, no new setup steps, no extra README noise in the getting-started path.
- The skill may **suggest** the module once, when it notices a design system in the repo and the
  module isn't set up — explaining the three layers (spec → implementations → uses) in two or three
  sentences — and must never set it up without the developer agreeing.
- The README gets its own section framed as "a way of working, if it fits you", not as *the* way.

## Goals

- Tokens stored in `.antidrift/tokens/`, in the **W3C Design Tokens (DTCG) format**.
- Component specs in `.antidrift/components/<id>.json`: variants, states, a token mapping per
  variant × state, versioned by content hash like entities.
- Implementation tags and use tags in code; `scan` reports stale implementations, broken uses, broken
  token references, stale generated token files, and hardcoded color literals.
- Token-file generation for **CSS custom properties** and **Dart (Flutter)**, behind an emitter
  interface where **TS constants, Kotlin (Jetpack Compose) and Swift (SwiftUI)** are each a single new
  module later.
- `show <component>` prints the resolved spec; `tokens [prefix]` lists tokens with values.

## Non-goals (v1)

- **Generating components.** antidrift tracks implementations; humans/agents write the `div` and the
  widget.
- Verifying that an implementation *looks* like its spec (no rendering, no semantic code checks) —
  same stance as entities: antidrift flags drift, the agent re-reads the spec and decides.
- Hardcoded **dimension** detection (`8`, `16px` match far too much unrelated code). Colors only.
- TS / Kotlin / Swift emitters (designed for, not built).
- A "component has no implementation in DS X" check (there is no DS registry to check against).
- Composite DTCG tokens (`typography`, `shadow`, `border`, `gradient`), Figma sync, Style Dictionary
  config import.

## Anti-goals

- Becoming mandatory or noisy for projects that only use antidrift for data entities.
- Every token value change flagging every component implementation (components reference tokens;
  value changes flow through regeneration, not through implementation drift).
- Hand-edited generated token files silently diverging from the source.

## Design

### Storage

```
.antidrift/
  entities/…            (unchanged)
  tokens/*.json         DTCG token files, merged (e.g. color.json, size.json)
  components/<id>.json  component specs
  ui.json               generated token-file targets
```

#### Tokens (DTCG)

Token files use DTCG groups, `$type`, `$value`, `$description`. A token's id is its dotted path
(`color.brand.primary`). All files under `tokens/` merge into one tree; the same path defined twice is
an error. `$type` may be set on a group and inherited (DTCG rule).

Supported `$type`s in v1: `color`, `dimension`, `fontFamily`, `fontWeight`, `number`, `duration`.

- `color` `$value`: a hex string `#RRGGBB` or `#RRGGBBAA` (the neutral form every platform can
  express). *(Builder's call: also accepting the DTCG 2025 color object `{colorSpace, components,
  alpha, hex}` by reading its `hex`/`alpha`.)*
- `dimension` `$value`: `{ "value": 8, "unit": "px" | "rem" }` (current DTCG form). *(Builder's call:
  also accept the older `"8px"` string.)*
- **Aliases**: a `$value` of `"{color.brand.primary}"` references another token. Cycles and missing
  targets are errors.

Tokens are **not individually versioned or tagged**. Token drift is caught by: stale generated files,
broken token references in components, and hardcoded literals (all below).

Bootstrapping from an existing DTCG/Style Dictionary JSON is just copying it into `tokens/`; a
convenience `antidrift import tokens <file>` that validates and copies is in scope.

#### Component specs

```json
{
  "id": "pagar_button",
  "version": 1,
  "hash": "",
  "title": "Pagar button",
  "summary": "Primary pay action at checkout.",
  "variants": ["primary", "secondary"],
  "states": ["default", "pressed", "disabled", "loading"],
  "styles": {
    "primary": {
      "default":  { "background": "{color.brand.primary}", "text": "{color.on-brand}", "radius": "{radius.md}" },
      "pressed":  { "background": "{color.brand.primary-pressed}" },
      "disabled": { "background": "{color.neutral.300}", "text": "{color.neutral.600}" }
    },
    "secondary": {
      "default": { "background": "{color.transparent}", "text": "{color.brand.primary}", "radius": "{radius.md}" }
    }
  }
}
```

- `styles[variant][state][property]` = a token reference. **References only** — no raw literals
  (`transparent` is a token too).
- **Inheritance:** a state block merges over that variant's `default`; an omitted state is the
  variant's `default`. So `primary.disabled.radius` resolves to `{radius.md}`.
- `default` must be present in `states`, and every variant must have a `default` block.
- Property names are free-form (`background`, `text`, `border`, `radius`, `paddingX`, `fontSize`…);
  the README recommends a small vocabulary but nothing enforces it.
- `version`/`hash` behave exactly like entities: hash over `{variants, states, styles}`; `hash: ""`
  stamps without bumping; any spec change bumps. A token **value** change does not touch the component.
- **Ids are unique across entities and components** (shared tag namespace); a clash is an error.

### Tags in code

Existing entity tags are unchanged (`antidrift #student@3`). Two new forms:

- **Implementation:** `antidrift impl #pagar_button@3` — placed once in the file that implements the
  component (web DS component, Flutter widget). Stale when `3 <` current version; orphan when the
  component doesn't exist.
- **Use:** `antidrift use #pagar_button:primary` (variant optional: `antidrift use #pagar_button`) —
  placed where a screen uses the component. **Unversioned** *(my call)*: uses depend on the
  implementation's API, not on token mappings, so versioning them would flag every screen on every
  color tweak. Instead a use is **broken** when the component or the named variant no longer exists.

`/antidrift:tag` gains `--impl` / `--use[=variant]` to insert these.

### Generated token files

`.antidrift/ui.json`:

```json
{ "targets": [
  { "lang": "css",  "out": "apps/web/src/ds/tokens.css" },
  { "lang": "dart", "out": "apps/mobile/lib/ds/tokens.dart", "className": "DsTokens" }
] }
```

`antidrift gen-tokens` regenerates every target (or one: `gen-tokens <lang> <out>`). Each file starts
with a "Generated by antidrift from .antidrift/tokens — do not edit" header.

- **CSS:** `:root { --color-brand-primary: #1e5bff; --radius-md: 8px; }`. Aliases emit
  `var(--color-brand-primary)`.
- **Dart:** `abstract final class DsTokens { static const colorBrandPrimary = Color(0xFF1E5BFF);
  static const radiusMd = 8.0; … }`, importing `package:flutter/painting.dart`. `fontWeight` →
  `FontWeight.w600`; `duration` → `Duration(milliseconds: …)`. *(Builder's call: `rem` → logical
  pixels at 16 per rem, documented.)*
- Emitter interface: `{ lang, ext, emit(tokens, options): string }`, registered in a map like
  `EMITTERS`, so TS / Kotlin / Swift are one module each.
- Names: path segments → kebab (CSS) / lowerCamel (Dart). Generated identifiers and values must be
  injection-safe (same bar as the enums file: values come from JSON and are validated per `$type`
  before emitting).

### scan (only when the UI folders exist)

New problem kinds. All count toward the exit code **except hardcoded colors** (see below):

| Kind | Example line |
|---|---|
| stale implementation | `web/ds/PagarButton.tsx:1  impl #pagar_button@2 -> stale (current @3)` |
| orphan implementation | `… impl #old_button@1 -> orphan` |
| broken use | `app/checkout.dart:40  use #pagar_button:tertiary -> broken (no variant "tertiary")` |
| broken token ref | `#pagar_button primary.pressed.background -> {color.brand.primary-pressd} [broken-token]` |
| stale generated file | `apps/web/src/ds/tokens.css -> out of date or hand-edited (run gen-tokens)` |
| hardcoded color | `web/pay.tsx:12  #1E5BFF matches token color.brand.primary [hardcoded]` |

- **Generated-file check:** regenerate in memory and compare to the file on disk; any difference is
  stale (covers both "tokens changed" and "someone hand-edited it").
- **Hardcoded colors are warnings by default** (user decision): listed under a separate "warnings"
  heading, exit code unaffected, so adopting the module on an already-drifted app doesn't break CI.
  `ui.json` `"hardcoded": "error"` makes them count as problems once the cleanup is done.
- **Hardcoded colors:** scan UI-ish files (`css scss less html ts tsx js jsx vue svelte dart kt
  swift`), skipping `.antidrift/`, generated targets, and the usual ignores. Recognize `#RGB`,
  `#RRGGBB`, `#RRGGBBAA`, `Color(0xAARRGGBB)`, `rgb()/rgba()` with integer channels; normalize and
  match against resolved color token values. Report the matching token(s).
  Escape hatch: a line containing `antidrift-allow` is skipped *(my call — e.g. a brand color in an
  email template that must stay literal)*.
- **Skips** *(my call)*: the hardcoded check additionally skips common build/generated output
  (`build/`, `.dart_tool/`, `Pods/`, `.next/`, `*.g.dart`, `*.freezed.dart`, minified `*.min.*`), and
  `ui.json` accepts an optional `"ignore": ["glob", …]` for anything else (e.g. a legacy hand-written
  token file until it's replaced by the generated one).
- A component's own implementation files are scanned like any other file.

### Agent-facing output

- `list` shows components alongside entities, marked `[component]`, plus a one-line token count.
- `show pagar_button` prints: summary; the full variant × state matrix with every property resolved
  (`background → {color.brand.primary} = #1E5BFF`, inheritance applied); implementations (file, tagged
  version, status); uses (file:line, variant, status).
- `tokens [prefix]` prints `path  $type  value` (aliases shown with their resolved value).
- index.json: component entries are added with `"kind": "component"` (entity entries keep their shape;
  a missing `kind` means entity).

### Hook

`on-entity-change.sh` also fires for `.antidrift/components/*.json` (reconcile + report stale
implementations, like `notify`) and `.antidrift/tokens/*.json` (report which generated files are now
out of date and any broken refs). It **never writes generated files itself** *(my call: hooks report,
the agent or developer regenerates)*.

### Skill + docs

- Main `antidrift` skill: one short "Optional UI module" bullet — suggest it only while the developer
  is actually working on design-system/UI code and the module isn't set up, at most once per
  conversation, explain the three layers briefly, never set it up uninvited. No stored "declined"
  state *(my call: keeps the zero-footprint promise; the cost is one possible suggestion per
  UI-focused session)*.
- New `skills/antidrift-ui/SKILL.md`, applying when `.antidrift/tokens/` or `/components/` exists:
  read `show <component>` before building or editing an implementation; tag `impl` once per
  implementation file and `use` once per screen per component; use generated tokens, never literals;
  after editing tokens run `gen-tokens`; on a stale implementation, re-read the spec and update.
- `antidrift ui init` (and `/antidrift:ui-init`) creates `tokens/`, `components/`, a starter `ui.json`,
  and one small example token file — only when invoked.
- README: a separate "UI module (optional)" section after the entity docs.

## Constraints

- Same stack and conventions as the rest of antidrift: TypeScript/ESM, vitest, committed `dist/`,
  no new runtime dependencies unless clearly needed (DTCG parsing and the emitters are small enough to
  hand-roll).
- Existing entity behavior, tags, and outputs must not change for projects without the UI folders.
- `claude plugin validate . --strict` must keep passing.

## Left to the builder

File/module split, exact CLI output wording (keeping the examples' shape), DTCG validation details,
the recommended property vocabulary, and test structure.
