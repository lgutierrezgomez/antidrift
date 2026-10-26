---
description: Show one antidrift entity's schema and its usage/drift
allowed-tools: Bash(node:*)
argument-hint: <entity-or-component-id>
---
Run `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js show $ARGUMENTS` from the project root and show the output (schema, usage sites with any stale ones highlighted, relationships, and projections: what it is derived from and what derives from it). For a UI component it prints the variant × state token matrix with resolved values, its implementations (stale marked) and its uses.
