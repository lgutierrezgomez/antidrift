# antidrift

A **single-source-of-truth registry + drift tracker** for your data entities, shipped as a
**Claude Code plugin**. Describe each entity once in JSON Schema; both front and back (and any
AI agent) refer to the same definition, and antidrift flags the code that falls out of sync when
an entity changes. Language-agnostic. No code generation.

## Why

When an agent works across a front and a back, the two drift apart and the agent can't hold every
entity in context. antidrift gives each entity one versioned description an agent can be handed in
isolation, tags every place the entity is used, and tells the agent which usages went stale when a
definition changes.

## Install (Claude Code plugin)

Clone this repo into your Claude Code plugins directory (it ships compiled `dist/`, so no build
step is required):

```
git clone <repo-url> ~/.claude/plugins/antidrift
```

The plugin registers four slash commands and a change-notification hook. (For development: `npm
install && npm run build && npm test`.)

## The store: `.antidrift/`

```
.antidrift/
  index.json          # [{ id, title, version, hash, summary, file }] — read this first
  entities/
    student.json      # one entity: { id, version, hash, schema (JSON Schema), title?, summary?, relationships? }
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

## Drift

- `tag.version < entity.version` → **stale** (the entity changed after this code was written).
- tag id not in the index → **orphan** (entity was removed/renamed).
- else → **ok**.

antidrift **flags** drift; it does not verify that your code matches the schema. When a site is
stale, you re-read the one entity and decide whether the code still fits.

## Commands

| Command | What it does |
|---|---|
| `/antidrift:init` | Create `.antidrift/`; then (guided by the skill) author entities for an existing project |
| `/antidrift:list` | Print the entity index (id, version, summary) |
| `/antidrift:show <id>` | Print one entity's schema, usage sites (stale marked), and relationships (outgoing + incoming) |
| `/antidrift:scan` | Scan the repo for drift; exits non-zero on any stale/orphan usage **or broken relationship** (CI-friendly) |
| `/antidrift:tag <id> <file:line>` | Insert `#<id>@<version>` at a code location, in the file's comment syntax |
| `/antidrift:import <format> <file>` | Generate entities from a **json-schema / openapi / prisma / graphql** source |
| `/antidrift:gen-types [lang] [out]` | Emit shared types from the entity schemas (TypeScript by default) |

The CLI behind them: `node dist/cli.js <init|list|show <id>|scan|reconcile <id>|notify <id>|tag <id> <file:line>|import <format> <file>|gen-types [lang] [out]>`.

## Relationships

An entity's `relationships: ["course", ...]` lists the entity ids it references. A relationship id
that isn't a known entity is a **`broken-ref`** — reported by `scan` (and non-zero exit). `show`
prints an entity's outgoing relationships (broken ones marked) and which entities reference it.

## Importers

`import <format> <file>` bootstraps entities from an existing source — one entity per type, at
version 1:
- **json-schema** — `$defs`/`definitions`, or the whole doc as one entity.
- **openapi** — `components.schemas`; `$ref`s become relationships.
- **prisma** — `model` blocks (scalars → properties, `?`/`[]` honored, relations → relationships).
  Parsed by a light in-repo parser; enums/composite types are skipped.
- **graphql** — `type`/`input` definitions; object-typed fields become relationships.

## Type generation

`gen-types` emits shared types from the entity schemas via a pluggable emitter registry. The
**TypeScript** emitter ships (`--lang ts`, default), writing `.antidrift/generated/types.ts` — a
regenerable build output. Add emitters for other languages by registering them in the map.

## Change notification

A PostToolUse hook watches writes under `.antidrift/entities/`. When an entity changes it bumps the
version, recomputes the hash, and injects a reminder into the agent's next step — e.g.
*"#student changed to @4. 2 usage sites are now STALE — re-read .antidrift/entities/student.json
and revalidate."* Notification is between-steps (an LLM can't be interrupted mid-generation); it is
a loud reminder plus a stale list, not a file lock.

## Not in scope (v1)

Code generation, semantic code-vs-schema verification, auto-inserting comments, importers for
Prisma/OpenAPI/GraphQL, multi-repo, and the design-system (tokens/components) extension — see
`docs/superpowers/specs/2026-10-11-antidrift-design.md`.
