---
description: Regenerate design-system token files (CSS, Dart) from .antidrift/tokens
allowed-tools: Bash(node:*)
argument-hint: [lang out]
---
Run `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js gen-tokens $ARGUMENTS` from the project root. With no arguments it writes every target listed in `.antidrift/ui.json`; with `<css|dart> <out>` it writes just that file. Report which files were written.
