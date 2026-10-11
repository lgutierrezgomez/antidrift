#!/usr/bin/env bash
# PostToolUse hook: if an .antidrift/entities/<id>.json was just written, reconcile +
# scan via the CLI and return the result to the agent as additionalContext.
input="$(cat)"
file="$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write((j.tool_input&&j.tool_input.file_path)||"")}catch{process.stdout.write("")}})')"
case "$file" in
  *.antidrift/entities/*.json)
    id="$(basename "$file" .json)"
    root="$(cd "$(dirname "$file")/../.." && pwd)"
    msg="$(cd "$root" && node "$CLAUDE_PLUGIN_ROOT/dist/cli.js" notify "$id" 2>/dev/null)"
    node -e 'process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:process.argv[1]}}))' "$msg"
    ;;
esac
