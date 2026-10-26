import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { computeHash, entityPath, ID_RE, storeDir } from '../store.js';
const REF_RE = /^\{([A-Za-z0-9_.-]+)\}$/;
export const componentsDir = (root) => join(storeDir(root), 'components');
export const componentPath = (root, id) => {
    if (!id || !ID_RE.test(id) || /^\.+$/.test(id))
        throw new Error(`Invalid component id: ${JSON.stringify(id)}`);
    return join(componentsDir(root), `${id}.json`);
};
export function listComponentIds(root) {
    if (!existsSync(componentsDir(root)))
        return [];
    return readdirSync(componentsDir(root)).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
}
/** Parse + validate one component file; errors name the file instead of throwing. */
export function loadComponent(root, id) {
    const rel = `components/${id}.json`;
    let c;
    try {
        c = JSON.parse(readFileSync(componentPath(root, id), 'utf8'));
    }
    catch (e) {
        return { error: `${rel}: ${e instanceof SyntaxError ? 'invalid JSON' : 'unreadable'} (${e.message})` };
    }
    if (!c || typeof c !== 'object' || Array.isArray(c))
        return { error: `${rel}: must be a JSON object` };
    if (c.id !== id)
        return { error: `${rel}: id ${JSON.stringify(c.id)} doesn't match the file name` };
    if (!Number.isInteger(c.version) || c.version < 1)
        return { error: `${rel}: "version" must be a positive integer` };
    if (typeof c.hash !== 'string')
        return { error: `${rel}: "hash" must be a string ("" for a new component)` };
    try {
        validateComponent(c);
    }
    catch (e) {
        return { error: `${rel}: ${e.message}` };
    }
    return { component: c };
}
export function readComponent(root, id) {
    const r = loadComponent(root, id);
    if ('error' in r)
        throw new Error(r.error);
    return r.component;
}
export function validateComponent(c) {
    const fail = (why) => {
        throw new Error(`Invalid component "${c.id}": ${why}`);
    };
    const names = (v, what) => {
        if (!Array.isArray(v) || !v.length || !v.every((x) => typeof x === 'string' && /^[A-Za-z0-9_-]+$/.test(x)))
            fail(`"${what}" must be a non-empty list of names (letters, digits, "_" or "-")`);
    };
    names(c.variants, 'variants');
    names(c.states, 'states');
    if (!c.states.includes('default'))
        fail('"states" must include "default"');
    if (!c.styles || typeof c.styles !== 'object')
        fail('"styles" is required');
    for (const v of c.variants)
        if (!c.styles[v]?.default)
            fail(`variant ${v} needs a "default" style block`);
    for (const [v, byState] of Object.entries(c.styles)) {
        if (!c.variants.includes(v))
            fail(`styles has unknown variant ${v}`);
        for (const [s, props] of Object.entries(byState)) {
            if (!c.states.includes(s))
                fail(`styles.${v} has unknown state ${s}`);
            for (const [p, ref] of Object.entries(props))
                if (typeof ref !== 'string' || !REF_RE.test(ref))
                    fail(`${v}.${s}.${p} must be a token reference like "{color.brand.primary}"`);
        }
    }
}
export function writeComponent(root, c) {
    validateComponent(c);
    if (existsSync(entityPath(root, c.id)))
        throw new Error(`"${c.id}" is already an entity id; component ids must be unique`);
    mkdirSync(componentsDir(root), { recursive: true });
    writeFileSync(componentPath(root, c.id), JSON.stringify(c, null, 2) + '\n');
}
const specHash = (c) => computeHash({ variants: c.variants, states: c.states, styles: c.styles });
/** Same rules as entities: an empty hash is stamped without a bump; any spec change bumps. */
export function reconcileComponent(root, id) {
    const c = readComponent(root, id);
    const hash = specHash(c);
    if (c.hash === '') {
        c.hash = hash;
        writeComponent(root, c);
    }
    else if (hash !== c.hash) {
        c.version += 1;
        c.hash = hash;
        writeComponent(root, c);
    }
    return c;
}
/** Every variant × every state, with each state merged over its variant's default. */
export function resolveMatrix(c, tokens) {
    const out = {};
    for (const v of c.variants) {
        out[v] = {};
        for (const s of c.states) {
            const merged = { ...(c.styles[v]?.default ?? {}), ...(c.styles[v]?.[s] ?? {}) };
            out[v][s] = Object.fromEntries(Object.entries(merged).map(([p, ref]) => [p, { ref, value: tokens.get(ref.match(REF_RE)?.[1] ?? '')?.value ?? null }]));
        }
    }
    return out;
}
/** References to tokens that don't exist, reported where they are written (not per inherited state). */
export function brokenTokenRefs(c, tokens) {
    const out = [];
    for (const [v, byState] of Object.entries(c.styles ?? {}))
        for (const [s, props] of Object.entries(byState))
            for (const [p, ref] of Object.entries(props))
                if (!tokens.has(ref.match(REF_RE)?.[1] ?? ''))
                    out.push({ component: c.id, slot: `${v}.${s}.${p}`, ref });
    return out;
}
