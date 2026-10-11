# antidrift — Wave 2 Design Spec

Date: 2026-10-11
Status: Draft for review
Builds on: 2026-10-11-antidrift-design.md (v1 — registry + drift-tracking, shipped)

## Purpose

Wave 2 adds four features on top of the shipped v1, to make antidrift compelling before a
marketplace release. All four extend the existing `.antidrift/` store + CLI + plugin; none change
the v1 data model (entity = `{ id, version, hash, schema, title?, summary?, relationships? }`).

## Feature 1 — Robustness + `tag` helper

**Robustness (fixes v1 review's deferred minors):**
- CLI commands that need an id (`show`, `reconcile`, `notify`, and new `tag`) print the usage line
  and exit 2 when the id is missing — never a raw stack trace.
- Entity ids from the CLI are validated against the tag grammar `^[A-Za-z0-9_.-]+$`; anything else
  (e.g. `../etc/passwd`) is rejected before touching the filesystem. (Blocks path traversal.)
- `scanRepo` uses `lstatSync` (does not follow symlinks) and skips files larger than 2 MB.

**`tag` command:** `antidrift tag <id> <file>:<line>` inserts `<comment> antidrift #<id>@<version>`
as a new line immediately above `<line>`, using `<id>`'s current version and the comment syntax for
the file's extension:
- `//` — ts, tsx, js, jsx, dart, java, kt, go, rs, c, cpp, cs, swift, scala, php
- `#` — py, rb, sh, bash, yaml, yml, toml, r
- `<!-- -->` — html, xml, vue, svelte, md
- default `//`
The id must exist; the file must exist; the line must be within range.

## Feature 2 — Relationship graph + validation

`relationships: string[]` lists entity ids this entity references.
- **Validation:** a referenced id that is not in the index is a new drift status **`broken-ref`**.
  `scan` reports broken refs alongside `stale`/`orphan` (and exits non-zero). A relationship engine
  `computeBrokenRefs(entities, index)` produces these.
- **Graph in `show`:** `show <id>` prints **Relationships** (outgoing ids, each marked ok/broken)
  and **Referenced by** (incoming — entities whose `relationships` include this id).

## Feature 3 — Importers

`antidrift import <format> <file> [--out .antidrift/entities]` parses an external schema and writes
one entity file per discovered type (version 1, hash "", so the next reconcile stamps it). Each
importer is a pure function `(sourceText) => Entity[]`; the CLI writes + builds the index.

Formats:
- **json-schema** — a `.json` file. If it has `$defs`/`definitions`, one entity per definition; else
  one entity named from the file. No deps.
- **openapi** — `components.schemas`: one entity per schema; `$ref`s to other schemas become
  `relationships`. YAML or JSON (dep: `js-yaml`).
- **prisma** — a hand-rolled parser over `model X { ... }` blocks (dep-free). Scalar fields
  (`String|Int|Float|Boolean|DateTime|Json|Bytes|BigInt|Decimal`, with `?` optional / `[]` array)
  → JSON Schema properties; fields whose type is another model → `relationships`. Covered subset is
  documented; enums, composite types, and attributes beyond `?`/`[]` are ignored (noted in output).
- **graphql** — `type`/`input` definitions via the `graphql` package's parser; scalar fields →
  properties, object-type fields → `relationships`.

## Feature 4 — Type generation (pluggable emitters)

`antidrift gen-types [--lang ts] [--out <path>]` emits typed definitions from every entity schema.
- **Emitter interface:** `interface Emitter { lang: string; ext: string; emit(entities: Entity[]): string }`.
  A registry maps `lang → Emitter`. `gen-types` looks up the emitter, writes the output file,
  defaulting `--out` to `.antidrift/generated/types.<ext>`.
- **TypeScript emitter (ships now):** uses `json-schema-to-typescript` to produce one exported
  interface per entity. `lang` `ts`, `ext` `ts`.
- Other languages (Dart, etc.) are out of scope for wave 2 — the registry is the extension point.

## New dependencies
- `js-yaml` (OpenAPI YAML) · `graphql` (GraphQL SDL parsing) · `json-schema-to-typescript` (TS emitter).
- NOT `@prisma/internals` — Prisma is parsed by a lightweight in-repo parser.

## Non-goals (wave 2)
Dart/other emitters beyond TS, full Prisma grammar (enums/composite types), semantic code-vs-schema
verification, multi-repo, a UI, and the design-system (tokens/components) extension.

## Risks / decisions
- **Hand-rolled Prisma parser** covers the common scalar/optional/array/relation subset only; exotic
  schemas import partially (with a note). Chosen over a 100 MB dep.
- Importers set `hash: ""` so the first reconcile stamps without a spurious version bump (per v1).
- `gen-types` writes to `.antidrift/generated/` (a build output) — documented as regenerable.
