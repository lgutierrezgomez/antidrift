---
description: Generate antidrift entities from an external schema
allowed-tools: Bash(node:*)
argument-hint: <json-schema|openapi|prisma|graphql|tokens> <file>
---
Run `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js import $ARGUMENTS` to create one entity file per type from a JSON Schema, OpenAPI, Prisma, or GraphQL SDL source, then report what was imported, including any `notes:` about fields the importer skipped (add those by hand if they matter). `tokens` validates a W3C Design Tokens JSON file against the existing tokens and copies it into `.antidrift/tokens/`.
