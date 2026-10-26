# antidrift

A **single-source-of-truth registry + drift tracker** for your data entities, shipped as a
**Claude Code plugin**. Describe each entity once in JSON Schema; both front and back (and any
AI agent) refer to the same definition, and antidrift flags the code that falls out of sync when
an entity changes. Language-agnostic. Type generation is opt-in (`gen-types`); nothing else is generated.

## Why

When an agent works across a front and a back, the two drift apart and the agent can't hold every
entity in context. antidrift gives each entity one versioned description an agent can be handed in
isolation, tags every place the entity is used, and tells the agent which usages went stale when a
definition changes.

## Install (Claude Code plugin)

One step, on Claude Code 2.1.275 or later:

```
/plugin install antidrift --marketplace lgutierrezgomez/antidrift
```

Or the two-step form (any version):

```
/plugin marketplace add lgutierrezgomez/antidrift
/plugin install antidrift@antidrift
```

It ships compiled `dist/`, so there's no build step on install. The plugin registers the slash
commands below, a change-notification hook, and a skill. (For development: `npm install && npm run
build && npm test`.)

## The store: `.antidrift/`

```
.antidrift/
  index.json          # [{ id, title, version, hash, summary, file }] — read this first
  entities/
    student.json      # one entity: { id, version, hash, schema (JSON Schema), title?, summary?, relationships?, derivedFrom? }
```

- `version` is an integer starting at **1**, bumped only when the entity's `schema` changes.
- `hash` is a content hash of `schema`. Author a new entity with `"hash": ""`; the next reconcile
  **stamps** the hash and keeps it at version 1.
- `schema` must be valid JSON Schema (draft 2020-12); invalid schemas are rejected.

## Tagging usages

When code uses an entity, mark it with a comment — in whatever comment syntax the file uses:

```ts
// antidrift #student@3
```

```python
# antidrift #student@3
```

The agent adds these (see the bundled `antidrift` skill). Both front and back tag against the same
entity id and version.

**One tag per file per entity is enough.** A tag marks "this file depends on `#student@3`", not each
line that touches it — put it once near the top (or at the main type/handler) and the scan has
everything it needs.

## Drift

- `tag.version < entity.version` → **stale** (the entity changed after this code was written).
- tag id not in the index → **orphan** (entity was removed/renamed).
- else → **ok**.

- projection whose base moved past its `derivedFrom` version → **stale** projection (see below).

antidrift **flags** drift; it does not verify that your code matches the schema. When a site is
stale, you re-read the one entity and decide whether the code still fits.

## Commands

| Command | What it does |
|---|---|
| `/antidrift:init` | Create `.antidrift/`; then (guided by the skill) author entities for an existing project |
| `/antidrift:list` | Print the entity index (id, version, summary) |
| `/antidrift:show <id>` | Print one entity's schema, usage sites (stale marked), relationships (outgoing + incoming), and projections (`derivedFrom` both ways) |
| `/antidrift:scan` | Scan the repo for drift; exits non-zero on any stale/orphan usage, **broken relationship, or stale projection** (CI-friendly) |
| `/antidrift:tag <id> <file:line>` | Insert `#<id>@<version>` at a code location, in the file's comment syntax |
| `/antidrift:import <format> <file>` | Generate entities from a **json-schema / openapi / prisma / graphql** source |
| `/antidrift:gen-types [lang] [out]` | Emit shared types from the entity schemas (TypeScript by default), plus a values-only `*.enums.ts` |

The CLI behind them: `node dist/cli.js <init|list|show <id>|scan|reconcile <id>|notify <id>|tag <id> <file:line>|import <format> <file>|gen-types [lang] [out]>`.

## Relationships

An entity's `relationships: ["course", ...]` lists the entity ids it references. A relationship id
that isn't a known entity is a **`broken-ref`** — reported by `scan` (and non-zero exit). `show`
prints an entity's outgoing relationships (broken ones marked) and which entities reference it.

## Projections (API responses and other derived shapes)

The shapes that drift in practice are usually not the stored entities but the **projections** of
them — API response types like `NearbyPlace` or `PlaceDetail` that pick, rename, or add fields. Declare
each one as its own entity and record which base entity versions it was written against:

```json
{
  "id": "nearbyPlace",
  "version": 1,
  "hash": "",
  "derivedFrom": { "place": 1 },
  "schema": { "type": "object", "properties": { "id": { "type": "string" }, "name": { "type": "string" }, "distanceM": { "type": "number" } } }
}
```

Tag the code that builds or consumes the response with `#nearbyPlace@1` as usual. When `place` moves
to `@2`, the change notification and `scan` both flag `#nearbyPlace` as a **stale projection**. Re-read
`place`, update the projection's schema if it needs to follow (which bumps `nearbyPlace` and makes its
own usage sites stale), then set `derivedFrom.place` to `2`. Editing `derivedFrom` alone never bumps
the projection's version — only its `schema` does.

## What belongs in an entity

