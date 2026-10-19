---
description: Show one antidrift entity's schema and its usage/drift
allowed-tools: Bash(node:*)
argument-hint: <entity-id>
---
Run `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js show $ARGUMENTS` from the project root and show the output (schema, usage sites with any stale ones highlighted, relationships, and projections: what it is derived from and what derives from it).
