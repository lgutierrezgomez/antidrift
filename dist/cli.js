#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { buildIndex, computeIndex, readEntity, readAllEntities, writeEntity, assertValidSchema, reconcileEntity, initStore, storeDir } from './store.js';
import { scanRepo } from './scanner.js';
import { computeDrift, problems } from './drift.js';
import { computeBrokenRefs } from './relationships.js';
import { commentSyntax } from './comment.js';
import { IMPORTERS } from './importers.js';
import { EMITTERS } from './emitters.js';
export function cmdList(root) {
    const index = computeIndex(root);
    if (index.length === 0)
        return 'No entities. Run `antidrift init`, then add files under .antidrift/entities/.';
    return index.map((e) => `#${e.id}@${e.version}  ${e.title} — ${e.summary}`).join('\n');
}
export function cmdShow(root, id) {
    const e = readEntity(root, id);
    const index = computeIndex(root);
    const known = new Set(index.map((x) => x.id));
    const drift = computeDrift(scanRepo(root).filter((t) => t.id === id), index);
    const sites = drift.map((d) => `  ${d.tag.file}:${d.tag.line}  @${d.tag.version}  [${d.status}]`).join('\n') || '  (no usages tagged)';
    const outgoing = (e.relationships ?? []).map((r) => `  #${r}${known.has(r) ? '' : ' [broken-ref]'}`).join('\n') || '  (none)';
    const incoming = readAllEntities(root)
        .filter((x) => (x.relationships ?? []).includes(id))
        .map((x) => `  #${x.id}`)
        .join('\n') || '  (none)';
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
    ]
        .filter(Boolean)
        .join('\n');
}
export function cmdScan(root) {
    const index = computeIndex(root);
    const tags = scanRepo(root);
    const probs = problems(computeDrift(tags, index));
    const brokenRefs = computeBrokenRefs(readAllEntities(root), new Set(index.map((e) => e.id)));
    const total = probs.length + brokenRefs.length;
    const lines = [
        ...probs.map((d) => `  ${d.tag.file}:${d.tag.line}  #${d.tag.id}@${d.tag.version} -> ${d.status}` +
            (d.currentVersion !== null ? ` (current @${d.currentVersion})` : '')),
        ...brokenRefs.map((b) => `  #${b.entity} -> #${b.ref} [broken-ref]`),
    ];
    const report = total === 0 ? `Scanned ${tags.length} tag(s). No drift.` : `Scanned ${tags.length} tag(s). ${total} problem(s):\n` + lines.join('\n');
    return { report, problems: probs, brokenRefs };
}
export function cmdNotify(root, id) {
    const entity = reconcileEntity(root, id);
    const stale = computeDrift(scanRepo(root), buildIndex(root)).filter((d) => d.tag.id === id && d.status === 'stale');
    if (stale.length === 0)
        return `antidrift: #${id} is now @${entity.version}. No stale usages.`;
    return (`antidrift: #${id} changed to @${entity.version}. ${stale.length} usage site(s) are now STALE — ` +
        `re-read .antidrift/entities/${id}.json and revalidate:\n` +
        stale.map((d) => `  ${d.tag.file}:${d.tag.line} (tagged @${d.tag.version})`).join('\n'));
}
export function cmdTag(root, id, target) {
    const i = target.lastIndexOf(':');
    const file = target.slice(0, i);
    const line = Number(target.slice(i + 1));
    const version = readEntity(root, id).version; // throws if id invalid/missing
    const lines = readFileSync(file, 'utf8').split('\n');
    if (!Number.isInteger(line) || line < 1 || line > lines.length + 1)
        throw new Error(`line ${line} out of range for ${file}`);
    const [pre, post] = commentSyntax(file);
    lines.splice(line - 1, 0, `${pre}antidrift #${id}@${version}${post}`);
    writeFileSync(file, lines.join('\n'));
    return `tagged ${file}:${line} with #${id}@${version}`;
}
export function cmdImport(root, format, file) {
    const importer = IMPORTERS[format];
    if (!importer)
        throw new Error(`unknown import format: ${format} (have: ${Object.keys(IMPORTERS).join(', ')})`);
    const entities = importer(readFileSync(file, 'utf8'), basename(file).replace(/\.[^.]+$/, ''));
    // Validate all schemas before writing any — import is all-or-nothing.
    for (const e of entities)
        assertValidSchema(e.id, e.schema);
    for (const e of entities)
        writeEntity(root, e);
    buildIndex(root);
    return `imported ${entities.length} entity file(s) from ${file}`;
}
export async function cmdGenTypes(root, lang = 'ts', out) {
    const emitter = EMITTERS.get(lang);
    if (!emitter)
        throw new Error(`unknown emitter lang: ${lang} (have: ${[...EMITTERS.keys()].join(', ')})`);
    const code = await emitter.emit(readAllEntities(root));
    const dest = out ?? join(storeDir(root), 'generated', `types.${emitter.ext}`);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, code);
    return `wrote ${dest}`;
}
const USAGE = 'usage: antidrift <init|list|show <id>|scan|reconcile <id>|notify <id>|tag <id> <file:line>|import <format> <file>|gen-types [lang] [out]>';
function requireArg(arg, what) {
    if (!arg)
        throw new Error(`missing <${what}>. ${USAGE}`);
    return arg;
}
async function main() {
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
                process.exit(r.problems.length + r.brokenRefs.length ? 1 : 0);
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
            case 'import':
                console.log(cmdImport(root, requireArg(arg, 'format'), requireArg(process.argv[4], 'file')));
                break;
            case 'gen-types':
                console.log(await cmdGenTypes(root, arg ?? 'ts', process.argv[4]));
                break;
            default:
                console.error(USAGE);
                process.exit(2);
        }
    }
    catch (e) {
        console.error('antidrift: ' + e.message);
        process.exit(2);
    }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((e) => {
        console.error('antidrift: ' + e.message);
        process.exit(2);
    });
}
