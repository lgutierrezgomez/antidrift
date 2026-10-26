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
- **Tag every file that uses an entity — once.** When you write or edit code that uses an entity,
  add a comment `antidrift #<id>@<version>` (inside the file's own comment syntax) using the
  entity's current version. One tag per file per entity is enough; don't tag every line. Front and
  back must tag against the same entity id.
- **Follow the mapping, not just the imports.** A file that converts an entity into another shape —
  a domain model, view model, form state, mapper, DTO — breaks when the entity changes even if it
  never names the entity's type (it may only see the mapped class). Tag it too. When bootstrapping,
  start from the files that decode/encode the entity, then follow what they map it into.
- **On a stale reminder.** If a hook tells you an entity changed and usage sites are stale,
  re-read `.antidrift/entities/<id>.json`, update the affected code, and bump the tag's
  `@version` to the new version.
- **API responses and other projections.** A shape built from an entity (a response type, a list
  row, a report) is its own entity with `"derivedFrom": { "<base-id>": <base-version> }`. Never
  hand-write it in an `api.ts` without declaring it. If a hook or `scan` says a projection is stale,
  re-read the base, update the projection's `schema` if it needs to follow, then set its
  `derivedFrom.<base-id>` to the base's current version.
- **What goes in an entity.** The contract consumers rely on. Leave out DB-internal columns (join
  keys, import/dedupe keys, hashes, bookkeeping timestamps) unless a consumer reads them; put
  computed fields in the projection that exposes them. Any `schema` edit bumps the version, even
  an additive one.
- **Changing an entity.** Edit `.antidrift/entities/<id>.json`; the hook reconciles its version
  and flags stale usages. Never hand-edit the `version` field — the tool owns it.
- **Bootstrapping.** Prefer `/antidrift:import <json-schema|openapi|prisma|graphql> <file>` to
  generate entities from an existing schema automatically. Otherwise inventory existing models /
  DB schema / interfaces and author one entity file per entity: a valid JSON Schema, `version` 1,
  `hash` "" (the next reconcile stamps the hash and keeps it at version 1).
- **Relationships.** An entity may list referenced entity ids in `relationships`. A ref to a
  missing entity is a `broken-ref` (flagged by `scan`). Use `/antidrift:show <id>` to see outgoing
  and incoming relationships.
- **Inserting a tag.** `/antidrift:tag <id> <file:line>` adds the usage comment for you in the
  file's comment syntax, using the entity's current version.
- **Shared types.** `/antidrift:gen-types` emits types from the schemas so front and back import
  identical definitions, plus a values-only `*.enums.ts`. Front-end code that needs only enum values
  imports the enums file — never the validator. For runtime validation, use Ajv's 2020-12 build
  (`Ajv2020` from `ajv/dist/2020.js`); see the README's "Validating at runtime" section.

- **Optional UI module.** antidrift can also track design tokens and UI component specs (spec →
  implementations per design system → uses). It's opt-in and opinionated. If `.antidrift/tokens/` and
  `.antidrift/components/` don't exist and the developer is actively working on design-system or UI
  code, you may suggest it **once per conversation** in two or three sentences (one spec per UI
  element with its variants/states/tokens, implementations tagged per design system, uses tagged per
  screen, token files generated for each platform, hardcoded colors flagged). Never set it up unless
  they say yes; then run `/antidrift:ui-init`. Don't suggest it during unrelated work.

antidrift flags drift; it does not verify that your code matches the schema. When a site is
stale, YOU re-read the entity and decide whether the code still fits.
