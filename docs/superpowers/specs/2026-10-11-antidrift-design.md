# antidrift — Design Spec

Date: 2026-10-11
Status: Draft for review

## Purpose

`antidrift` makes a project's **data entities** a single source of truth that
every part of the codebase — frontend, backend, and any AI agent — refers to,
so the sides don't drift apart, and so an agent can be handed **exactly one
entity's description** without loading the whole project into context.

It ships as a **Claude Code plugin**, is **language-agnostic**, describes
entities in **JSON Schema**, and does **registry + drift-tracking only** — it
does not generate application code.

### Who it's for / success criteria
- A developer working with AI agents on a front+back project (often a monorepo).
- Success: front and back provably reference the same entity definitions; an
  agent can be given one entity file and know its exact shape; when an entity
  changes, the sites that used it are flagged and the active agent is told to
  re-check them.

### Non-goals (v1)
- Code generation (types, models, CRUD) — that's JHipster/Wasp territory.
- Semantic verification that code actually matches the schema (delegated to the
  agent re-reading the entity).
- Auto-inserting usage comments by parsing arbitrary code.
- Multi-repo, relationship graphs, a UI, migrations.
- The **design-system / UI** extension (colors, components across Flutter +
  Angular) — being researched separately; see "Future / open questions".

## Data model

A `.antidrift/` directory at the repo root:

```
.antidrift/
  index.json            # the entity index (lightweight)
  entities/
    student.json        # one file per entity: JSON Schema + metadata
    course.json
```

- **`index.json`** — what an agent reads first to learn *what entities exist*:
  ```json
  [{ "id": "student", "title": "Student", "version": 3,
     "hash": "ab12…", "summary": "A learner enrolled in courses",
     "file": "entities/student.json" }]
  ```
- **`entities/<id>.json`** — the thing you hand an agent in isolation: a JSON
  Schema describing the entity plus a small metadata header:
  ```json
  { "id": "student", "version": 3, "hash": "ab12…",
    "schema": { "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": {
                  "id": {"type":"string"},
                  "name": {"type":"string"},
                  "level": {"type":"integer"},
                  "observations": {"type":"string"} },
                "required": ["id","name"] },
    "relationships": [] }
  ```
- **Versioning:** each entity carries an integer `version` (bumped on change)
  and a content `hash`. The version is the drift signal.
- Entity files are validated as well-formed JSON Schema with **ajv**.

## Usage tagging

When code uses an entity, the line/block is marked with a comment carrying the
entity id and the version it was written against:

```ts
// antidrift #student@3
```

- Works in any language — the token `antidrift #<id>@<ver>` lives inside
  whatever comment syntax the file uses (`//`, `#`, `<!-- -->`, etc.).
- **The agent adds these tags** when it writes/edits code that uses an entity,
  guided by the bundled skill. The plugin does not auto-insert them (that would
  require understanding the code).

## Drift detection

- **Drift = a usage tag's version is lower than the entity's current version.**
  The entity changed after that code was written → the site is **stale** and
  should be revalidated.
- `antidrift` flags stale sites; it does **not** judge whether the code
  semantically matches the schema. That judgment is delegated to the agent,
  which re-reads the single entity and checks its own code. (Deterministic,
  language-agnostic, no code parsing.)

## Change notification ("block + signal", realistically)

A Claude Code **hook** watches writes under `.antidrift/`. On an entity or index
create/modify it:
1. bumps the entity's `version` and recomputes its `hash`,
2. marks all usage sites tagged at an older version as **stale**,
3. emits a **system-reminder** into the active agent's next step, e.g.
   *"`student` is now v4; 3 usage sites are stale — re-read
   `.antidrift/entities/student.json` and revalidate."*

Notification is at **between-steps granularity** (before the agent's next tool
call) — an LLM cannot be interrupted mid-generation. "Blocking files" is
implemented as **stale-flagging + a loud reminder**, not OS-level locks (hard
locks across independent agents are unreliable and fight the tooling).

## Commands (slash commands)

