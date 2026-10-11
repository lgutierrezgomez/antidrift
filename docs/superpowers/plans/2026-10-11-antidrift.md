# antidrift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A language-agnostic Claude Code plugin that treats JSON-Schema data entities as a single source of truth, tracks where they're used via source comments, and flags/notifies when they drift.

**Architecture:** A small TypeScript/Node CLI (`antidrift`) implements the core — a `.antidrift/` store (index + per-entity JSON Schema files with version+hash), a repo scanner for `antidrift #id@ver` tags, and a drift engine. A thin Claude Code plugin layer (manifest, slash commands, a PostToolUse hook, and a skill) drives the CLI and feeds results back to the agent.

**Tech Stack:** TypeScript, Node ≥20 (ESM), `ajv` (JSON Schema validation), `vitest` (tests). No codegen dependencies.

**Spec:** `docs/superpowers/specs/2026-10-11-antidrift-design.md`

## Global Constraints

- Store lives at `.antidrift/` in the repo root: `index.json` + `entities/<id>.json`.
- Entity file shape: `{ id, version, hash, schema, title?, summary?, relationships? }`. `version` is an integer starting at `1`, bumped only when `schema` content changes. `hash` is a content hash of `schema`.
- `schema` must be a valid JSON Schema (draft 2020-12), validated with ajv; invalid schemas are rejected.
- Usage tag grammar: the token `antidrift #<id>@<version>` inside any comment, matched by `/antidrift\s+#([A-Za-z0-9_.-]+)@(\d+)/g` — must work regardless of comment syntax (`//`, `#`, `<!-- -->`).
- Drift semantics: `tag.version < entity.version` → `stale`; tag id not in index → `orphan`; else `ok`. antidrift **flags** drift; it does not verify code matches the schema.
- `scanRepo` must skip `.git`, `node_modules`, `.antidrift`, `dist`.
- Notification is a between-steps reminder emitted by a PostToolUse hook (not OS locks).
- Distribution: a Claude Code plugin (`.claude-plugin/plugin.json`).

## Review Focus

- **Non-`//` comment syntaxes** (`#` in Python/YAML, `<!-- -->` in HTML): the scanner must still find the tag. → pinned in Task 3.
- **Invalid JSON Schema in an entity file**: `writeEntity` must throw, not silently store it. → pinned in Task 2.
- **Orphan tag** (tag references a deleted/renamed entity id): drift must flag `orphan`, not crash. → pinned in Task 4.
- **Reconcile with unchanged content**: must be idempotent — version must NOT bump when the schema hash is unchanged. → pinned in Task 2.
- **Excluded dirs**: a tag inside `node_modules/` or `.antidrift/` must not appear in scan results. → pinned in Task 3.

---

### Task 1: Project scaffolding + shared types

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.claude-plugin/plugin.json`
- Create: `src/types.ts`
- Test: `tests/types.test.ts`

**Interfaces:**
- Produces: `Entity`, `IndexEntry`, `UsageTag`, `DriftStatus`, `DriftItem` (types imported by all later tasks).

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "antidrift",
  "version": "0.1.0",
  "type": "module",
  "bin": { "antidrift": "dist/cli.js" },
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": { "ajv": "^8.17.1" },
  "devDependencies": { "typescript": "^5.6.0", "vitest": "^2.1.0", "@types/node": "^20.14.0" }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "outDir": "dist", "rootDir": "src", "strict": true, "declaration": true, "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts'] } });
```

- [ ] **Step 4: Create `.claude-plugin/plugin.json`**

```json
{
  "name": "antidrift",
  "version": "0.1.0",
  "description": "Single-source-of-truth registry + drift tracking for data entities."
}
```

- [ ] **Step 5: Write `src/types.ts`**

