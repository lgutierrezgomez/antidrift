---
name: antidrift-ui
description: Use when the repo has .antidrift/tokens/ or .antidrift/components/ — design tokens and UI component specs are the source of truth for UI; read the spec before building or editing a UI component, and tag implementations and uses.
---
# antidrift UI conventions

This repo uses antidrift's UI module: **tokens** (`.antidrift/tokens/*.json`, W3C Design Tokens) hold
every color/size/font value, **component specs** (`.antidrift/components/<id>.json`) say which token
each property uses per variant × state, and code is tagged as an **implementation** or a **use**.

- **Before building or editing a UI component, read its spec.** Run `/antidrift:show <id>` — it prints
  the full variant × state matrix with tokens resolved. Don't read the whole store; `/antidrift:list`
  shows what exists, `/antidrift:tokens [prefix]` lists token values.
- **Use generated tokens, never literals.** Each design system imports its generated token file
  (paths in `.antidrift/ui.json` `targets`). Never type a color like `#1E5BFF` or `Color(0xFF1E5BFF)`
  in UI code — `scan` flags literals that match a token. If a literal truly must stay (an email
  template, a third-party constraint), add `antidrift-allow` on that line.
- **Never edit generated token files.** Edit `.antidrift/tokens/*.json`, then run
  `/antidrift:gen-tokens`. `scan` flags generated files that are out of date or hand-edited.
- **Tag the implementation once per file:** `antidrift impl #<id>@<version>` in the file that
  implements the component (one per design system). `/antidrift:tag <id> <file:line> --impl` does it.
- **Tag uses once per screen per component:** `antidrift use #<id>` or `antidrift use #<id>:<variant>`.
  `/antidrift:tag <id> <file:line> --use[=variant]` does it. Uses aren't versioned.
- **Changing a component.** Edit its spec's `variants`/`states`/`styles` (token references only, like
  `"{color.brand.primary}"`); the hook bumps the version and lists stale implementations. Never
  hand-edit `version` or `hash`. A state you leave out inherits the variant's `default`.
- **On a stale implementation.** Re-run `/antidrift:show <id>`, update that implementation to match the
  spec, then bump its `impl` tag to the current version.
- **New UI element.** Add a spec first (`"version": 1, "hash": ""`), referencing existing tokens or
  adding new ones, then implement it in each design system and tag.

antidrift flags drift; it doesn't check that an implementation looks right. When something is stale,
YOU re-read the spec and decide what the code needs.