- **`/antidrift:list`** — print the entity index (id, title, version, 1-line
  summary). Cheap orientation for a human or an agent.
- **`/antidrift:show <id>`** — print one entity's JSON Schema + metadata + its
  current usage sites, highlighting stale ones.
- **`/antidrift:scan`** — walk the whole repo, rebuild the usage map from all
  `antidrift #id@ver` tags, and print a drift report. (Also used internally by
  the change hook.)
- **`/antidrift:init`** — bootstrap for an existing project (see below).

## Full-scan / bootstrap for existing projects

A project that has already started needs its `.antidrift/` data generated.
There are two distinct operations:

1. **Usage scan (deterministic):** `/antidrift:scan` rebuilds the usage map and
   drift report by finding every `antidrift #id@ver` tag in the repo. Pure
   plugin work; no agent needed.
2. **Entity bootstrap (agent-guided):** `/antidrift:init` creates `.antidrift/`,
   then the bundled skill instructs the agent to inventory the existing
   codebase — DB schema, ORM models, TypeScript interfaces/DTOs, OpenAPI/GraphQL
   if present — and author one `entities/<id>.json` per discovered entity, each
   at `version 1`. Inferring entities from arbitrary code requires understanding
   it, so the **agent** does the extraction; the plugin provides the structure,
   validation, and index-building. (Dedicated importers for known sources — e.g.
   a Prisma schema or an OpenAPI doc — are a natural later extension, out of v1.)

## Components (each testable in isolation)

| Unit | Responsibility | Depends on |
|---|---|---|
| **Store** | `.antidrift/` read/write; version bump + hash; index build | fs, ajv |
| **Scanner** | extract `antidrift #id@ver` tags from a file tree → usage map | fs |
| **Drift engine** | compare usage map vs store versions → stale list | Store, Scanner |
| **Commands** | `list`, `show`, `scan`, `init` — thin orchestration | Store, Scanner, Drift |
| **Hooks** | on `.antidrift/` change: reconcile versions, run drift, emit reminder | Store, Drift |
| **Skill** | teach the agent the conventions (read index first, feed single entities, tag usages, re-read on stale, bootstrap flow) | — |

## Built on (proven tools only)
- **JSON Schema** — the entity description language (the proven SSOT format).
- **ajv** — validate entity files are well-formed JSON Schema.
- **TypeScript / Node** — plugin implementation + hooks.
- No codegen dependencies in v1.

## Testing
- **Store:** version bump + hash stability; index build; ajv rejection of bad
  schemas.
- **Scanner:** tag extraction across multiple comment syntaxes; ignores
  non-tags.
- **Drift engine:** stale detection when versions differ; clean when equal.
- **Integration:** edit an entity → assert correct stale sites + reminder
  payload. Bootstrap a fixture project with no `.antidrift/` → assert `init`
  structure is created and the usage scan is empty until tags are added.

## Distribution
Claude Code plugin, published to GitHub and installable via a plugin
marketplace / `.claude/plugins`.

## MVP boundary
**In:** store (index + entity JSON Schema files with version/hash), `list` /
`show` / `scan` / `init`, scanner, drift engine, change-notify hook, skill.
**Out (later):** type generation, semantic code-vs-schema verification,
auto-inserting comments, importers for Prisma/OpenAPI/GraphQL, multi-repo,
relationship graphs, a UI.

## Future / open questions
- **Design-system extension (parallel research, not v1):** can the same
  single-source-of-truth idea cover **colors, typography, and components**
  across different frameworks (e.g. a Flutter app + an Angular back-office)?
  Tokens are likely addressable via the W3C Design Tokens spec + Style
  Dictionary; cross-framework *components* are substantially harder. A separate
  research agent is investigating; findings will decide whether this becomes a
  sibling tool or an antidrift module.
- **Importers** for known entity sources (Prisma, OpenAPI, GraphQL SDL) to make
  bootstrap less manual.
- **Optional type generation** from entity JSON Schemas, if users want it.