```ts
export interface Entity {
  id: string;
  version: number;
  hash: string;
  title?: string;
  summary?: string;
  relationships?: string[];
  schema: Record<string, unknown>;
}
export interface IndexEntry {
  id: string; title: string; version: number; hash: string; summary: string; file: string;
}
export interface UsageTag { id: string; version: number; file: string; line: number; }
export type DriftStatus = 'ok' | 'stale' | 'orphan';
export interface DriftItem { tag: UsageTag; currentVersion: number | null; status: DriftStatus; }
```

- [ ] **Step 6: Write the failing test**

```ts
// tests/types.test.ts
import { expectTypeOf } from 'vitest';
import type { Entity } from '../src/types.js';
import { test } from 'vitest';
test('Entity type is importable and shaped', () => {
  const e: Entity = { id: 'x', version: 1, hash: 'h', schema: {} };
  expectTypeOf(e.version).toEqualTypeOf<number>();
});
```

- [ ] **Step 7: Run tests** — Run: `npm install && npm test`. Expected: PASS (1 test).

- [ ] **Step 8: Commit**

```bash
git init && git add -A && git commit -m "chore: scaffold antidrift project + shared types"
```

---

### Task 2: Store (`.antidrift/` I/O, hashing, versioning, index)

**Files:**
- Create: `src/store.ts`
- Test: `tests/store.test.ts`

**Interfaces:**
- Consumes: `Entity`, `IndexEntry` from `src/types.ts`.
- Produces: `storeDir`, `entitiesDir`, `indexPath`, `entityPath`, `computeHash(schema)`, `initStore(root)`, `writeEntity(root, entity)`, `readEntity(root, id)`, `listEntityIds(root)`, `reconcileEntity(root, id): Entity`, `buildIndex(root): IndexEntry[]`, `readIndex(root): IndexEntry[]`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/store.test.ts
import { test, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as S from '../src/store.js';
import type { Entity } from '../src/types.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ad-')); });
const ent = (over: Partial<Entity> = {}): Entity =>
  ({ id: 'student', version: 1, hash: '', schema: { type: 'object', properties: { name: { type: 'string' } } }, ...over });

test('computeHash is stable regardless of key order', () => {
  expect(S.computeHash({ a: 1, b: 2 })).toBe(S.computeHash({ b: 2, a: 1 }));
});
test('writeEntity rejects invalid JSON Schema', () => {
  expect(() => S.writeEntity(root, ent({ schema: { type: 'not-a-type' } }))).toThrow();
});
test('reconcile is idempotent when schema unchanged', () => {
  const e = ent({ hash: S.computeHash(ent().schema) });
  S.writeEntity(root, e);
  expect(S.reconcileEntity(root, 'student').version).toBe(1);
});
test('reconcile bumps version when schema changed', () => {
  S.writeEntity(root, ent({ hash: 'stale-hash' }));
  expect(S.reconcileEntity(root, 'student').version).toBe(2);
});
test('buildIndex lists all entities', () => {
  S.writeEntity(root, ent({ hash: S.computeHash(ent().schema), title: 'Student', summary: 'a learner' }));
  const idx = S.buildIndex(root);
  expect(idx).toEqual([{ id: 'student', title: 'Student', version: 1, hash: S.computeHash(ent().schema), summary: 'a learner', file: 'entities/student.json' }]);
});
```

- [ ] **Step 2: Run tests to verify they fail** — Run: `npm test -- store`. Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/store.ts`**

```ts
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import type { Entity, IndexEntry } from './types.js';

const ajv = new Ajv({ strict: false });

export const storeDir = (root: string) => join(root, '.antidrift');
export const entitiesDir = (root: string) => join(storeDir(root), 'entities');
export const indexPath = (root: string) => join(storeDir(root), 'index.json');
export const entityPath = (root: string, id: string) => join(entitiesDir(root), `${id}.json`);

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + canonical(o[k])).join(',')}}`;
  }
  return JSON.stringify(v);
}
export function computeHash(schema: Record<string, unknown>): string {
  return createHash('sha256').update(canonical(schema)).digest('hex').slice(0, 12);
}
export function initStore(root: string): void {
  mkdirSync(entitiesDir(root), { recursive: true });
  if (!existsSync(indexPath(root))) writeFileSync(indexPath(root), '[]\n');
}
export function writeEntity(root: string, entity: Entity): void {
  if (!ajv.validateSchema(entity.schema)) {
    throw new Error(`Invalid JSON Schema for "${entity.id}": ${ajv.errorsText(ajv.errors)}`);
  }
  mkdirSync(entitiesDir(root), { recursive: true });
  writeFileSync(entityPath(root, entity.id), JSON.stringify(entity, null, 2) + '\n');
}
export const readEntity = (root: string, id: string): Entity =>
  JSON.parse(readFileSync(entityPath(root, id), 'utf8')) as Entity;
