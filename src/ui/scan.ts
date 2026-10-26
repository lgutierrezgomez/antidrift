import { readFileSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { computeIndex } from '../store.js';
import { walkFiles } from '../scanner.js';
import { loadTokens } from './tokens.js';
import { readUiConfig, staleTargets, globToRegExp } from './config.js';
import { listComponentIds, loadComponent, brokenTokenRefs, type Component } from './components.js';
import type { Token } from './tokens.js';
import { parseUiTags } from './tags.js';
import { findColorLiterals, colorIndex, isGeneratedFile, UI_EXTENSIONS, BUILD_SKIP_DIRS } from './hardcoded.js';

export interface UiFinding {
  kind:
    | 'stale-impl'
    | 'orphan-impl'
    | 'broken-use'
    | 'broken-token'
    | 'stale-generated'
    | 'id-clash'
    | 'invalid-component'
    | 'invalid-tokens'
    | 'hardcoded';
  line: string;
}
export interface UiScanResult {
  problems: UiFinding[];
  warnings: UiFinding[];
  implCount: number;
  useCount: number;
}

/** Spec/implementation/use drift, stale generated token files, and hardcoded colors. Call only when uiEnabled(root). */
export function computeUiScan(root: string): UiScanResult {
  const problems: UiFinding[] = [];
  const hardcoded: UiFinding[] = [];
  let tokens: Map<string, Token> = new Map();
  let tokensOk = true;
  try {
    tokens = loadTokens(root);
  } catch (e) {
    tokensOk = false;
    problems.push({ kind: 'invalid-tokens', line: `  tokens: ${(e as Error).message} [invalid-tokens]` });
  }
  const cfg = readUiConfig(root);
  const entityIds = new Set(computeIndex(root).filter((e) => !e.kind).map((e) => e.id));
  const components = new Map<string, Component>();
  for (const id of listComponentIds(root)) {
    const r = loadComponent(root, id);
    if ('error' in r) problems.push({ kind: 'invalid-component', line: `  ${r.error} [invalid-component]` });
    else components.set(id, r.component);
  }

  for (const id of components.keys())
    if (entityIds.has(id)) problems.push({ kind: 'id-clash', line: `  #${id} is both an entity and a component [id-clash]` });
  // With unreadable tokens every ref would look broken and every target stale — report the cause only.
  if (tokensOk) {
    for (const c of components.values())
      for (const b of brokenTokenRefs(c, tokens))
        problems.push({ kind: 'broken-token', line: `  #${b.component} ${b.slot} -> ${b.ref} [broken-token]` });
    for (const t of staleTargets(root, cfg))
      problems.push({ kind: 'stale-generated', line: `  ${t.out} -> out of date or hand-edited (run gen-tokens)` });
  }

  const generated = new Set(cfg.targets.map((t) => relative(root, resolve(root, t.out)).split(sep).join('/')));
  const ignore = cfg.ignore.map(globToRegExp);
  const colors = colorIndex(tokens);
  let implCount = 0;
  let useCount = 0;
  const skipDir = (rel: string, isDir: boolean) => isDir && BUILD_SKIP_DIRS.has(rel.split('/').pop()!);
  for (const { path, rel } of walkFiles(root, skipDir)) {
    let content: string;
    try {
      content = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    const { impls, uses } = parseUiTags(content, rel);
    implCount += impls.length;
    useCount += uses.length;
    for (const t of impls) {
      const c = components.get(t.id);
      if (!c) problems.push({ kind: 'orphan-impl', line: `  ${rel}:${t.line}  impl #${t.id}@${t.version} -> orphan` });
      else if (t.version < c.version)
        problems.push({ kind: 'stale-impl', line: `  ${rel}:${t.line}  impl #${t.id}@${t.version} -> stale (current @${c.version})` });
    }
    for (const u of uses) {
      const c = components.get(u.id);
      const label = `use #${u.id}${u.variant ? `:${u.variant}` : ''}`;
      if (!c) problems.push({ kind: 'broken-use', line: `  ${rel}:${u.line}  ${label} -> broken (no component)` });
      else if (u.variant && !c.variants.includes(u.variant))
        problems.push({ kind: 'broken-use', line: `  ${rel}:${u.line}  ${label} -> broken (no variant "${u.variant}")` });
    }
    const ext = rel.split('.').pop()!.toLowerCase();
    if (!colors.size || !UI_EXTENSIONS.has(ext) || isGeneratedFile(rel) || generated.has(rel) || ignore.some((g) => g.test(rel))) continue;
    content.split('\n').forEach((text, i) => {
      if (text.includes('antidrift-allow')) return;
      for (const lit of findColorLiterals(text)) {
        const paths = colors.get(lit.hex);
        if (paths) hardcoded.push({ kind: 'hardcoded', line: `  ${rel}:${i + 1}  ${lit.raw} matches token ${paths.join(', ')} [hardcoded]` });
      }
    });
  }
  return cfg.hardcoded === 'error'
    ? { problems: [...problems, ...hardcoded], warnings: [], implCount, useCount }
    : { problems, warnings: hardcoded, implCount, useCount };
}
