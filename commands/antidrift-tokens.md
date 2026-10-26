---
description: List antidrift design tokens with resolved values
allowed-tools: Bash(node:*)
argument-hint: [prefix]
---
Run `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js tokens $ARGUMENTS` from the project root and show the tokens (path, type, value; aliases show what they point to). A prefix like `color` or `color.brand` filters the list.
