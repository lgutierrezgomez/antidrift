# antidrift UI module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in UI module to antidrift: DTCG design tokens as the source of truth (generated into CSS and Dart token files), versioned component specs mapping tokens per variant × state, `impl`/`use` tags, and `scan` checks for stale implementations, broken uses/refs, stale generated files, and hardcoded colors (warnings).

**Architecture:** New code lives in `src/ui/` (tokens, token emitters, config, components, tags, hardcoded detection, ui scan), each a focused module. `src/cli.ts` wires commands; existing entity behavior is untouched when `.antidrift/tokens/` and `.antidrift/components/` don't exist. No new runtime dependencies (DTCG parsing, emitters and glob matching are hand-rolled).

**Tech Stack:** TypeScript (ESM, NodeNext, strict), vitest, Node `fs`. Existing helpers: `computeHash`, `ID_RE`, `storeDir` (`src/store.ts`), `commentSyntax` (`src/comment.ts`).

**Spec:** `docs/superpowers/specs/2026-10-26-antidrift-ui-design.md`

## Global Constraints

- Projects without `.antidrift/tokens/` and `.antidrift/components/` see **no** change in any command's output or exit code.
- No new runtime dependencies. Don't use `path.matchesGlob` (Node-version dependent); hand-roll the glob.
- Supported token `$type`s: `color`, `dimension`, `fontFamily`, `fontWeight`, `number`, `duration`.
- Component style values are token references only: `"{a.b.c}"`.
- Hardcoded colors are **warnings** (exit code unaffected) unless `ui.json` has `"hardcoded": "error"`.
- Hooks never write generated files.
- Generated output must be injection-safe: validate values per `$type` before emitting.
- Each new source file ships compiled in `dist/` (run `npm run build` before committing; `dist/` is committed).
- `claude plugin validate . --strict` passes at the end; version becomes `0.4.0` in `package.json` and `.claude-plugin/plugin.json`.

## Review Focus

