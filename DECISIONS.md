# antidrift — decisions & guesses log

Judgment calls I made while building autonomously (you were AFK). Review at leisure —
nothing here blocks you. Full execution record is in `.superpowers/sdd/2026-10-11-antidrift/progress.md`.

## Guesses / rulings made
- **Git branch:** building on `master` (the default branch) of this brand-new repo (no feature branch/worktree).
  Reason: greenfield project — nothing shared to isolate from. Reversible anytime.
- **First reconcile keeps version 1 (not 2).** The plan flagged this as optional. An entity
  authored with an empty `hash` now gets *stamped* (hash filled) without bumping, so a new
  entity stays `@1` instead of jumping to `@2` — otherwise every fresh entity would make its
  first `@1` usage look stale immediately. I judged this the clearly-better UX. (store.ts `reconcileEntity`.)
- **ajv import:** used named `{ Ajv2020 as Ajv }` from `ajv/dist/2020.js`. The default import
  type-checks as "not constructable" under NodeNext (`tsc` fails) even though it runs; the named
  import is the clean fix.
- **Committing `dist/`:** un-ignored and committed the compiled output. A Claude Code plugin's
  commands/hooks call `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js`, and there's no guaranteed build
  step on install, so the repo must ship `dist/`. Alternative later: a bundler or build-on-install.

## Post-build review pass (fresh Opus reviewer)
No Critical issues; implementer rulings all verified sound; security clean (no injection).
Fixed in one pass (each TDD RED→GREEN, suite 23/23):
- **Read-only commands no longer mutate the tree:** `list`/`show`/`scan` now use a new pure
  `computeIndex` instead of `buildIndex`, so they don't rewrite `index.json` (was a CI / read-only-FS hazard).
- **Hook fails loud, not silent:** `on-entity-change.sh` now emits a diagnostic if `CLAUDE_PLUGIN_ROOT`
  is unset or the CLI produces no output, instead of dropping the drift notice silently.
- **Coverage:** added `.git`/`dist` scanner-exclusion tests and 3 behavioral hook tests.

Deferred minors (your call, none are live bugs): no file-size cap/symlink guard in scanRepo;
missing-CLI-arg prints a raw stack instead of usage; CLI id not validated vs tag grammar
(path-traversal on show/reconcile, low impact since the agent already has file read); loose hook
case-glob; a couple of thin tests. All logged in `.superpowers/sdd/2026-10-11-antidrift/progress.md`.

## Wave 2 (robustness+tag, relationships, importers, type-gen)
Shipped all four; 45 tests, clean build, pushed to GitHub. Decisions:
- **js-yaml v5 is ESM-only** — imported as `{ load as yamlLoad }` (no default export). `load()` is
  safe-by-default (default schema), despite the Python-oriented security hook warning.
- **Prisma light parser** (no `@prisma/internals`): reads **one field per line** (the enforced
  Prisma format); enums/composite types/unsupported attributes are skipped.
- **Security fixes from review:** imported schemas **strip all `$ref` nodes** (internal refs would
  crash gen-types; external `file://`/`http://` refs would leak local files via the type generator),
  and the TS emitter disables external ref resolution. Import is now **all-or-nothing** (validates
  every schema before writing any).
- **New deps:** `js-yaml`, `graphql`, `json-schema-to-typescript`.

### Deferred minors (reviewer confirmed none are live bugs; your call)
- Prisma skipped-field notes aren't surfaced in import output; GraphQL custom-scalar fields are
  dropped silently; `tag` with a target missing `:line` gives a confusing ENOENT; `entityPath`
  allows dot-only ids (`.`/`..`) — odd filenames, not traversal; the `show` incoming-relationship
  test is weak; dead `SLASH` set in comment.ts; `@types/js-yaml` v4 vs runtime v5.

## Done — publishing
- **On GitHub (private):** https://github.com/lgutierrezgomez/antidrift (wave 1 + wave 2 pushed).
- **Still your call:** flip the repo to **public** and publish to the plugin **marketplace** when ready.

## Wave 3 (field feedback from Otakin V1 — `docs/feedback/FEEDBACK-otakin-v1.md`), v0.2.0
- **Projections via `derivedFrom: { base: version }`**, not schema composition (pick/omit/extend).
  The projection keeps a plain, explicit JSON Schema; antidrift only tracks *which base version it was
  written against*. Composition would need `$ref`/merge machinery that the importer deliberately
  strips for security. `scan` exits non-zero on a stale projection; `notify` on the base names them.
  Editing `derivedFrom` doesn't bump the projection's version (only `schema` does).
- **Enums file is `<out>.enums.ts`**, a sibling of the types file, not `enums.ts` — a custom `out`
  path often sits in a source folder where a plain `enums.ts` could clobber a hand-written file.
  Constant names are `ENTITY_PROP_PATH` (array `items` and anyOf/oneOf/allOf keep the path); name
  collisions get `_2`, `_3`. Values are emitted as JSON literals, so schema content can't inject code.
