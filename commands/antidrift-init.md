---
description: Bootstrap .antidrift/ and (guided) author entities for an existing project
allowed-tools: Bash(node:*)
---
Run `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js init` from the project root.

Then follow the **antidrift** skill to bootstrap an existing project: inventory the
codebase (DB schema, ORM models, TypeScript interfaces/DTOs, OpenAPI/GraphQL if present)
and author one `.antidrift/entities/<id>.json` per entity — each a valid JSON Schema, with
`version` 1 and `hash` "" (the next reconcile stamps the hash). Finish by running
`node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js list` to confirm the index.