1. A token file that is invalid JSON or has an unknown `$type`: every command that touches tokens must fail with a message naming the file/path, not a stack trace. → Task 1 test `loadTokens names the file on bad JSON`.
2. A hex literal inside unrelated text (`issue #123`, `&#123;`, a CSS id selector `#fade00`): it's only flagged if it equals a token color, and HTML entities are never matched. → Task 5 test `findColorLiterals ignores html entities`.
3. Two token paths that sanitize to the same identifier (`color.a-b` and `color.aB` in Dart): generation must error, not emit a duplicate `static const`. → Task 2 test `dart emitter rejects identifier collisions`.
4. A component id that is also an entity id: scan reports `[id-clash]` and the commands keep working. → Task 4 test `computeIndex includes components; clash is reported, not thrown`.
5. `ui.json` target whose `out` file doesn't exist yet: scan reports it as stale ("run gen-tokens"), it doesn't crash. → Task 3 test `staleTargets treats a missing file as stale`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/ui/tokens.ts` (new) | Load + merge `.antidrift/tokens/*.json`, validate DTCG, resolve aliases |
| `src/ui/token-emitters.ts` (new) | `TokenEmitter` interface, CSS + Dart emitters, `TOKEN_EMITTERS` map |
| `src/ui/config.ts` (new) | Read `ui.json`, `uiEnabled`, glob → RegExp, `generateTarget`, `staleTargets` |
| `src/ui/components.ts` (new) | Component type, read/validate/write/reconcile, resolve matrix, broken token refs |
| `src/ui/tags.ts` (new) | Parse `impl` / `use` tags |
| `src/ui/hardcoded.ts` (new) | Find color literals in a line, normalize, match to tokens |
| `src/ui/scan.ts` (new) | One walk producing impl/use/hardcoded findings; `computeUiScan` |
| `src/scanner.ts` | Export `walkFiles` (extract existing walk) |
| `src/store.ts` | `computeIndex` includes components with `kind` |
| `src/types.ts` | `IndexEntry.kind?` |
| `src/cli.ts` | New commands + scan/show/list/tag/notify/import integration |
| `hooks/on-entity-change.sh` | Also react to components/ and tokens/ |
| `commands/*.md`, `skills/antidrift-ui/SKILL.md`, `skills/antidrift/SKILL.md`, `README.md`, `DECISIONS.md` | Docs |

---

### Task 1: Token store (load, merge, validate, resolve)

**Files:**
- Create: `src/ui/tokens.ts`
- Test: `tests/ui-tokens.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type TokenType = 'color' | 'dimension' | 'fontFamily' | 'fontWeight' | 'number' | 'duration';
  export type TokenValue =
    | { type: 'color'; hex: string }                       // normalized '#RRGGBBAA', uppercase
    | { type: 'dimension'; value: number; unit: 'px' | 'rem' }
    | { type: 'fontFamily'; families: string[] }
    | { type: 'fontWeight'; weight: number }               // 1–1000
    | { type: 'number'; value: number }
    | { type: 'duration'; ms: number };
  export interface Token { path: string; type: TokenType; value: TokenValue; aliasOf?: string; description?: string; file: string }
  export const tokensDir: (root: string) => string;        // .antidrift/tokens
  export function parseTokenTree(doc: unknown, file: string): Array<{ path: string; type?: TokenType; raw: unknown; description?: string }>;
  export function loadTokens(root: string): Map<string, Token>;   // empty Map if dir missing
  export function resolveTokenTree(entries: ReturnType<typeof parseTokenTree>): Map<string, Token>;
  ```

Rules (from spec): groups are objects without `$value`; a token has `$value`; `$type` on a group is inherited by descendants; keys starting with `$` are metadata. Paths join keys with `.`; each segment must match `/^[A-Za-z0-9_-]+$/`. Same path in two files → error naming both files. Alias `"{x.y}"` → token takes target's type and value, `aliasOf: 'x.y'`; missing target or cycle → error. Values: color `#RRGGBB`/`#RRGGBBAA` (or DTCG object with `hex` and optional `alpha` 0–1); dimension `{value, unit}` or `"8px"`/`"0.5rem"`; fontFamily string or string[], each name matching `/^[A-Za-z0-9 _-]+$/`; fontWeight number 1–1000 or keyword (`thin`100 `extra-light`200 `light`300 `normal`/`regular`400 `medium`500 `semi-bold`600 `bold`700 `extra-bold`800 `black`900); number finite; duration `{value, unit:'ms'|'s'}` or `"200ms"`/`"0.2s"`. All errors are `Error` with message containing the token path (and file when known).

- [ ] **Step 1: Write the failing tests** in `tests/ui-tokens.test.ts` (temp root via `mkdtempSync`, files under `.antidrift/tokens/`):
  - `loadTokens returns empty map without tokens dir` → `size === 0`.
  - `inherits group $type and normalizes colors`: `{ color: { $type: 'color', brand: { primary: { $value: '#1e5bff' } } } }` → `get('color.brand.primary').value` equals `{ type: 'color', hex: '#1E5BFFFF' }`.
  - `parses dimension object and string forms`: `{value:8,unit:'px'}` and `'0.5rem'` → `{type:'dimension',value:8,unit:'px'}`, `{…,value:0.5,unit:'rem'}`.
  - `resolves aliases`: `on-brand: { $value: '{color.brand.primary}' }` → `aliasOf === 'color.brand.primary'`, same `hex`.
  - `rejects missing alias target` → throws `/color\.nope/`.
  - `rejects alias cycles` (a→b→a) → throws `/cycle/i`.
  - `rejects the same path in two files` → throws with both file names.
  - `rejects unsafe fontFamily names`: `'Inter"; } body {'` → throws.
  - `fontWeight keywords map to numbers`: `'semi-bold'` → `600`.
  - `loadTokens names the file on bad JSON` → throws matching the file name.
- [ ] **Step 2: Run** `npx vitest run tests/ui-tokens.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `src/ui/tokens.ts` per the interface and rules above. `loadTokens` reads `*.json` in `tokensDir` sorted by name, calls `parseTokenTree` per file, concatenates, then `resolveTokenTree`.
- [ ] **Step 4: Run** `npx vitest run tests/ui-tokens.test.ts` — Expected: PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `git add src/ui/tokens.ts tests/ui-tokens.test.ts && git commit -m "feat(ui): DTCG token store with alias resolution"`

### Task 2: Token emitters (CSS, Dart)

**Files:**
- Create: `src/ui/token-emitters.ts`
- Test: `tests/ui-token-emitters.test.ts`

**Interfaces:**
- Consumes: `Token`, `TokenValue` (Task 1).
- Produces:
  ```ts
  export interface TokenEmitterOptions { className?: string }
  export interface TokenEmitter { lang: string; ext: string; emit(tokens: Map<string, Token>, opts?: TokenEmitterOptions): string }
  export const GENERATED_HEADER = 'Generated by antidrift from .antidrift/tokens — do not edit.';
  export const cssTokenEmitter: TokenEmitter;   // lang 'css', ext 'css'
  export const dartTokenEmitter: TokenEmitter;  // lang 'dart', ext 'dart'
  export const TOKEN_EMITTERS: Map<string, TokenEmitter>;
  ```

Output is deterministic (tokens sorted by path). CSS: `/* ${GENERATED_HEADER} */\n:root {\n  --color-brand-primary: #1e5bff;\n}\n` — name is path segments joined with `-`; color `#rrggbb` lowercase when alpha is `FF`, else `#rrggbbaa`; dimension `8px`/`0.5rem`; fontFamily comma-joined, each name double-quoted; fontWeight/number plain; duration `200ms`; an alias emits `var(--target-name)`. Dart: `// ${GENERATED_HEADER}\nimport 'package:flutter/painting.dart';\n\nabstract final class ${className ?? 'DsTokens'} {\n  static const colorBrandPrimary = Color(0xFF1E5BFF);\n …}\n` — name is lowerCamel of all segments split on `.`/`-`/`_` (prefix `t` if it starts with a digit; append `Token` if it's a Dart reserved word); color `Color(0xAARRGGBB)`; dimension `8.0` (px) or `rem*16` as double; fontFamily first family as a single-quoted string `'Inter'`; fontWeight `FontWeight.w600` (rounded to the nearest 100, clamped 100–900); number as double literal; duration `Duration(milliseconds: 200)`; aliases emit the target's identifier. Two paths producing the same identifier in either emitter → throw naming both paths.

- [ ] **Step 1: Write the failing tests** (build token maps with `resolveTokenTree(parseTokenTree(doc, 'x.json'))`):
  - `css emits root variables with header`: color + `radius.md` 8px → output contains `GENERATED_HEADER`, `--color-brand-primary: #1e5bff;`, `--radius-md: 8px;`.
  - `css keeps alpha and emits var() for aliases`: `#1E5BFF80` → `#1e5bff80`; alias → `--color-on-brand: var(--color-brand-primary);`.
  - `dart emits a final class with typed constants`: contains `abstract final class DsTokens`, `static const colorBrandPrimary = Color(0xFF1E5BFF);`, `static const radiusMd = 8.0;`, `FontWeight.w600`, `Duration(milliseconds: 200)`; `className: 'AppTokens'` changes the class name.
  - `dart converts rem at 16px`: `0.5rem` → `8.0`.
  - `dart rejects identifier collisions`: `color.a-b` and `color.aB` → throws naming both.
  - `emitters are deterministic`: same input in different insertion order → identical output.
- [ ] **Step 2: Run** `npx vitest run tests/ui-token-emitters.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `src/ui/token-emitters.ts`.
- [ ] **Step 4: Run** the test file — Expected: PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `git commit -m "feat(ui): CSS and Dart token emitters"`

### Task 3: ui.json config, gen-tokens, generated-file staleness

**Files:**
- Create: `src/ui/config.ts`
- Modify: `src/cli.ts` (add `cmdGenTokens`, `gen-tokens` case, USAGE)
- Test: `tests/ui-config.test.ts`

**Interfaces:**
- Consumes: `loadTokens` (T1), `TOKEN_EMITTERS` (T2).
- Produces:
  ```ts
  export interface UiTarget { lang: string; out: string; className?: string }
  export interface UiConfig { targets: UiTarget[]; ignore: string[]; hardcoded: 'warn' | 'error' }
  export const uiConfigPath: (root: string) => string;          // .antidrift/ui.json
  export function uiEnabled(root: string): boolean;              // tokens/ or components/ exists
  export function readUiConfig(root: string): UiConfig;          // defaults {targets:[],ignore:[],hardcoded:'warn'} if file missing; throws on invalid lang/hardcoded
  export function globToRegExp(glob: string): RegExp;            // '**/' any dirs, '*' no '/', '?' one char; matched against repo-relative POSIX paths
  export function generateTarget(root: string, t: UiTarget, tokens?: Map<string, Token>): string;
  export function staleTargets(root: string, cfg?: UiConfig): UiTarget[];   // file missing or content !== generateTarget(...)
  // cli.ts
  export function cmdGenTokens(root: string, lang?: string, out?: string): string;  // no args → all targets; returns 'wrote <a>, <b>' or a hint when there are no targets
  ```

- [ ] **Step 1: Write the failing tests:**
  - `readUiConfig defaults when ui.json is missing` → `{targets:[],ignore:[],hardcoded:'warn'}`.
  - `readUiConfig rejects unknown lang` (`lang:'cobol'`) → throws `/cobol/`.
  - `globToRegExp`: `'legacy/**/colors.dart'` matches `legacy/a/b/colors.dart` and `legacy/colors.dart`; `'*.css'` matches `a.css` not `x/a.css`; `'**/*.css'` matches `x/a.css`.
  - `cmdGenTokens writes every target and creates folders`: two targets (css, dart) → both files exist and start with the header comment.
  - `cmdGenTokens with lang+out writes just that file`.
  - `staleTargets treats a missing file as stale`; after `cmdGenTokens` → `[]`; after appending `/* x */` to the css file → that target; after changing a token value → both targets.
- [ ] **Step 2: Run** `npx vitest run tests/ui-config.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `src/ui/config.ts`; in `cli.ts` add `cmdGenTokens` and the `gen-tokens` switch case (`gen-tokens [lang] [out]`, `out` relative to cwd); target `out` paths in `ui.json` resolve against `root`.
- [ ] **Step 4: Run** test file — PASS; full `npx vitest run` — all pass.
- [ ] **Step 5: Commit** `git commit -m "feat(ui): ui.json targets, gen-tokens, stale generated-file detection"`

### Task 4: Component specs

**Files:**
- Create: `src/ui/components.ts`
- Modify: `src/types.ts` (`IndexEntry.kind?: 'entity' | 'component'`), `src/store.ts` (`computeIndex`)
- Test: `tests/ui-components.test.ts`

**Interfaces:**
- Consumes: `computeHash`, `ID_RE`, `storeDir` (store.ts); `Token` (T1).
- Produces:
  ```ts
  export interface Component {
    id: string; version: number; hash: string; title?: string; summary?: string;
    variants: string[]; states: string[];
    styles: Record<string, Record<string, Record<string, string>>>;   // variant → state → property → "{token.path}"
  }
  export const componentsDir: (root: string) => string;
  export const componentPath: (root: string, id: string) => string;   // same id validation as entityPath
  export function listComponentIds(root: string): string[];
  export function readComponent(root: string, id: string): Component;
  export function validateComponent(c: Component): void;   // throws with the offending slot
  export function writeComponent(root: string, c: Component): void;  // validates; throws if an entity with the same id exists
  export function reconcileComponent(root: string, id: string): Component;  // same stamp/bump rules as reconcileEntity; hash over {variants, states, styles}
  export interface ResolvedSlot { ref: string; value: TokenValue | null }
  export function resolveMatrix(c: Component, tokens: Map<string, Token>): Record<string, Record<string, Record<string, ResolvedSlot>>>;  // every variant × every state, inheritance applied
  export interface BrokenTokenRef { component: string; slot: string; ref: string }   // slot 'primary.pressed.background'
  export function brokenTokenRefs(c: Component, tokens: Map<string, Token>): BrokenTokenRef[];
  ```
- `computeIndex` returns entity entries with `kind: 'entity'` followed by component entries `{ id, title, version, hash, summary, file: 'components/<id>.json', kind: 'component' }`. It must not throw on an id clash.

Validation (spec): `states` includes `'default'`; every variant has a `default` block; `styles` keys ⊆ `variants`, state keys ⊆ `states`; values match `/^\{[A-Za-z0-9_.-]+\}$/`. Inheritance: state block merged over the variant's `default`; omitted state = `default`.

- [ ] **Step 1: Write the failing tests** using the spec's `pagar_button` example:
  - `validateComponent rejects a raw literal` (`background: '#fff'`) → throws `/primary\.default\.background/`.
  - `validateComponent requires default state and default blocks`.
  - `reconcileComponent stamps then bumps`: `hash:''` → stays `@1` with hash; edit `styles` → `@2`.
  - `resolveMatrix applies inheritance`: `primary.disabled.radius.ref === '{radius.md}'`; `primary.loading` equals `primary.default` resolved; values resolved from tokens.
  - `brokenTokenRefs finds a typo'd ref` → `[{component:'pagar_button', slot:'primary.pressed.background', ref:'{color.brand.primary-pressd}'}]`.
  - `writeComponent refuses an id used by an entity`.
  - `computeIndex includes components; clash is reported, not thrown`: entity file and component file both `x` (written directly with `writeFileSync`) → `computeIndex` returns two entries, kinds `entity` and `component`.
  - existing `tests/store.test.ts` still passes (entity entries now carry `kind: 'entity'` — update any `toEqual` on index entries if needed).
- [ ] **Step 2: Run** `npx vitest run tests/ui-components.test.ts` — FAIL.
- [ ] **Step 3: Implement** `src/ui/components.ts` and the `computeIndex`/`IndexEntry` changes.
- [ ] **Step 4: Run** full `npx vitest run` — all pass; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `git commit -m "feat(ui): versioned component specs with token matrix"`

### Task 5: UI tags and hardcoded-color detection

**Files:**
- Create: `src/ui/tags.ts`, `src/ui/hardcoded.ts`
- Modify: `src/scanner.ts` (extract and export `walkFiles`; `scanRepo` uses it, behavior unchanged)
- Test: `tests/ui-tags.test.ts`, `tests/ui-hardcoded.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // scanner.ts
  export function walkFiles(root: string, skip?: (rel: string, isDir: boolean) => boolean): Generator<{ path: string; rel: string }>;
  // tags.ts
  export interface ImplTag { id: string; version: number; file: string; line: number }
  export interface UseTag { id: string; variant?: string; file: string; line: number }
  export function parseUiTags(content: string, file: string): { impls: ImplTag[]; uses: UseTag[] };
  // hardcoded.ts
  export interface ColorLiteral { raw: string; hex: string; column: number }   // hex normalized '#RRGGBBAA'
  export function findColorLiterals(line: string): ColorLiteral[];
  export const UI_EXTENSIONS: Set<string>;   // css scss less html ts tsx js jsx vue svelte dart kt swift
  export const BUILD_SKIP_DIRS: Set<string>; // build .dart_tool Pods .next
  export function isGeneratedFile(rel: string): boolean;   // *.g.dart, *.freezed.dart, *.min.*
  export function colorIndex(tokens: Map<string, Token>): Map<string, string[]>;  // hex → non-alias token paths
  ```

Tag grammar: impl `/antidrift\s+impl\s+#([A-Za-z0-9_.-]+)@(\d+)/g`; use `/antidrift\s+use\s+#([A-Za-z0-9_.-]+)(?::([A-Za-z0-9_-]+))?/g`. Existing `TAG_RE` must not match either form (it doesn't, since the keyword sits between `antidrift` and `#`; a test pins it).

Literals: `(?<![\w&])#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z])` (3-digit expands, alpha `FF` when absent); `Color\(\s*0x([0-9a-fA-F]{8})\s*\)` (AARRGGBB → RRGGBBAA); `rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0|1|0?\.\d+)\s*)?\)` (alpha → `round(a*255)`).

- [ ] **Step 1: Write the failing tests:**
  - `parseUiTags reads impl and use tags`: `'// antidrift impl #pagar_button@3'` → impl `{id:'pagar_button',version:3,line:1}`; `'<!-- antidrift use #pagar_button:primary -->'` → use with `variant:'primary'`; `'// antidrift use #pagar_button'` → no variant.
  - `entity parseTags ignores impl/use tags` (from `src/scanner.ts`) → `[]`.
  - `findColorLiterals normalizes all forms`: `#1e5bff`, `#1E5BFF80`, `#fff`, `Color(0xFF1E5BFF)`, `rgb(30, 91, 255)`, `rgba(30,91,255,0.5)` → hexes `#1E5BFFFF`, `#1E5BFF80`, `#FFFFFFFF`, `#1E5BFFFF`, `#1E5BFFFF`, `#1E5BFF80`.
  - `findColorLiterals ignores html entities and longer words`: `'&#123; #12345 abc#fff'` → `[]`.
  - `colorIndex excludes aliases`.
  - `isGeneratedFile`: `a.g.dart`, `x.freezed.dart`, `app.min.js` → true; `app.dart` → false.
  - `walkFiles honors skip and the default ignores` (node_modules never yielded).
- [ ] **Step 2: Run** both test files — FAIL.
- [ ] **Step 3: Implement** `tags.ts`, `hardcoded.ts`, and the `walkFiles` extraction.
- [ ] **Step 4: Run** full suite — all pass.
- [ ] **Step 5: Commit** `git commit -m "feat(ui): impl/use tag parsing and color literal detection"`

### Task 6: UI scan integrated into `scan`

**Files:**
- Create: `src/ui/scan.ts`
- Modify: `src/cli.ts` (`cmdScan` return + report + exit code in `main`)
- Test: `tests/ui-scan.test.ts`

**Interfaces:**
- Consumes: T1–T5.
- Produces:
  ```ts
  export interface UiFinding { kind: 'stale-impl' | 'orphan-impl' | 'broken-use' | 'broken-token' | 'stale-generated' | 'id-clash' | 'hardcoded'; line: string }
  export interface UiScanResult { problems: UiFinding[]; warnings: UiFinding[]; implCount: number; useCount: number }
  export function computeUiScan(root: string): UiScanResult;   // caller checks uiEnabled first
  ```
- `cmdScan` return gains `ui: UiScanResult | null` (null when `!uiEnabled(root)`). Report: existing lines, then UI problem lines, then (if any) `Warnings (N):` followed by warning lines. Exit code adds `ui.problems.length`. `hardcoded: 'error'` moves hardcoded findings into `problems`.

Line formats (copy from spec table): `  <file>:<line>  impl #<id>@<v> -> stale (current @<n>)`; `  <file>:<line>  impl #<id>@<v> -> orphan`; `  <file>:<line>  use #<id>[:<variant>] -> broken (no component | no variant "<v>")`; `  #<id> <slot> -> <ref> [broken-token]`; `  <out> -> out of date or hand-edited (run gen-tokens)`; `  #<id> is both an entity and a component [id-clash]`; `  <file>:<line>  <raw> matches token <path>[, <path>…] [hardcoded]`.

Hardcoded walk: only `UI_EXTENSIONS`, skipping `BUILD_SKIP_DIRS`, `isGeneratedFile`, `ui.json` targets' `out`, `ignore` globs, and lines containing `antidrift-allow`. Impl/use tags are collected from all walked files (any extension).

- [ ] **Step 1: Write the failing tests** (fixture: tokens `color.brand.primary #1E5BFF`, `radius.md 8px`; `pagar_button@2` with variants primary/secondary; `ui.json` with a css target):
  - `scan without UI folders is unchanged`: `cmdScan(root).ui === null` and report identical to a run before the folders existed.
  - `stale and orphan impls`: `impl #pagar_button@1` → stale line; `impl #ghost@1` → orphan line; both in `problems`.
  - `broken uses`: `use #pagar_button:tertiary` → `no variant "tertiary"`; `use #ghost` → `no component`.
  - `broken token ref` in the component → `[broken-token]` problem.
  - `stale generated file` before `gen-tokens` → problem; after → none.
  - `hardcoded color is a warning`: `web/pay.tsx` with `color: '#1e5bff'` → in `warnings`, `matches token color.brand.primary`; `cmdScan` exit-relevant counts unaffected; report contains `Warnings (1):`.
  - `hardcoded skips allow lines, generated targets, ignore globs and build dirs`.
  - `hardcoded: error counts as a problem`.
  - `id clash is reported`.
- [ ] **Step 2: Run** `npx vitest run tests/ui-scan.test.ts` — FAIL.
- [ ] **Step 3: Implement** `src/ui/scan.ts` and the `cmdScan`/`main` changes.
- [ ] **Step 4: Run** full suite — all pass (existing `cli.test.ts`/`derived.test.ts` scan tests unchanged).
- [ ] **Step 5: Commit** `git commit -m "feat(ui): scan reports UI drift and hardcoded-color warnings"`

### Task 7: CLI surface — show, list, tokens, tag, notify, import, ui init

**Files:**
- Modify: `src/cli.ts`
- Test: `tests/ui-cli.test.ts`

**Interfaces:**
- Consumes: T1–T6.
- Produces (all in `cli.ts`):
  ```ts
  export function cmdShowComponent(root: string, id: string): string;   // cmdShow delegates here when no entity file exists but a component does
  export function cmdTokens(root: string, prefix?: string): string;
  export function cmdTag(root: string, id: string, target: string, mode?: { kind: 'impl' } | { kind: 'use'; variant?: string }): string;
  export function cmdNotify(root: string, id: string): string;          // delegates to component handling when <id> is a component
  export function cmdNotifyTokens(root: string): string;
  export function cmdUiInit(root: string): string;
  // cmdImport(root, 'tokens', file) handled before IMPORTERS lookup
  ```

Behavior:
- `show <component>`: `#pagar_button@2  [component]  (hash …)`, summary, `Variants:`/`States:` lines, `Styles:` with one line per resolved slot `  primary.disabled.background → {color.neutral.300} = #D0D4DC` (colors as `#RRGGBB`, or `#RRGGBBAA` when alpha ≠ FF; other types formatted as in `tokens`; missing token `= [broken-token]`), then `Implementations:` (`  file:line  @v  [ok|stale]` or `  (none tagged)`), then `Uses:` (`  file:line  [:variant]  [ok|broken]` or `  (none tagged)`).
- `list`: entity lines unchanged; component lines `#<id>@<v>  [component] <title> — <summary>`; if tokens exist a final line `<N> token(s) — run tokens to list them`. The "No entities" message only when there are no entities and no components.
- `tokens [prefix]`: `<path>  <type>  <value>` sorted; aliases `{target} = <value>`; prefix filters by `path === prefix || path.startsWith(prefix + '.')`; empty → `No tokens.`
- `tag <id> <file:line> --impl` → inserts `antidrift impl #<id>@<componentVersion>`; `--use` / `--use=<variant>` → `antidrift use #<id>[:<variant>]`, erroring if the component or variant doesn't exist. Without flags, behavior unchanged. CLI parses `process.argv[5]`.
- `notify <id>` for a component: reconcile it, rebuild index, then `antidrift: #<id> is now @<v>. No stale implementations.` or `antidrift: #<id> changed to @<v>. N implementation(s) are now STALE — re-read the spec (show <id>) and update:` followed by `  file:line (tagged @v)`; append broken token refs if any.
- `notify-tokens`: tokens load OK → list `staleTargets` (`… generated token file(s) are out of date — run gen-tokens:`) and broken component refs; nothing to report → `antidrift: tokens OK; generated files up to date.`; load error → `antidrift: tokens invalid — <message>`.
- `import tokens <file>`: parse, validate merged with existing tokens (`resolveTokenTree` over existing + new entries), write to `.antidrift/tokens/<basename>`, refuse to overwrite an existing file of the same name.
- `ui init`: creates `tokens/`, `components/`, `ui.json` (`{ "targets": [], "ignore": [], "hardcoded": "warn" }`) and `tokens/base.json` (`color.brand.primary #1E5BFF`, `radius.md 8px`) — never overwrites existing files; returns a short next-steps message (add targets to ui.json, run gen-tokens, add a component).

- [ ] **Step 1: Write the failing tests**, one per bullet above (show resolved line `primary.disabled.radius → {radius.md} = 8px`; list component line + token count; tokens prefix filter; tag `--impl` writes `// antidrift impl #pagar_button@2`, `--use=tertiary` throws; notify on a component edit names the stale impl; notify-tokens lists a stale target; import tokens refuses a duplicate path; ui init is idempotent and makes `uiEnabled` true).
- [ ] **Step 2: Run** `npx vitest run tests/ui-cli.test.ts` — FAIL.
- [ ] **Step 3: Implement** the commands and `main` switch cases (`tokens`, `gen-tokens`, `notify-tokens`, `ui` with `init`); update `USAGE`.
- [ ] **Step 4: Run** full suite — all pass; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** `git commit -m "feat(ui): show/list/tokens/tag/notify/import/ui-init commands"`

### Task 8: Hook, commands, skills, docs, release

**Files:**
- Modify: `hooks/on-entity-change.sh`, `tests/hook.test.ts`, `commands/antidrift-{show,list,scan,tag,import}.md`, `skills/antidrift/SKILL.md`, `README.md`, `DECISIONS.md`, `package.json`, `.claude-plugin/plugin.json`
- Create: `commands/antidrift-tokens.md`, `commands/antidrift-gen-tokens.md`, `commands/antidrift-ui-init.md`, `skills/antidrift-ui/SKILL.md`

**Interfaces:**
- Consumes: CLI commands `notify <id>`, `notify-tokens`, `tokens`, `gen-tokens`, `ui init` (T3, T7).

- [ ] **Step 1: Write the failing hook tests:** writing `.antidrift/components/pagar_button.json` (with a stale `impl` tag in the project) → additionalContext contains `STALE`; writing `.antidrift/tokens/base.json` with a configured target never generated → contains `run gen-tokens`; the hook does not create the target file.
- [ ] **Step 2: Run** `npx vitest run tests/hook.test.ts` — FAIL.
- [ ] **Step 3: Update the hook:** keep the nested-path exclusion; `components/*.json` → `notify <id>`; `tokens/*.json` → `notify-tokens`. Then `npm run build` (the hook test runs `dist/cli.js`).
- [ ] **Step 4: Run** `npx vitest run tests/hook.test.ts` — PASS.
- [ ] **Step 5: Docs.** New command files follow the existing format (`description`, `allowed-tools: Bash(node:*)`, `argument-hint`, one `Run node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js …` line). `skills/antidrift-ui/SKILL.md` description: "Use when the repo has .antidrift/tokens/ or .antidrift/components/ — design tokens and component specs are the source of truth for UI." Its rules are the spec's "Skill + docs" bullet. Main skill gets one "Optional UI module" bullet worded as in the spec (suggest only while working on UI/DS code, at most once per conversation, never set up uninvited). README: new "UI module (optional)" section after the entity docs, framed as one way of working, with the `pagar_button` example, the three layers, `ui.json`, tag forms, scan kinds, warnings vs `"hardcoded": "error"`, `antidrift-allow`. DECISIONS: "Wave 5 (UI module), v0.4.0" listing the spec's "my call" decisions.
- [ ] **Step 6: Release checks:** bump version to `0.4.0` in both files; `npm run build`; `npx vitest run` all pass; `npx tsc --noEmit` clean; `claude plugin validate . --strict` → `✔ Validation passed`.
- [ ] **Step 7: End-to-end in a temp dir:** `ui init`; add a css and a dart target; `gen-tokens`; write `pagar_button.json`; `notify pagar_button`; tag an impl with `tag --impl`; edit the component; `scan` exits 1 with the stale impl; add `#1e5bff` to a `.tsx` → listed under `Warnings`, exit code unchanged by it.
- [ ] **Step 8: Commit** `git commit -m "feat(ui): hook, commands, skills and docs for the UI module (v0.4.0)"`