export function listEntityIds(root: string): string[] {
  if (!existsSync(entitiesDir(root))) return [];
  return readdirSync(entitiesDir(root)).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')).sort();
}
export function reconcileEntity(root: string, id: string): Entity {
  const e = readEntity(root, id);
  const hash = computeHash(e.schema);
  if (hash !== e.hash) { e.version += 1; e.hash = hash; writeEntity(root, e); }
  return e;
}
export function buildIndex(root: string): IndexEntry[] {
  const index = listEntityIds(root).map(id => {
    const e = readEntity(root, id);
    return { id: e.id, title: e.title ?? e.id, version: e.version, hash: e.hash, summary: e.summary ?? '', file: `entities/${id}.json` };
  });
  writeFileSync(indexPath(root), JSON.stringify(index, null, 2) + '\n');
  return index;
}
export function readIndex(root: string): IndexEntry[] {
  return existsSync(indexPath(root)) ? JSON.parse(readFileSync(indexPath(root), 'utf8')) as IndexEntry[] : [];
}
```

- [ ] **Step 4: Run tests** — Run: `npm test -- store`. Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store.ts tests/store.test.ts && git commit -m "feat: store with hashing, versioning, index build"
```

---

### Task 3: Scanner (extract usage tags from the repo)

**Files:**
- Create: `src/scanner.ts`
- Test: `tests/scanner.test.ts`

**Interfaces:**
- Consumes: `UsageTag` from `src/types.ts`.
- Produces: `parseTags(content): {id,version,line}[]`, `scanFile(path, root): UsageTag[]`, `scanRepo(root): UsageTag[]`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/scanner.test.ts
import { test, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTags, scanRepo } from '../src/scanner.js';

test('parses tags in any comment syntax', () => {
  const c = ['// antidrift #student@3', '# antidrift #course@1', '<!-- antidrift #teacher@2 -->'].join('\n');
  expect(parseTags(c)).toEqual([
    { id: 'student', version: 3, line: 1 },
    { id: 'course', version: 1, line: 2 },
    { id: 'teacher', version: 2, line: 3 },
  ]);
});
test('scanRepo finds tags and skips node_modules and .antidrift', () => {
  const root = mkdtempSync(join(tmpdir(), 'ad-'));
  writeFileSync(join(root, 'a.ts'), '// antidrift #student@3\n');
  mkdirSync(join(root, 'node_modules')); writeFileSync(join(root, 'node_modules', 'b.ts'), '// antidrift #x@1\n');
  mkdirSync(join(root, '.antidrift')); writeFileSync(join(root, '.antidrift', 'c.json'), 'antidrift #y@1');
  const tags = scanRepo(root);
  expect(tags).toEqual([{ id: 'student', version: 3, file: 'a.ts', line: 1 }]);
});
```

- [ ] **Step 2: Run tests to verify they fail** — Run: `npm test -- scanner`. Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/scanner.ts`**

```ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { UsageTag } from './types.js';

const TAG_RE = /antidrift\s+#([A-Za-z0-9_.-]+)@(\d+)/g;
const IGNORE = new Set(['.git', 'node_modules', '.antidrift', 'dist']);

export function parseTags(content: string): Array<{ id: string; version: number; line: number }> {
  const out: Array<{ id: string; version: number; line: number }> = [];
  content.split('\n').forEach((text, i) => {
    TAG_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TAG_RE.exec(text)) !== null) out.push({ id: m[1], version: Number(m[2]), line: i + 1 });
  });
  return out;
}
export function scanFile(path: string, root: string): UsageTag[] {
  return parseTags(readFileSync(path, 'utf8')).map(t => ({ ...t, file: relative(root, path) }));
}
export function scanRepo(root: string): UsageTag[] {
  const tags: UsageTag[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (IGNORE.has(name)) continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.isFile()) { try { tags.push(...scanFile(full, root)); } catch { /* skip unreadable */ } }
    }
  };
  walk(root);
  return tags;
}
```

- [ ] **Step 4: Run tests** — Run: `npm test -- scanner`. Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/scanner.ts tests/scanner.test.ts && git commit -m "feat: repo scanner for antidrift usage tags"
```

---

### Task 4: Drift engine

**Files:**
- Create: `src/drift.ts`
- Test: `tests/drift.test.ts`

**Interfaces:**
- Consumes: `UsageTag`, `IndexEntry`, `DriftItem` from `src/types.ts`.
- Produces: `computeDrift(tags, index): DriftItem[]`, `problems(items): DriftItem[]`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/drift.test.ts
import { test, expect } from 'vitest';
import { computeDrift, problems } from '../src/drift.js';
import type { IndexEntry, UsageTag } from '../src/types.js';

const idx: IndexEntry[] = [{ id: 'student', title: 'S', version: 4, hash: 'h', summary: '', file: 'entities/student.json' }];
const tag = (id: string, version: number): UsageTag => ({ id, version, file: 'a.ts', line: 1 });

test('stale when tag version is behind', () => {
  expect(computeDrift([tag('student', 3)], idx)[0].status).toBe('stale');
});
test('ok when tag version matches', () => {
  expect(computeDrift([tag('student', 4)], idx)[0].status).toBe('ok');
});
test('orphan when entity id unknown', () => {
  const d = computeDrift([tag('ghost', 1)], idx)[0];
  expect(d.status).toBe('orphan');
  expect(d.currentVersion).toBeNull();
});
test('problems filters out ok', () => {
  const items = computeDrift([tag('student', 4), tag('student', 3), tag('ghost', 1)], idx);
  expect(problems(items).map(i => i.status)).toEqual(['stale', 'orphan']);
});
```

- [ ] **Step 2: Run tests to verify they fail** — Run: `npm test -- drift`. Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/drift.ts`**

```ts
import type { UsageTag, IndexEntry, DriftItem } from './types.js';

export function computeDrift(tags: UsageTag[], index: IndexEntry[]): DriftItem[] {
  const current = new Map(index.map(e => [e.id, e.version]));
  return tags.map(tag => {
    const currentVersion = current.has(tag.id) ? current.get(tag.id)! : null;
    const status: DriftItem['status'] =
      currentVersion === null ? 'orphan' : tag.version < currentVersion ? 'stale' : 'ok';
    return { tag, currentVersion, status };
  });
}
export const problems = (items: DriftItem[]): DriftItem[] => items.filter(i => i.status !== 'ok');
```

- [ ] **Step 4: Run tests** — Run: `npm test -- drift`. Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/drift.ts tests/drift.test.ts && git commit -m "feat: drift engine (stale/orphan detection)"
```

---

### Task 5: CLI (`list`, `show`, `scan`, `init`, `reconcile`, `notify`)

**Files:**
- Create: `src/cli.ts`
- Test: `tests/cli.test.ts`

