---
name: antidrift
description: Use when working in a repo that has an .antidrift/ folder. Entities are the single source of truth; read them before writing front/back code that touches an entity, and tag every usage.
---
# antidrift conventions

A repo with an `.antidrift/` folder uses antidrift to keep its data entities in sync across
front and back. Follow these rules whenever you touch entity-shaped code.

- **Discover entities first.** Run `/antidrift:list` (or read `.antidrift/index.json`) to see
  what exists. To work on one entity, read ONLY `.antidrift/entities/<id>.json` — do not load
  the whole store into context.
- **Tag every usage.** When you write or edit code that uses an entity, add a comment
  `antidrift #<id>@<version>` (inside the file's own comment syntax) using the entity's current
  version. Front and back must tag against the same entity id.
- **On a stale reminder.** If a hook tells you an entity changed and usage sites are stale,
  re-read `.antidrift/entities/<id>.json`, update the affected code, and bump the tag's
  `@version` to the new version.
- **Changing an entity.** Edit `.antidrift/entities/<id>.json`; the hook reconciles its version
  and flags stale usages. Never hand-edit the `version` field — the tool owns it.
- **Bootstrapping (`/antidrift:init`).** Inventory existing models / DB schema / interfaces and
  author one entity file per entity: a valid JSON Schema, `version` 1, `hash` "" (the next
  reconcile stamps the hash and keeps it at version 1).

antidrift flags drift; it does not verify that your code matches the schema. When a site is
stale, YOU re-read the entity and decide whether the code still fits.
