#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { buildIndex, computeIndex, entityPath, readEntity, readAllEntities, writeEntity, assertValidSchema, reconcileEntity, initStore, storeDir } from './store.js';
import { scanRepo } from './scanner.js';
import { computeDrift, problems } from './drift.js';
import { computeBrokenRefs, computeDerivedDrift, type BrokenRef, type DerivedDrift } from './relationships.js';
import { commentSyntax } from './comment.js';
import { IMPORTERS } from './importers.js';
import { EMITTERS } from './emitters.js';
import { readUiConfig, generateTarget, uiEnabled, type UiTarget } from './ui/config.js';
import { computeUiScan, type UiScanResult } from './ui/scan.js';
import { componentPath, readComponent } from './ui/components.js';
import { cmdShowComponent, cmdTokens, cmdNotifyComponent, cmdNotifyTokens, cmdImportTokens, cmdUiInit } from './ui/commands.js';
import { loadTokens } from './ui/tokens.js';
import type { DriftItem } from './types.js';

export { cmdShowComponent, cmdTokens, cmdNotifyTokens, cmdUiInit };

/** A component (not an entity) owns this id. */
const isComponent = (root: string, id: string) => !existsSync(entityPath(root, id)) && existsSync(componentPath(root, id));

export function cmdList(root: string): string {
  const index = computeIndex(root);
  let tokenLine = '';
  try {
    const n = loadTokens(root).size;
    if (n) tokenLine = `${n} token(s) — run tokens to list them`;
  } catch (e) {
    tokenLine = `tokens: invalid — ${(e as Error).message}`;
  }
  if (index.length === 0 && !tokenLine) return 'No entities. Run `antidrift init`, then add files under .antidrift/entities/.';
  return [
    ...index.map((e) => `#${e.id}@${e.version}  ${e.kind === 'component' ? '[component] ' : ''}${e.title} — ${e.summary}`),
    ...(tokenLine ? [tokenLine] : []),
  ].join('\n');
}

export function cmdShow(root: string, id: string, opts: { full?: boolean } = {}): string {
  if (isComponent(root, id)) return cmdShowComponent(root, id, opts);
  const e = readEntity(root, id);
  const index = computeIndex(root);
  const known = new Set(index.map((x) => x.id));
  const drift = computeDrift(scanRepo(root).filter((t) => t.id === id), index);
  const sites = drift.map((d) => `  ${d.tag.file}:${d.tag.line}  @${d.tag.version}  [${d.status}]`).join('\n') || '  (no usages tagged)';
  const outgoing = (e.relationships ?? []).map((r) => `  #${r}${known.has(r) ? '' : ' [broken-ref]'}`).join('\n') || '  (none)';
  const all = readAllEntities(root);
  const incoming =
    all
      .filter((x) => (x.relationships ?? []).includes(id))
      .map((x) => `  #${x.id}`)
      .join('\n') || '  (none)';
  const versions = new Map(index.map((x) => [x.id, x.version]));
  const derivedFrom = Object.entries(e.derivedFrom ?? {})
    .map(([b, v]) => {
      const cur = versions.get(b);
      return `  #${b}@${v}` + (cur === undefined ? ' [orphan]' : v < cur ? ` [stale: current @${cur}]` : '');
    })
    .join('\n');
  const projections = all
    .filter((x) => x.derivedFrom && id in x.derivedFrom)
    .map((x) => `  #${x.id} (built on @${x.derivedFrom![id]})`)
    .join('\n');
  return [
    `#${e.id}@${e.version}  (hash ${e.hash})`,
    e.summary,
    'Schema:',
    JSON.stringify(e.schema, null, 2),
    'Usages:',
    sites,
    'Relationships:',
    outgoing,
    'Referenced by:',
    incoming,
    ...(derivedFrom ? ['Derived from:', derivedFrom] : []),
    ...(projections ? ['Projections:', projections] : []),
  ]
    .filter(Boolean)
    .join('\n');
}

