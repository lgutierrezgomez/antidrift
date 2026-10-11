---
description: Insert an antidrift usage tag at a code location
allowed-tools: Bash(node:*)
argument-hint: <entity-id> <file:line>
---
Run `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js tag $ARGUMENTS` to insert `antidrift #<id>@<currentVersion>` (in the file's comment syntax) above the given line.
