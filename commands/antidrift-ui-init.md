---
description: Turn on antidrift's optional UI module (design tokens + component specs)
allowed-tools: Bash(node:*)
---
Only run this when the user has asked for the UI module. Run `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js ui init` from the project root, show the output, then help the user point `.antidrift/ui.json` `targets` at their design-system folder(s) and run `/antidrift:gen-tokens`.
