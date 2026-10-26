import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { computeHash, entityPath, ID_RE, storeDir } from '../store.js';
import type { Token, TokenValue } from './tokens.js';

export interface Component {
  id: string;
  version: number;
  hash: string;
  title?: string;
  summary?: string;
  variants: string[];
  states: string[];
  /** variant → state → property → "{token.path}" */
  styles: Record<string, Record<string, Record<string, string>>>;
}

const REF_RE = /^\{([A-Za-z0-9_.-]+)\}$/;

export const componentsDir = (root: string) => join(storeDir(root), 'components');
export const componentPath = (root: string, id: string) => {
  if (!id || !ID_RE.test(id) || /^\.+$/.test(id)) throw new Error(`Invalid component id: ${JSON.stringify(id)}`);
  return join(componentsDir(root), `${id}.json`);
};

export function listComponentIds(root: string): string[] {
  if (!existsSync(componentsDir(root))) return [];
  return readdirSync(componentsDir(root)).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
}

/** Parse + validate one component file; errors name the file instead of throwing. */
export function loadComponent(root: string, id: string): { component: Component } | { error: string } {
  const rel = `components/${id}.json`;
  let c: Component;
  try {
    c = JSON.parse(readFileSync(componentPath(root, id), 'utf8')) as Component;
  } catch (e) {
    return { error: `${rel}: ${e instanceof SyntaxError ? 'invalid JSON' : 'unreadable'} (${(e as Error).message})` };
  }
  if (!c || typeof c !== 'object' || Array.isArray(c)) return { error: `${rel}: must be a JSON object` };
  if (c.id !== id) return { error: `${rel}: id ${JSON.stringify(c.id)} doesn't match the file name` };
  if (!Number.isInteger(c.version) || c.version < 1) return { error: `${rel}: "version" must be a positive integer` };
  if (typeof c.hash !== 'string') return { error: `${rel}: "hash" must be a string ("" for a new component)` };
  try {
    validateComponent(c);
  } catch (e) {
    return { error: `${rel}: ${(e as Error).message}` };
  }
  return { component: c };
}

export function readComponent(root: string, id: string): Component {
  const r = loadComponent(root, id);
  if ('error' in r) throw new Error(r.error);
  return r.component;
}

export function validateComponent(c: Component): void {
  const fail = (why: string): never => {
    throw new Error(`Invalid component "${c.id}": ${why}`);
  };
  const names = (v: unknown, what: string) => {
    if (!Array.isArray(v) || !v.length || !v.every((x) => typeof x === 'string' && /^[A-Za-z0-9_-]+$/.test(x)))
      fail(`"${what}" must be a non-empty list of names (letters, digits, "_" or "-")`);
  };
  names(c.variants, 'variants');
  names(c.states, 'states');
  if (!c.states.includes('default')) fail('"states" must include "default"');
  if (!c.styles || typeof c.styles !== 'object') fail('"styles" is required');
  for (const v of c.variants) if (!c.styles[v]?.default) fail(`variant ${v} needs a "default" style block`);
  for (const [v, byState] of Object.entries(c.styles)) {
    if (!c.variants.includes(v)) fail(`styles has unknown variant ${v}`);
    for (const [s, props] of Object.entries(byState)) {
      if (!c.states.includes(s)) fail(`styles.${v} has unknown state ${s}`);
      for (const [p, ref] of Object.entries(props))
        if (typeof ref !== 'string' || !REF_RE.test(ref)) fail(`${v}.${s}.${p} must be a token reference like "{color.brand.primary}"`);
    }
  }
}

export function writeComponent(root: string, c: Component): void {
  validateComponent(c);
  if (existsSync(entityPath(root, c.id))) throw new Error(`"${c.id}" is already an entity id; component ids must be unique`);
  mkdirSync(componentsDir(root), { recursive: true });
  writeFileSync(componentPath(root, c.id), JSON.stringify(c, null, 2) + '\n');
}

const specHash = (c: Component) => computeHash({ variants: c.variants, states: c.states, styles: c.styles });

/** Same rules as entities: an empty hash is stamped without a bump; any spec change bumps. */
export function reconcileComponent(root: string, id: string): Component {
  const c = readComponent(root, id);
  const hash = specHash(c);
  if (c.hash === '') {
    c.hash = hash;
    writeComponent(root, c);
  } else if (hash !== c.hash) {
    c.version += 1;
    c.hash = hash;
    writeComponent(root, c);
  }
  return c;
}

export interface ResolvedSlot {
  ref: string;
  value: TokenValue | null;
}

/** Every variant × every state, with each state merged over its variant's default. */
export function resolveMatrix(c: Component, tokens: Map<string, Token>): Record<string, Record<string, Record<string, ResolvedSlot>>> {
  const out: Record<string, Record<string, Record<string, ResolvedSlot>>> = {};
  for (const v of c.variants) {
    out[v] = {};
    for (const s of c.states) {
      const merged = { ...(c.styles[v]?.default ?? {}), ...(c.styles[v]?.[s] ?? {}) };
      out[v][s] = Object.fromEntries(
        Object.entries(merged).map(([p, ref]) => [p, { ref, value: tokens.get(ref.match(REF_RE)?.[1] ?? '')?.value ?? null }]),
      );
    }
  }
  return out;
}

export interface BrokenTokenRef {
  component: string;
  slot: string;
  ref: string;
}

/** References to tokens that don't exist, reported where they are written (not per inherited state). */
export function brokenTokenRefs(c: Component, tokens: Map<string, Token>): BrokenTokenRef[] {
  const out: BrokenTokenRef[] = [];
  for (const [v, byState] of Object.entries(c.styles ?? {}))
    for (const [s, props] of Object.entries(byState))
      for (const [p, ref] of Object.entries(props))
        if (!tokens.has(ref.match(REF_RE)?.[1] ?? '')) out.push({ component: c.id, slot: `${v}.${s}.${p}`, ref });
  return out;
}
