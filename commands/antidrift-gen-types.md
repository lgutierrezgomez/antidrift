---
description: Generate shared types from the entity schemas
allowed-tools: Bash(node:*)
argument-hint: "[lang=ts] [out-path]"
---
Run `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js gen-types $ARGUMENTS` to emit typed definitions (TypeScript by default) from every entity's JSON Schema, so front and back import identical types. Default output: `.antidrift/generated/types.ts`, plus a values-only sibling `types.enums.ts` (every schema `enum` as an `as const` array) that front-end code can import without a validator.
