---
description: Insert an antidrift usage tag at a code location
allowed-tools: Bash(node:*)
argument-hint: <id> <file:line> [--impl | --use[=variant]]
---
Run `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js tag $ARGUMENTS` to insert `antidrift #<id>@<currentVersion>` (in the file's comment syntax) above the given line. With `--impl` it inserts `antidrift impl #<component>@<version>` (the file implements that UI component); with `--use` / `--use=<variant>` it inserts `antidrift use #<component>[:<variant>]` (the file places it).