- **Ajv: documented, not shipped as a helper.** antidrift is a dev-time tool; a runtime helper would
  make apps depend on it. The README snippet was compiled under NodeNext with real ajv@8 +
  ajv-formats@3 — the obvious `as typeof addFormatsModule` cast fails with TS2349; the working cast is
  `as typeof addFormatsModule.default`.
- **Cheaper tags = guidance only.** The scanner already accepts one tag per file; the skill now says
  so. Import-based usage inference was skipped (language-specific).
- **Not done:** DB-only-field guidance is docs (README + skill), not enforcement.

## Wave 4 (deferred minors from waves 1–2), v0.3.0
- **Importer enums:** Prisma `enum` blocks and GraphQL `enum` types now import as `{ enum: [...] }`
  (they feed the `*.enums.ts` file) instead of being dropped.
- **Importer notes:** importers take an optional `notes` array; whatever they still skip (Prisma
  `Unsupported(...)`/composite types, GraphQL custom scalars and interface/union fields) is listed
  under `notes:` in `import` output instead of vanishing silently.
- **`tag` target** must match `<file>:<digits>`; anything else errors with the expected form (was a
  confusing ENOENT).
- **Dot-only ids** (`.`, `..`) are rejected by `entityPath`.
- **Hook glob tightened:** only files directly in `.antidrift/entities/` (absolute or relative path)
  trigger it; `x.antidrift/…` and nested folders are ignored.
- **Cleanup:** removed the dead `SLASH` set; dropped `@types/js-yaml` (v4 types) since js-yaml v5
  ships its own; the `show` incoming-relationship test now asserts the actual referrer.

## Wave 5 (optional UI module — `docs/superpowers/specs/2026-10-26-antidrift-ui-design.md`), v0.4.0
Opt-in: nothing changes until `.antidrift/tokens/` or `.antidrift/components/` exists. Decisions:
- **Tokens are DTCG, not versioned or tagged one by one.** Token drift shows up as stale generated
  files (regenerated in memory and compared, which also catches hand edits), broken token refs in
  specs, and hardcoded colors.
- **Component specs hold token references only**; a state merges over its variant's `default`.
  `version`/`hash` work like entities (hash over variants/states/styles), so a token value change
  never flags implementations.
- **`impl` tags are versioned, `use` tags aren't** — a use is broken only when its component or
  variant disappears, so a color tweak doesn't flag every screen.
- **Hardcoded colors are warnings by default** (user decision); `"hardcoded": "error"` in `ui.json`
  makes them fail `scan`. Colors only — dimension literals match too much unrelated code. Skips
  build output, generated targets, `ignore` globs, and `antidrift-allow` lines.
- **Hook reports, never writes** generated token files.
- **Skill suggests the module at most once per conversation, only during UI work**, with no stored
  "declined" state (keeps the zero-footprint promise).
- Entity index entries keep their shape; components are added with `kind: "component"`. Component and
  entity ids share one namespace; a clash is a `scan` problem, not a crash.
- Emitters: CSS custom properties and Dart now; TS, Kotlin (Compose), Swift (SwiftUI) are one
  `TokenEmitter` module each later. Identifier collisions (e.g. `a-b` vs `aB` in Dart) are errors.

## Wave 6 (gaps from the first real-project trial on `code/security`), v0.4.0
- **Modes are multi-axis.** The trial project switches scheme (light/dark, following the OS) and
  palette independently, so a light/dark-only design would not fit. Other-mode values live in DTCG's
  `$extensions["com.antidrift.modes"]` keyed by mode names (`dark`, `dark+savile`); axes are declared
  in `ui.json`. Most specific wins; two single-axis values without their combination is an error
  (ambiguous cascade). Mode values are literals only. CSS gets attribute-selector blocks (+
  `prefers-color-scheme` for `followSystem` axes); Dart gets one full class per combination.
- **Hardcoded check skips comments** (every real-looking hit in the trial was a hex quoted in a
  comment), **test files**, and files carrying antidrift's generated header (covers ad-hoc
  `gen-tokens <lang> <out>` output). `antidrift-allow` is matched on the original line.
- **json-schema importer**: `$ref`s between `$defs` become relationships; `title`/`description` fill
  title/summary; all importers stamp the hash at import. Zod users are told to register shared
  schemas so they export as `$ref`s.
- **`show <component>` is compact** by default (other states list only what differs); `--full`
  expands. The trial's 4×3 button printed 91 lines expanded.
- **Skill: follow the mapping** — tag files that convert an entity into another shape even when they
  don't import its type (the trial missed the Flutter domain models this way).
- `ui.json` that isn't a JSON object now errors clearly (was a TypeError).