**Interfaces:**
- Consumes: all of `store.ts`, `scanner.ts`, `drift.ts`.
- Produces: `cmdList(root): string`, `cmdShow(root, id): string`, `cmdScan(root): {report, problems}`, `cmdNotify(root, id): string`; plus a `main()` dispatcher bound to `process.argv` and a shebang so `dist/cli.js` is executable.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/cli.test.ts
import { test, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as S from '../src/store.js';
import { cmdList, cmdScan, cmdNotify } from '../src/cli.js';
import type { Entity } from '../src/types.js';

let root: string;
const schema = { type: 'object', properties: { name: { type: 'string' } } };
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ad-'));
  const e: Entity = { id: 'student', version: 1, hash: S.computeHash(schema), schema, title: 'Student', summary: 'a learner' };
  S.writeEntity(root, e); S.buildIndex(root);
});

test('cmdList shows the entity', () => {
  expect(cmdList(root)).toContain('#student@1');
});
test('cmdScan reports stale usage', () => {
  writeFileSync(join(root, 'a.ts'), '// antidrift #student@0\n');
  // bump student to v2 by changing schema hash on disk
  const e = S.readEntity(root, 'student'); e.schema = { ...schema, extra: { type: 'string' } }; S.writeEntity(root, e);
  S.reconcileEntity(root, 'student'); S.buildIndex(root);
  const { problems } = cmdScan(root);
  expect(problems[0].status).toBe('stale');
});
test('cmdNotify bumps and reports stale sites', () => {
  writeFileSync(join(root, 'a.ts'), '// antidrift #student@1\n');
  const e = S.readEntity(root, 'student'); e.schema = { ...schema, extra: { type: 'string' } }; S.writeEntity(root, e);
  const msg = cmdNotify(root, 'student');
  expect(msg).toContain('STALE');
  expect(msg).toContain('a.ts:1');
});
```

- [ ] **Step 2: Run tests to verify they fail** — Run: `npm test -- cli`. Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/cli.ts`**

