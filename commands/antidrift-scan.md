---
description: Scan the repo for drift between tagged code and entity versions
allowed-tools: Bash(node:*)
---
Run `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js scan` from the project root and report any stale or orphan usages, broken relationships, and stale projections (entities whose `derivedFrom` base has moved on) to the user.