export function cmdScan(root: string): {
  report: string;
  problems: DriftItem[];
  brokenRefs: BrokenRef[];
  derived: DerivedDrift[];
  ui: UiScanResult | null;
} {
  const index = computeIndex(root);
  const tags = scanRepo(root);
  const probs = problems(computeDrift(tags, index));
  const entities = readAllEntities(root);
  const brokenRefs = computeBrokenRefs(entities, new Set(index.map((e) => e.id)));
  const derived = computeDerivedDrift(entities, new Map(index.map((e) => [e.id, e.version])));
  const ui = uiEnabled(root) ? computeUiScan(root) : null;
  const total = probs.length + brokenRefs.length + derived.length + (ui?.problems.length ?? 0);
  const tagCount = tags.length + (ui ? ui.implCount + ui.useCount : 0);
  const lines = [
    ...probs.map(
      (d) =>
        `  ${d.tag.file}:${d.tag.line}  #${d.tag.id}@${d.tag.version} -> ${d.status}` +
        (d.currentVersion !== null ? ` (current @${d.currentVersion})` : ''),
    ),
    ...brokenRefs.map((b) => `  #${b.entity} -> #${b.ref} [broken-ref]`),
    ...derived.map(
      (d) =>
        `  #${d.entity} derived from #${d.base}@${d.builtOn} -> ${d.status}` +
        (d.currentVersion !== null ? ` (current @${d.currentVersion})` : ''),
    ),
    ...(ui?.problems.map((f) => f.line) ?? []),
  ];
  let report =
    total === 0 ? `Scanned ${tagCount} tag(s). No drift.` : `Scanned ${tagCount} tag(s). ${total} problem(s):\n` + lines.join('\n');
  if (ui?.warnings.length) report += `\nWarnings (${ui.warnings.length}):\n` + ui.warnings.map((f) => f.line).join('\n');
  return { report, problems: probs, brokenRefs, derived, ui };
}

export function cmdNotify(root: string, id: string): string {
  if (isComponent(root, id)) return cmdNotifyComponent(root, id);
  const entity = reconcileEntity(root, id);
  const index = buildIndex(root);
  const stale = computeDrift(scanRepo(root), index).filter((d) => d.tag.id === id && d.status === 'stale');
  const projections = computeDerivedDrift(readAllEntities(root), new Map(index.map((e) => [e.id, e.version]))).filter(
    (d) => d.base === id,
  );
  if (stale.length === 0 && projections.length === 0) return `antidrift: #${id} is now @${entity.version}. No stale usages.`;
  const parts: string[] = [];
  if (stale.length)
    parts.push(
      `antidrift: #${id} changed to @${entity.version}. ${stale.length} usage site(s) are now STALE — ` +
        `re-read .antidrift/entities/${id}.json and revalidate:\n` +
        stale.map((d) => `  ${d.tag.file}:${d.tag.line} (tagged @${d.tag.version})`).join('\n'),
    );
  if (projections.length)
    parts.push(
      `antidrift: #${id} changed to @${entity.version}. ${projections.length} projection(s) derived from it are now STALE — ` +
        `update each one's schema if needed, then set its derivedFrom.${id} to ${entity.version}:\n` +
        projections.map((d) => `  #${d.entity} (built on @${d.builtOn})`).join('\n'),
    );
  return parts.join('\n');
}

export type TagMode = { kind: 'impl' } | { kind: 'use'; variant?: string };

export function cmdTag(root: string, id: string, target: string, mode?: TagMode): string {
  const m = target.match(/^(.+):(\d+)$/);
  if (!m) throw new Error(`expected <file:line>, got ${JSON.stringify(target)}`);
  const file = m[1];
  const line = Number(m[2]);
  let text: string;
  if (mode) {
    const c = readComponent(root, id); // throws if id invalid/missing
    if (mode.kind === 'use' && mode.variant && !c.variants.includes(mode.variant))
      throw new Error(`#${id} has no variant "${mode.variant}" (have: ${c.variants.join(', ')})`);
    text = mode.kind === 'impl' ? `antidrift impl #${id}@${c.version}` : `antidrift use #${id}${mode.variant ? `:${mode.variant}` : ''}`;
  } else text = `antidrift #${id}@${readEntity(root, id).version}`; // throws if id invalid/missing
  const lines = readFileSync(file, 'utf8').split('\n');
  if (!Number.isInteger(line) || line < 1 || line > lines.length + 1) throw new Error(`line ${line} out of range for ${file}`);
  const [pre, post] = commentSyntax(file);
  lines.splice(line - 1, 0, `${pre}${text}${post}`);
  writeFileSync(file, lines.join('\n'));
  return `tagged ${file}:${line} with ${text.replace(/^antidrift /, '')}`;
}

export function cmdImport(root: string, format: string, file: string): string {
  if (format === 'tokens') return cmdImportTokens(root, file);
  const importer = IMPORTERS[format];
  if (!importer) throw new Error(`unknown import format: ${format} (have: ${Object.keys(IMPORTERS).join(', ')})`);
  const notes: string[] = [];
  const entities = importer(readFileSync(file, 'utf8'), basename(file).replace(/\.[^.]+$/, ''), notes);
  // Validate all schemas before writing any — import is all-or-nothing.
  for (const e of entities) assertValidSchema(e.id, e.schema);
  for (const e of entities) writeEntity(root, e);
  buildIndex(root);
  const msg = `imported ${entities.length} entity file(s) from ${file}`;
  return notes.length ? `${msg}\nnotes:\n${notes.map((n) => `  ${n}`).join('\n')}` : msg;
}

