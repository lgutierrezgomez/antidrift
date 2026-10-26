import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { buildIndex } from '../store.js';
import { walkFiles } from '../scanner.js';
import { loadTokens, loadRawTokens, parseTokenTree, resolveTokenTree, tokensDir, type TokenValue } from './tokens.js';
import { componentsDir, readComponent, reconcileComponent, resolveMatrix, brokenTokenRefs } from './components.js';
import { uiConfigPath, staleTargets } from './config.js';
import { parseUiTags, type ImplTag, type UseTag } from './tags.js';
import { BUILD_SKIP_DIRS } from './hardcoded.js';

export function formatTokenValue(v: TokenValue): string {
  switch (v.type) {
    case 'color':
      return v.hex.endsWith('FF') ? v.hex.slice(0, 7) : v.hex;
    case 'dimension':
      return `${v.value}${v.unit}`;
    case 'fontFamily':
      return v.families.join(', ');
    case 'fontWeight':
      return String(v.weight);
    case 'number':
      return String(v.value);
    case 'duration':
      return `${v.ms}ms`;
  }
}

/** Every impl/use tag in the repo (build output folders skipped). */
export function collectUiTags(root: string): { impls: ImplTag[]; uses: UseTag[] } {
  const impls: ImplTag[] = [];
  const uses: UseTag[] = [];
  for (const { path, rel } of walkFiles(root, (r, isDir) => isDir && BUILD_SKIP_DIRS.has(r.split('/').pop()!))) {
    try {
      const t = parseUiTags(readFileSync(path, 'utf8'), rel);
      impls.push(...t.impls);
      uses.push(...t.uses);
    } catch {
      /* skip unreadable */
    }
  }
  return { impls, uses };
}

export function cmdShowComponent(root: string, id: string): string {
  const c = readComponent(root, id);
  const tokens = loadTokens(root);
  const matrix = resolveMatrix(c, tokens);
  const styles: string[] = [];
  for (const v of c.variants)
    for (const s of c.states)
      for (const [p, slot] of Object.entries(matrix[v][s]))
        styles.push(`  ${v}.${s}.${p} → ${slot.ref} = ${slot.value ? formatTokenValue(slot.value) : '[broken-token]'}`);
  const { impls, uses } = collectUiTags(root);
  const implLines = impls
    .filter((t) => t.id === id)
    .map((t) => `  ${t.file}:${t.line}  @${t.version}  [${t.version < c.version ? 'stale' : 'ok'}]`);
  const useLines = uses
    .filter((u) => u.id === id)
    .map((u) => `  ${u.file}:${u.line}${u.variant ? `  :${u.variant}` : ''}  [${!u.variant || c.variants.includes(u.variant) ? 'ok' : 'broken'}]`);
  return [
    `#${c.id}@${c.version}  [component]  (hash ${c.hash})`,
    c.summary,
    `Variants: ${c.variants.join(', ')}`,
    `States: ${c.states.join(', ')}`,
    'Styles:',
    ...styles,
    'Implementations:',
    ...(implLines.length ? implLines : ['  (none tagged)']),
    'Uses:',
    ...(useLines.length ? useLines : ['  (none tagged)']),
  ]
    .filter(Boolean)
    .join('\n');
}

export function cmdTokens(root: string, prefix?: string): string {
  const lines = [...loadTokens(root).values()]
    .filter((t) => !prefix || t.path === prefix || t.path.startsWith(prefix + '.'))
    .sort((a, b) => (a.path < b.path ? -1 : 1))
    .map((t) => `${t.path}  ${t.type}  ${t.aliasOf ? `{${t.aliasOf}} = ` : ''}${formatTokenValue(t.value)}`);
  return lines.length ? lines.join('\n') : 'No tokens.';
}

export function cmdNotifyComponent(root: string, id: string): string {
  const c = reconcileComponent(root, id);
  buildIndex(root);
  const stale = collectUiTags(root).impls.filter((t) => t.id === id && t.version < c.version);
  const broken = brokenTokenRefs(c, loadTokens(root));
  const parts = [
    stale.length
      ? `antidrift: #${id} changed to @${c.version}. ${stale.length} implementation(s) are now STALE — re-read the spec (show ${id}) and update:\n` +
        stale.map((t) => `  ${t.file}:${t.line} (tagged @${t.version})`).join('\n')
      : `antidrift: #${id} is now @${c.version}. No stale implementations.`,
  ];
  if (broken.length)
    parts.push(`antidrift: #${id} references missing tokens:\n` + broken.map((b) => `  ${b.slot} -> ${b.ref}`).join('\n'));
  return parts.join('\n');
}

export function cmdNotifyTokens(root: string): string {
  let tokens;
  try {
    tokens = loadTokens(root);
  } catch (e) {
    return `antidrift: tokens invalid — ${(e as Error).message}`;
  }
  const stale = staleTargets(root);
  const broken = readdirSafe(componentsDir(root)).flatMap((id) => brokenTokenRefs(readComponent(root, id), tokens));
  const parts: string[] = [];
  if (stale.length)
    parts.push(`antidrift: ${stale.length} generated token file(s) are out of date — run gen-tokens:\n` + stale.map((t) => `  ${t.out}`).join('\n'));
  if (broken.length)
    parts.push('antidrift: components reference missing tokens:\n' + broken.map((b) => `  #${b.component} ${b.slot} -> ${b.ref}`).join('\n'));
  return parts.length ? parts.join('\n') : 'antidrift: tokens OK; generated files up to date.';
}

const readdirSafe = (dir: string) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort() : [];

/** Copy a DTCG file into .antidrift/tokens/ after validating it together with the existing tokens. */
export function cmdImportTokens(root: string, file: string): string {
  const name = basename(file);
  if (!name.endsWith('.json')) throw new Error(`token files must be .json: ${file}`);
  const dest = join(tokensDir(root), name);
  if (existsSync(dest)) throw new Error(`.antidrift/tokens/${name} already exists; rename the file or merge it by hand`);
  const text = readFileSync(file, 'utf8');
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    throw new Error(`${name}: invalid JSON (${(e as Error).message})`);
  }
  const incoming = parseTokenTree(doc, name);
  resolveTokenTree([...loadRawTokens(root), ...incoming]);
  mkdirSync(tokensDir(root), { recursive: true });
  writeFileSync(dest, text);
  return `imported ${incoming.length} token(s) into .antidrift/tokens/${name}`;
}

export function cmdUiInit(root: string): string {
  mkdirSync(tokensDir(root), { recursive: true });
  mkdirSync(componentsDir(root), { recursive: true });
  const created: string[] = [];
  if (!existsSync(uiConfigPath(root))) {
    writeFileSync(uiConfigPath(root), JSON.stringify({ targets: [], ignore: [], hardcoded: 'warn' }, null, 2) + '\n');
    created.push('.antidrift/ui.json');
  }
  if (readdirSafe(tokensDir(root)).length === 0) {
    const starter = {
      color: { $type: 'color', brand: { primary: { $value: '#1E5BFF' } } },
      radius: { $type: 'dimension', md: { $value: { value: 8, unit: 'px' } } },
    };
    writeFileSync(join(tokensDir(root), 'base.json'), JSON.stringify(starter, null, 2) + '\n');
    created.push('.antidrift/tokens/base.json');
  }
  return [
    `antidrift: UI module ready${created.length ? ` (created ${created.join(', ')})` : ''}.`,
    'Next: add token targets to .antidrift/ui.json and run gen-tokens; describe a component in .antidrift/components/<id>.json.',
  ].join('\n');
}
