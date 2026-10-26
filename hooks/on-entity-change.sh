#!/usr/bin/env bash
# PostToolUse hook: if an .antidrift/{entities,components}/<id>.json or tokens/*.json was just
# written, reconcile + scan via the CLI and return the result to the agent as additionalContext.
# Never fails silently: if it cannot check drift, it says so (a dropped drift notice
# is the worst outcome for this tool).
emit() {
  node -e 'process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:process.argv[1]}}))' "$1"
}

input="$(cat)"
file="$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write((j.tool_input&&j.tool_input.file_path)||"")}catch{process.stdout.write("")}})')"

case "$file" in
  .antidrift/*/*/*|*/.antidrift/*/*/*) exit 0 ;; # nested — not a store file
  .antidrift/entities/*.json|*/.antidrift/entities/*.json) cmd=notify ;;
  .antidrift/components/*.json|*/.antidrift/components/*.json) cmd=notify ;;
  .antidrift/tokens/*.json|*/.antidrift/tokens/*.json) cmd=notify-tokens ;;
  *) exit 0 ;;
esac

id="$(basename "$file" .json)"
if [ -z "${CLAUDE_PLUGIN_ROOT:-}" ]; then
  emit "antidrift: CLAUDE_PLUGIN_ROOT is not set — cannot check drift for #$id."
  exit 0
fi
root="$(cd "$(dirname "$file")/../.." 2>/dev/null && pwd)"
if [ -z "$root" ]; then
  emit "antidrift: could not resolve the project root for #$id — skipped drift check."
  exit 0
fi
if [ "$cmd" = notify ]; then
  msg="$(cd "$root" && node "$CLAUDE_PLUGIN_ROOT/dist/cli.js" notify "$id" 2>&1)"
else
  msg="$(cd "$root" && node "$CLAUDE_PLUGIN_ROOT/dist/cli.js" notify-tokens 2>&1)"
fi
[ -z "$msg" ] && msg="antidrift: drift check for #$id produced no output (CLI error?)."
emit "$msg"