An entity describes the **contract** — the shape other code (and other agents) rely on.

- **Include** fields any consumer reads or writes: what crosses the API, what the front renders, what
  validation enforces.
- **Leave out DB-internal columns** — surrogate keys used only for joins, dedupe/import keys, content
  hashes, `updated_at`-style bookkeeping — unless some consumer depends on them. Keeping them out means
  internal migrations don't make every usage site stale.
- **Derived/computed fields** (distance, counts, display labels) belong in the projection that exposes
  them, not in the base entity.
- **When the version bumps:** any edit to `schema` bumps it — even an additive field — because an agent
  should re-check code that might need to use it. Edits to `title`, `summary`, `relationships`, or
  `derivedFrom` don't.

## Validating at runtime (Ajv)

Entity schemas are JSON Schema **2020-12**, so validate them with Ajv's 2020 build — Ajv's default
export is draft-07 and will reject them:

```ts
import { Ajv2020 } from 'ajv/dist/2020.js'; // named import works under moduleResolution: NodeNext
import addFormatsModule from 'ajv-formats';
import type { ValidateFunction } from 'ajv';
import place from '../.antidrift/entities/place.json' with { type: 'json' };

// ajv-formats is CommonJS; under NodeNext its default import is the module object, not the function.
const addFormats = ((addFormatsModule as any).default ?? addFormatsModule) as typeof addFormatsModule.default;

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv); // needed for format: uuid / email / uri / date-time

// Compile lazily, on first use — not at import time — so importing this module stays cheap.
const cache = new Map<object, ValidateFunction>();
export const validatorFor = (schema: object) => {
  let v = cache.get(schema);
  if (!v) cache.set(schema, (v = ajv.compile(schema)));
  return v;
};
export const validatePlace = (data: unknown) => validatorFor(place.schema)(data);
```

Keep the validator **server-side**. Front-end code that only needs enum values should import the
generated `*.enums.ts` (below), which has no dependencies — otherwise Ajv and every schema end up in the
browser bundle.

## Importers

`import <format> <file>` bootstraps entities from an existing source — one entity per type, at
version 1:
- **json-schema** — `$defs`/`definitions`, or the whole doc as one entity.
- **openapi** — `components.schemas`; `$ref`s become relationships.
- **prisma** — `model` blocks (scalars → properties, `?`/`[]` honored, relations → relationships,
  `enum` blocks → `{ "enum": [...] }`). Parsed by a light in-repo parser; composite and
  `Unsupported(...)` types are skipped.
- **graphql** — `type`/`input` definitions; object-typed fields become relationships, `enum` types
  become `{ "enum": [...] }`. Custom scalars and interface/union fields are skipped.

Anything an importer skips is listed under `notes:` in the import output, so you can add it by hand.

## Type generation

`gen-types` emits shared types from the entity schemas via a pluggable emitter registry. The
**TypeScript** emitter ships (`--lang ts`, default), writing `.antidrift/generated/types.ts` — a
regenerable build output — plus a sibling **`types.enums.ts`** (or `<out>.enums.ts`) with every `enum`
in the schemas as an `as const` array and its union type, e.g.
`export const PLACE_PLACE_TYPE = ["restaurant","bar"] as const;`. It has no imports, so front-end code
can use the values without pulling in types tooling or a validator. Add emitters for other languages by registering them in the map.

## Change notification

A PostToolUse hook watches writes under `.antidrift/entities/`. When an entity changes it bumps the
version, recomputes the hash, and injects a reminder into the agent's next step — e.g.
*"#student changed to @4. 2 usage sites are now STALE — re-read .antidrift/entities/student.json
and revalidate."* Notification is between-steps (an LLM can't be interrupted mid-generation); it is
a loud reminder plus a stale list, not a file lock.

## Transparency — what it runs

antidrift runs **entirely on your machine** and makes **no network calls and sends no telemetry** —
nothing leaves your computer.

- The slash commands and the PostToolUse hook invoke a local Node CLI (`dist/cli.js`) over your
  repo's files only.
- `gen-types` uses `json-schema-to-typescript` with external reference resolution **disabled**
  (`$refOptions.resolve.file/http = false`), so it never reads files outside your schemas or makes
  HTTP requests; imported schemas also have all `$ref`s stripped.
- Runtime dependencies (`ajv`, `js-yaml`, `graphql`, `json-schema-to-typescript`) are installed from
  the committed `package-lock.json` on install.
- The repo ships both the TypeScript **source** (`src/`) and its compiled output (`dist/`, committed
  so the plugin runs with no build step).

## Not in scope (v1)

Generating application code (beyond the opt-in shared types from `gen-types`), semantic
code-vs-schema verification, auto-inserting comments without the agent, multi-repo, and the
design-system (tokens/components) extension — see
`docs/superpowers/specs/2026-10-11-antidrift-design.md`. (Importers, relationships, `tag`, and
`gen-types` shipped in wave 2 — `docs/superpowers/specs/2026-10-11-antidrift-wave2-design.md`.)
