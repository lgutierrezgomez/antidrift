#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildIndex, computeIndex, readEntity, reconcileEntity, initStore } from './store.js';
import { scanRepo } from './scanner.js';
import { computeDrift, problems } from './drift.js';
import { commentSyntax } from './comment.js';
import type { DriftItem } from './types.js';

export function cmdList(root: string): string {
  const index = computeIndex(root);
  if (index.length === 0) return 'No entities. Run `antidrift init`, then add files under .antidrift/entities/.';
  return index.map((e) => `#${e.id}@${e.version}  ${e.title} — ${e.summary}`).join('\n');
}

export function cmdShow(root: string, id: string): string {
  const e = readEntity(root, id);
  const drift = computeDrift(scanRepo(root).filter((t) => t.id === id), computeIndex(root));
  const sites = drift.map((d) => `  ${d.tag.file}:${d.tag.line}  @${d.tag.version}  [${d.status}]`).join('\n') || '  (no usages tagged)';
  return [`#${e.id}@${e.version}  (hash ${e.hash})`, e.summary, 'Schema:', JSON.stringify(e.schema, null, 2), 'Usages:', sites]
    .filter(Boolean)
    .join('\n');
}

export function cmdScan(root: string): { report: string; problems: DriftItem[] } {
  const tags = scanRepo(root);
  const probs = problems(computeDrift(tags, computeIndex(root)));
  const report =
    probs.length === 0
      ? `Scanned ${tags.length} tag(s). No drift.`
      : `Scanned ${tags.length} tag(s). ${probs.length} problem(s):\n` +
        probs
          .map(
            (d) =>
              `  ${d.tag.file}:${d.tag.line}  #${d.tag.id}@${d.tag.version} -> ${d.status}` +
              (d.currentVersion !== null ? ` (current @${d.currentVersion})` : ''),
          )
          .join('\n');
  return { report, problems: probs };
}

export function cmdNotify(root: string, id: string): string {
  const entity = reconcileEntity(root, id);
  const stale = computeDrift(scanRepo(root), buildIndex(root)).filter((d) => d.tag.id === id && d.status === 'stale');
  if (stale.length === 0) return `antidrift: #${id} is now @${entity.version}. No stale usages.`;
  return (
    `antidrift: #${id} changed to @${entity.version}. ${stale.length} usage site(s) are now STALE — ` +
    `re-read .antidrift/entities/${id}.json and revalidate:\n` +
    stale.map((d) => `  ${d.tag.file}:${d.tag.line} (tagged @${d.tag.version})`).join('\n')
  );
}

export function cmdTag(root: string, id: string, target: string): string {
  const i = target.lastIndexOf(':');
  const file = target.slice(0, i);
  const line = Number(target.slice(i + 1));
  const version = readEntity(root, id).version; // throws if id invalid/missing
  const lines = readFileSync(file, 'utf8').split('\n');
  if (!Number.isInteger(line) || line < 1 || line > lines.length + 1) throw new Error(`line ${line} out of range for ${file}`);
  const [pre, post] = commentSyntax(file);
  lines.splice(line - 1, 0, `${pre}antidrift #${id}@${version}${post}`);
  writeFileSync(file, lines.join('\n'));
  return `tagged ${file}:${line} with #${id}@${version}`;
}

const USAGE = 'usage: antidrift <init|list|show <id>|scan|reconcile <id>|notify <id>|tag <id> <file:line>>';
function requireArg(arg: string | undefined, what: string): string {
  if (!arg) throw new Error(`missing <${what}>. ${USAGE}`);
  return arg;
}

function main(): void {
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
        console.log(cmdShow(root, requireArg(arg, 'id')));
        break;
      case 'scan': {
        const r = cmdScan(root);
        console.log(r.report);
        process.exit(r.problems.length ? 1 : 0);
        break;
      }
      case 'reconcile':
        console.log(JSON.stringify(reconcileEntity(root, requireArg(arg, 'id'))));
        break;
      case 'notify':
        console.log(cmdNotify(root, requireArg(arg, 'id')));
        break;
      case 'tag':
        console.log(cmdTag(root, requireArg(arg, 'id'), requireArg(process.argv[4], 'file:line')));
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

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
