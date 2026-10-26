import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { storeDir } from '../store.js';
import { loadTokens, tokensDir, validateTokenModes } from './tokens.js';
import { TOKEN_EMITTERS, modeClassPart } from './token-emitters.js';
export const uiConfigPath = (root) => join(storeDir(root), 'ui.json');
/** The UI module is on only when its folders exist — otherwise antidrift behaves as before. */
export const uiEnabled = (root) => existsSync(tokensDir(root)) || existsSync(join(storeDir(root), 'components'));
export function readUiConfig(root) {
    const path = uiConfigPath(root);
    if (!existsSync(path))
        return { targets: [], ignore: [], hardcoded: 'warn', modes: [] };
    let raw;
    try {
        raw = JSON.parse(readFileSync(path, 'utf8'));
    }
    catch (e) {
        throw new Error(`ui.json: invalid JSON (${e.message})`);
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw new Error('ui.json: must be a JSON object');
    const targets = (raw.targets ?? []);
    if (!Array.isArray(targets))
        throw new Error('ui.json: "targets" must be an array');
    for (const t of targets) {
        if (!t || typeof t.out !== 'string' || !t.out)
            throw new Error('ui.json: every target needs an "out" path');
        if (!TOKEN_EMITTERS.has(t.lang))
            throw new Error(`ui.json: unknown target lang ${JSON.stringify(t.lang)} (have: ${[...TOKEN_EMITTERS.keys()].join(', ')})`);
    }
    const ignore = (raw.ignore ?? []);
    if (!Array.isArray(ignore) || !ignore.every((g) => typeof g === 'string'))
        throw new Error('ui.json: "ignore" must be an array of globs');
    const hardcoded = (raw.hardcoded ?? 'warn');
    if (hardcoded !== 'warn' && hardcoded !== 'error')
        throw new Error('ui.json: "hardcoded" must be "warn" or "error"');
    return { targets, ignore, hardcoded, modes: readModes(raw.modes) };
}
const NAME_RE = /^[A-Za-z0-9_-]+$/;
const ATTR_RE = /^[a-z][a-z0-9-]*$/;
/** Mode axes: names and attributes are validated because they end up inside generated CSS/Dart. */
function readModes(raw) {
    if (raw === undefined)
        return [];
    if (!Array.isArray(raw))
        throw new Error('ui.json: "modes" must be an array of axes');
    const seen = new Set();
    const classParts = new Map();
    return raw.map((a) => {
        const where = `ui.json: mode axis ${JSON.stringify(a?.axis)}`;
        if (!a || typeof a.axis !== 'string' || !NAME_RE.test(a.axis))
            throw new Error('ui.json: every mode axis needs an "axis" name');
        const values = a.values;
        if (!Array.isArray(values) || values.length < 2 || !values.every((v) => typeof v === 'string' && NAME_RE.test(v)))
            throw new Error(`${where} needs at least two values (the first is the default), made of letters, digits, "_" or "-"`);
        for (const v of values) {
            if (seen.has(v))
                throw new Error(`${where}: value "${v}" is used twice across axes`);
            seen.add(v);
            // Mode values name generated Dart classes, so they must stay distinct once PascalCased.
            const part = modeClassPart(v);
            if (!part)
                throw new Error(`${where}: value "${v}" needs at least one letter or digit`);
            const other = classParts.get(part);
            if (other)
                throw new Error(`${where}: values "${other}" and "${v}" would generate the same class name (${part})`);
            classParts.set(part, v);
        }
        if (typeof a.attribute !== 'string' || !ATTR_RE.test(a.attribute))
            throw new Error(`${where} needs an "attribute" like "data-theme"`);
        return { axis: a.axis, values: values, attribute: a.attribute, ...(a.followSystem === true ? { followSystem: true } : {}) };
    });
}
/** Minimal glob: `**` spans directories, `*` stays within one, `?` is one character. Matches repo-relative POSIX paths. */
export function globToRegExp(glob) {
    let re = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*' && glob[i + 1] === '*') {
            i++;
            if (glob[i + 1] === '/') {
                i++;
                re += '(?:.*/)?';
            }
            else
                re += '.*';
        }
        else if (c === '*')
            re += '[^/]*';
        else if (c === '?')
            re += '[^/]';
        else
            re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`^${re}$`);
}
export function generateTarget(root, t, tokens = loadTokens(root), modes = readUiConfig(root).modes) {
    const emitter = TOKEN_EMITTERS.get(t.lang);
    if (!emitter)
        throw new Error(`unknown token target lang: ${t.lang}`);
    validateTokenModes(tokens, modes);
    return emitter.emit(tokens, { className: t.className, modes });
}
/** Targets whose file is missing or differs from a fresh generation (tokens changed, or hand-edited). */
export function staleTargets(root, cfg = readUiConfig(root)) {
    const tokens = loadTokens(root);
    return cfg.targets.filter((t) => {
        const path = resolve(root, t.out);
        return !existsSync(path) || readFileSync(path, 'utf8') !== generateTarget(root, t, tokens, cfg.modes);
    });
}