export async function cmdGenTypes(root: string, lang = 'ts', out?: string): Promise<string> {
  const emitter = EMITTERS.get(lang);
  if (!emitter) throw new Error(`unknown emitter lang: ${lang} (have: ${[...EMITTERS.keys()].join(', ')})`);
  const code = await emitter.emit(readAllEntities(root));
  const dest = out ?? join(storeDir(root), 'generated', `types.${emitter.ext}`);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, code);
  if (!emitter.emitEnums) return `wrote ${dest}`;
  const enumsDest = dest.replace(/(\.[^./\\]+)?$/, `.enums.${emitter.ext}`);
  writeFileSync(enumsDest, emitter.emitEnums(readAllEntities(root)));
  return `wrote ${dest} and ${enumsDest}`;
}

/** Regenerate token files: every ui.json target, or one ad-hoc `lang` + `out`. */
export function cmdGenTokens(root: string, lang?: string, out?: string): string {
  const targets: UiTarget[] = lang ? [{ lang, out: resolve(requireArg(out, 'out')) }] : readUiConfig(root).targets;
  if (targets.length === 0)
    return 'antidrift: no token targets. Add one to .antidrift/ui.json, e.g. {"targets":[{"lang":"css","out":"web/ds/tokens.css"}]}, or run gen-tokens <lang> <out>.';
  const tokens = loadTokens(root);
  const written: string[] = [];
  for (const t of targets) {
    const dest = resolve(root, t.out);
    const code = generateTarget(root, t, tokens);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, code);
    written.push(t.out);
  }
  return `wrote ${written.join(', ')}`;
}

const USAGE =
  'usage: antidrift <init|list|show <id> [--full]|scan|reconcile <id>|notify <id>|tag <id> <file:line>|import <format> <file>|gen-types [lang] [out]|gen-tokens [lang out]|tokens [prefix]|notify-tokens|ui init>';

function parseTagMode(flag: string | undefined): TagMode | undefined {
  if (!flag) return undefined;
  if (flag === '--impl') return { kind: 'impl' };
  const m = flag.match(/^--use(?:=([A-Za-z0-9_-]+))?$/);
  if (m) return { kind: 'use', ...(m[1] ? { variant: m[1] } : {}) };
  throw new Error(`unknown tag flag ${flag} (use --impl, --use or --use=<variant>)`);
}
function requireArg(arg: string | undefined, what: string): string {
  if (!arg) throw new Error(`missing <${what}>. ${USAGE}`);
  return arg;
}

async function main(): Promise<void> {
  const [cmd, arg] = process.argv.slice(2);
  const root = process.cwd();
  try {
    switch (cmd) {
      case 'init':
        initStore(root);
        console.log('antidrift: initialized .antidrift/');
        break;
      case 'list':
        console.log(cmdList(root));
        break;
      case 'show':
        console.log(cmdShow(root, requireArg(arg, 'id'), { full: process.argv[4] === '--full' }));
        break;
      case 'scan': {
        const r = cmdScan(root);
        console.log(r.report);
        process.exit(r.problems.length + r.brokenRefs.length + r.derived.length + (r.ui?.problems.length ?? 0) ? 1 : 0);
        break;
      }
      case 'reconcile':
        console.log(JSON.stringify(reconcileEntity(root, requireArg(arg, 'id'))));
        break;
      case 'notify':
        console.log(cmdNotify(root, requireArg(arg, 'id')));
        break;
      case 'tag':
        console.log(cmdTag(root, requireArg(arg, 'id'), requireArg(process.argv[4], 'file:line'), parseTagMode(process.argv[5])));
        break;
      case 'import':
        console.log(cmdImport(root, requireArg(arg, 'format'), requireArg(process.argv[4], 'file')));
        break;
      case 'gen-types':
        console.log(await cmdGenTypes(root, arg ?? 'ts', process.argv[4]));
        break;
      case 'tokens':
        console.log(cmdTokens(root, arg));
        break;
      case 'notify-tokens':
        console.log(cmdNotifyTokens(root));
        break;
      case 'ui':
        if (arg !== 'init') throw new Error(`unknown ui subcommand: ${arg ?? '(none)'}. ${USAGE}`);
        console.log(cmdUiInit(root));
        break;
      case 'gen-tokens':
        console.log(cmdGenTokens(root, arg, process.argv[4]));
        break;
      default:
        console.error(USAGE);
        process.exit(2);
    }
  } catch (e) {
    console.error('antidrift: ' + (e as Error).message);
    process.exit(2);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error('antidrift: ' + (e as Error).message);
    process.exit(2);
  });
}
