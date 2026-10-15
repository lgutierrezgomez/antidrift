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