```ts
#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { buildIndex, readEntity, reconcileEntity, initStore } from './store.js';
import { scanRepo } from './scanner.js';
import { computeDrift, problems } from './drift.js';
import type { DriftItem } from './types.js';

export function cmdList(root: string): string {
  const index = buildIndex(root);
  if (index.length === 0) return 'No entities. Run `antidrift init`, then add files under .antidrift/entities/.';
  return index.map(e => `#${e.id}@${e.version}  ${e.title} — ${e.summary}`).join('\n');
}
export function cmdShow(root: string, id: string): string {
  const e = readEntity(root, id);
  const drift = computeDrift(scanRepo(root).filter(t => t.id === id), buildIndex(root));
  const sites = drift.map(d => `  ${d.tag.file}:${d.tag.line}  @${d.tag.version}  [${d.status}]`).join('\n') || '  (no usages tagged)';
  return [`#${e.id}@${e.version}  (hash ${e.hash})`, e.summary, 'Schema:', JSON.stringify(e.schema, null, 2), 'Usages:', sites]
    .filter(Boolean).join('\n');
}
export function cmdScan(root: string): { report: string; problems: DriftItem[] } {
  const tags = scanRepo(root);
  const probs = problems(computeDrift(tags, buildIndex(root)));
  const report = probs.length === 0
    ? `Scanned ${tags.length} tag(s). No drift.`
    : `Scanned ${tags.length} tag(s). ${probs.length} problem(s):\n` +
      probs.map(d => `  ${d.tag.file}:${d.tag.line}  #${d.tag.id}@${d.tag.version} -> ${d.status}` +
        (d.currentVersion !== null ? ` (current @${d.currentVersion})` : '')).join('\n');
  return { report, problems: probs };
}
export function cmdNotify(root: string, id: string): string {
  const entity = reconcileEntity(root, id);
  const stale = computeDrift(scanRepo(root), buildIndex(root)).filter(d => d.tag.id === id && d.status === 'stale');
  if (stale.length === 0) return `antidrift: #${id} is now @${entity.version}. No stale usages.`;
  return `antidrift: #${id} changed to @${entity.version}. ${stale.length} usage site(s) are now STALE — ` +
    `re-read .antidrift/entities/${id}.json and revalidate:\n` +
    stale.map(d => `  ${d.tag.file}:${d.tag.line} (tagged @${d.tag.version})`).join('\n');
}
function main(): void {
  const [cmd, arg] = process.argv.slice(2);
  const root = process.cwd();
  switch (cmd) {
    case 'init': initStore(root); console.log('antidrift: initialized .antidrift/'); break;
    case 'list': console.log(cmdList(root)); break;
    case 'show': console.log(cmdShow(root, arg)); break;
    case 'scan': { const r = cmdScan(root); console.log(r.report); process.exit(r.problems.length ? 1 : 0); }
    case 'reconcile': console.log(JSON.stringify(reconcileEntity(root, arg))); break;
    case 'notify': console.log(cmdNotify(root, arg)); break;
    default: console.error('usage: antidrift <init|list|show <id>|scan|reconcile <id>|notify <id>>'); process.exit(2);
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
```

- [ ] **Step 4: Run tests** — Run: `npm test -- cli`. Expected: PASS (3 tests).

- [ ] **Step 5: Build and smoke-test the CLI**

Run: `npm run build && node dist/cli.js list`
Expected: prints `No entities...` or an entity list without error.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts tests/cli.test.ts && git commit -m "feat: CLI (list/show/scan/init/reconcile/notify)"
```

---

### Task 6: Claude Code plugin surface (commands, hook, skill)

**Files:**
- Create: `commands/antidrift-list.md`, `commands/antidrift-show.md`, `commands/antidrift-scan.md`, `commands/antidrift-init.md`
- Create: `hooks/hooks.json`, `hooks/on-entity-change.sh`
- Create: `skills/antidrift/SKILL.md`
- Test: `tests/plugin.test.ts`

**Interfaces:**
- Consumes: the built CLI at `dist/cli.js`.
- Produces: installable plugin assets. The hook calls `antidrift notify <id>` and returns its output as `additionalContext`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/plugin.test.ts
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
test('plugin manifest and command files are valid', () => {
  JSON.parse(readFileSync('.claude-plugin/plugin.json', 'utf8'));
  const hooks = JSON.parse(readFileSync('hooks/hooks.json', 'utf8'));
  expect(hooks.hooks.PostToolUse).toBeTruthy();
  expect(readFileSync('commands/antidrift-list.md', 'utf8')).toContain('cli.js list');
  expect(readFileSync('skills/antidrift/SKILL.md', 'utf8')).toContain('antidrift #');
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npm test -- plugin`. Expected: FAIL (files missing).

- [ ] **Step 3: Write the command files**

`commands/antidrift-list.md`:
```md
---
description: List all antidrift entities (id, version, summary)
allowed-tools: Bash(node:*)
---
Run `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js list` from the project root and show the output to the user.
```
`commands/antidrift-show.md`:
```md
---
description: Show one antidrift entity's schema and its usage/drift
allowed-tools: Bash(node:*)
argument-hint: <entity-id>
---
Run `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js show $ARGUMENTS` and show the output.
```
`commands/antidrift-scan.md`:
```md
---
description: Scan the repo for drift between tagged code and entity versions
allowed-tools: Bash(node:*)
---
Run `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js scan` and report any stale or orphan usages.
```
`commands/antidrift-init.md`:
```md
---
description: Bootstrap .antidrift/ and (guided) author entities for an existing project
allowed-tools: Bash(node:*)
---
Run `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js init`. Then follow the antidrift skill to inventory the existing codebase (DB schema, models, interfaces, DTOs) and author one `.antidrift/entities/<id>.json` per entity at version 1, each a valid JSON Schema. Rebuild the index with `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js list`.
```

- [ ] **Step 4: Write `hooks/hooks.json`**

```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "Edit|Write|MultiEdit",
        "hooks": [ { "type": "command", "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/on-entity-change.sh" } ] }
    ]
  }
}
```

- [ ] **Step 5: Write `hooks/on-entity-change.sh`**

```bash
#!/usr/bin/env bash
# Reads PostToolUse JSON on stdin; if an .antidrift/entities/<id>.json was written,
# bump+scan via the CLI and return the result as additionalContext.
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
```

- [ ] **Step 6: Write `skills/antidrift/SKILL.md`**

```md
---
name: antidrift
description: Use when working in a repo that has an .antidrift/ folder. Entities are the single source of truth; read them before writing front/back code that touches an entity.
---
# antidrift conventions

- **Discover entities first:** run `/antidrift:list` (or read `.antidrift/index.json`) to see what exists. To work on one entity, read ONLY `.antidrift/entities/<id>.json` — do not load the whole store.
- **Tag every usage:** when you write or edit code that uses an entity, add a comment `antidrift #<id>@<version>` (inside the file's comment syntax) using the entity's current version. Both front and back must tag against the same entity.
- **On a stale reminder:** if a hook tells you an entity changed and sites are stale, re-read `.antidrift/entities/<id>.json`, update the affected code, and bump the tag's `@version`.
- **Changing an entity:** edit `.antidrift/entities/<id>.json`; the hook bumps its version and flags stale usages. Never hand-edit the version.
- **Bootstrapping (`/antidrift:init`):** inventory existing models/DB schema/interfaces and author one entity file per entity (valid JSON Schema, version 1).
```

- [ ] **Step 7: `chmod +x hooks/on-entity-change.sh`, then run tests** — Run: `chmod +x hooks/on-entity-change.sh && npm test`. Expected: PASS (all suites).

- [ ] **Step 8: Commit**

```bash
git add commands hooks skills tests/plugin.test.ts && git commit -m "feat: Claude Code plugin surface (commands, change hook, skill)"
```

---

### Task 7: README + end-to-end manual verification

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`** covering: what antidrift is, install as a Claude Code plugin, the `.antidrift/` layout, the tag convention `// antidrift #id@ver`, the four slash commands, and the drift/notify behavior. (One paragraph each; copy the Global Constraints values verbatim.)

- [ ] **Step 2: Manual end-to-end check**

```bash
npm run build
mkdir -p /tmp/ad-demo && cd /tmp/ad-demo
node <path-to>/dist/cli.js init
cat > .antidrift/entities/student.json <<'JSON'
{ "id":"student","version":1,"hash":"","schema":{"type":"object","properties":{"id":{"type":"string"},"name":{"type":"string"}},"required":["id","name"]} }
JSON
node <path-to>/dist/cli.js reconcile student   # sets real hash (version stays 1 first time? no: hash '' != computed -> v2); then:
node <path-to>/dist/cli.js list
echo '// antidrift #student@1' > app.ts
node <path-to>/dist/cli.js scan                # expect student stale if version advanced
```
Expected: `list` shows `#student`, `scan` reports the stale `app.ts:1`. (Document the real first-reconcile behavior observed.)

- [ ] **Step 3: Commit**

```bash
git add README.md && git commit -m "docs: README + verified end-to-end flow"
```

---

## Self-Review (done)

- **Spec coverage:** store/index/versioning → T2; usage tags → T3; drift → T4; list/show/scan/init + bootstrap + notify → T5; plugin (commands/hook/skill) + distribution → T6; docs → T7. All spec sections map to a task.
- **Placeholders:** none — every code step has real content.
- **Type consistency:** `Entity`, `IndexEntry`, `UsageTag`, `DriftItem` defined in T1 and used verbatim in T2–T5; `cmdNotify`/`reconcileEntity`/`buildIndex` signatures consistent across T2/T5/T6.
- **Review Focus:** all five items are pinned to task tests (comment syntaxes T3; invalid schema T2; orphan T4; idempotent reconcile T2; excluded dirs T3).

**Note on first reconcile:** an entity authored with `hash: ""` will bump to v2 on first `reconcile` because `"" != computed`. Bootstrap/`init` guidance should either write the correct hash or expect v2 after reconcile — T7 step 2 documents the real behavior; adjust T5/T2 only if you want first-reconcile to keep v1 (e.g. treat empty hash as "accept current version").
