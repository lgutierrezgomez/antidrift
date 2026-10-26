import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { storeDir } from '../store.js';

export type TokenType = 'color' | 'dimension' | 'fontFamily' | 'fontWeight' | 'number' | 'duration';
export type TokenValue =
  | { type: 'color'; hex: string } // normalized '#RRGGBBAA', uppercase
  | { type: 'dimension'; value: number; unit: 'px' | 'rem' }
  | { type: 'fontFamily'; families: string[] }
  | { type: 'fontWeight'; weight: number }
  | { type: 'number'; value: number }
  | { type: 'duration'; ms: number };
export interface Token {
  path: string;
  type: TokenType;
  value: TokenValue;
  aliasOf?: string;
  description?: string;
  file: string;
  /** Mode overrides keyed by sorted, '+'-joined mode names ('dark', 'dark+savile'). Aliases inherit their target's. */
  modes?: Record<string, TokenValue>;
  /** Override keys an alias declares itself (emitters only restate those; the rest follow the target). */
  ownModeKeys?: string[];
}
export interface RawToken {
  path: string;
  type?: TokenType;
  raw: unknown;
  modes?: Record<string, unknown>;
  description?: string;
  file: string;
}
/** One mode dimension declared in ui.json; `values[0]` is the default (it never needs an override). */
export interface ModeAxis {
  axis: string;
  values: string[];
  attribute: string;
  followSystem?: boolean;
}

export const MODES_EXTENSION = 'com.antidrift.modes';
const modeKey = (parts: string[]) => [...parts].sort().join('+');

const TYPES = new Set<TokenType>(['color', 'dimension', 'fontFamily', 'fontWeight', 'number', 'duration']);
const SEGMENT_RE = /^[A-Za-z0-9_-]+$/;
const ALIAS_RE = /^\{([A-Za-z0-9_.-]+)\}$/;
const FAMILY_RE = /^[A-Za-z0-9 _-]+$/;
const WEIGHTS: Record<string, number> = {
  thin: 100,
  'extra-light': 200,
  light: 300,
  normal: 400,
  regular: 400,
  medium: 500,
  'semi-bold': 600,
  bold: 700,
  'extra-bold': 800,
  black: 900,
};

export const tokensDir = (root: string) => join(storeDir(root), 'tokens');

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Flatten one DTCG document into raw tokens (group `$type` inherited, `$`-keys are metadata). */
export function parseTokenTree(doc: unknown, file: string): RawToken[] {
  const out: RawToken[] = [];
  const walk = (node: Record<string, unknown>, path: string[], inherited?: TokenType) => {
    const type = (node.$type as TokenType | undefined) ?? inherited;
    if (node.$type !== undefined && !TYPES.has(node.$type as TokenType))
      throw new Error(`${file}: ${path.join('.') || '(root)'} has unsupported $type ${JSON.stringify(node.$type)}`);
    if ('$value' in node) {
      const ext = isObj(node.$extensions) ? node.$extensions[MODES_EXTENSION] : undefined;
      if (ext !== undefined && !isObj(ext)) throw new Error(`${file}: ${path.join('.')} ${MODES_EXTENSION} must be an object`);
      out.push({
        path: path.join('.'),
        type,
        raw: node.$value,
        ...(ext ? { modes: ext } : {}),
        description: typeof node.$description === 'string' ? node.$description : undefined,
        file,
      });
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('$')) continue;
      if (!SEGMENT_RE.test(k)) throw new Error(`${file}: invalid token name ${JSON.stringify(k)} under ${path.join('.') || '(root)'}`);
      if (!isObj(v)) throw new Error(`${file}: ${[...path, k].join('.')} must be a group or a token object`);
      walk(v, [...path, k], type);
    }
  };
  if (!isObj(doc)) throw new Error(`${file}: token file must be a JSON object`);
  walk(doc, []);
  return out;
}

function parseUnit(raw: unknown, units: string[]): { value: number; unit: string } | null {
  if (isObj(raw) && typeof raw.value === 'number' && Number.isFinite(raw.value) && units.includes(raw.unit as string))
    return { value: raw.value, unit: raw.unit as string };
  if (typeof raw === 'string') {
    const m = raw.trim().match(/^(-?\d*\.?\d+)([a-z]+)$/);
    if (m && units.includes(m[2])) return { value: Number(m[1]), unit: m[2] };
  }
  return null;
}

function parseValue(t: RawToken): TokenValue {
  const fail = (why: string): never => {
    throw new Error(`${t.file}: token ${t.path} ${why}`);
  };
  const raw = t.raw;
  switch (t.type) {
    case 'color': {
      let hex: unknown = raw;
      let alpha: number | undefined;
      if (isObj(raw)) {
        hex = raw.hex;
        if (typeof raw.alpha === 'number') alpha = raw.alpha;
      }
      if (typeof hex !== 'string' || !/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(hex)) return fail('needs a #RRGGBB or #RRGGBBAA color');
      let h = hex.toUpperCase();
      if (h.length === 7) {
        const a = alpha === undefined ? 255 : Math.round(Math.min(1, Math.max(0, alpha)) * 255);
        h += a.toString(16).padStart(2, '0').toUpperCase();
      }
      return { type: 'color', hex: h };
    }
    case 'dimension': {
      const d = parseUnit(raw, ['px', 'rem']);
      if (!d) return fail('needs a dimension like {"value":8,"unit":"px"} or "8px"');
      return { type: 'dimension', value: d.value, unit: d.unit as 'px' | 'rem' };
    }
    case 'fontFamily': {
      const families = Array.isArray(raw) ? raw : [raw];
      if (!families.length || !families.every((f) => typeof f === 'string' && FAMILY_RE.test(f)))
        return fail('needs font family names made of letters, digits, spaces, "_" or "-"');
      return { type: 'fontFamily', families: families as string[] };
    }
    case 'fontWeight': {
      const w = typeof raw === 'string' ? WEIGHTS[raw] : raw;
      if (typeof w !== 'number' || !Number.isFinite(w) || w < 1 || w > 1000) return fail('needs a weight 1–1000 or a weight keyword');
      return { type: 'fontWeight', weight: w };
    }
    case 'number':
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return fail('needs a finite number');
      return { type: 'number', value: raw };
    case 'duration': {
      const d = parseUnit(raw, ['ms', 's']);
      if (!d) return fail('needs a duration like "200ms" or {"value":0.2,"unit":"s"}');
      return { type: 'duration', ms: d.unit === 's' ? Math.round(d.value * 1000) : d.value };
    }
    default:
      return fail('has no $type (set it on the token or a parent group)');
  }
}

/** Parse a token's mode overrides with the token's own type; keys are normalized ('savile+dark' → 'dark+savile'). */
function parseModes(t: RawToken): Record<string, TokenValue> {
  const out: Record<string, TokenValue> = {};
  for (const [k, raw] of Object.entries(t.modes ?? {})) {
    if (!/^[A-Za-z0-9_-]+(\+[A-Za-z0-9_-]+)*$/.test(k)) throw new Error(`${t.file}: token ${t.path} has an invalid mode name ${JSON.stringify(k)}`);
    if (typeof raw === 'string' && ALIAS_RE.test(raw)) throw new Error(`${t.file}: token ${t.path} mode ${k} must be a literal value, not an alias`);
    out[modeKey(k.split('+'))] = parseValue({ ...t, path: `${t.path} (mode ${k})`, raw });
  }
  return out;
}

/** Every combination of non-default mode values, first axis varying fastest; [] is the default context. */
export function modeContexts(axes: ModeAxis[]): string[][] {
  let out: string[][] = [[]];
  for (const a of axes) out = a.values.flatMap((v, i) => out.map((ctx) => (i === 0 ? ctx : [...ctx, v])));
  return out;
}

/** The override keys of `t` that apply in `ctx`, most specific first. */
const applicable = (t: Token, ctx: string[]) =>
  Object.keys(t.modes ?? {})
    .filter((k) => k.split('+').every((p) => ctx.includes(p)))
    .sort((a, b) => b.split('+').length - a.split('+').length);

/** A token's value in a mode context: the most specific applicable override, else its default value. */
export function resolveFor(t: Token, ctx: string[]): TokenValue {
  const [best] = applicable(t, ctx);
  return best ? t.modes![best] : t.value;
}

/** Mode names must be declared, one per axis, non-default, and every context must have one most-specific value. */
export function validateTokenModes(tokens: Map<string, Token>, axes: ModeAxis[]): void {
  const axisOf = new Map<string, ModeAxis>();
  for (const a of axes) a.values.slice(1).forEach((v) => axisOf.set(v, a));
  const contexts = modeContexts(axes);
  for (const t of tokens.values()) {
    if (!t.modes) continue;
    for (const k of Object.keys(t.modes)) {
      const seen = new Set<string>();
      for (const p of k.split('+')) {
        const a = axisOf.get(p);
        if (!a) throw new Error(`token ${t.path} mode "${k}": "${p}" isn't a non-default value of any ui.json "modes" axis`);
        if (seen.has(a.axis)) throw new Error(`token ${t.path} mode "${k}" names two values of the "${a.axis}" axis`);
        seen.add(a.axis);
      }
    }
    for (const ctx of contexts) {
      const keys = applicable(t, ctx);
      const top = keys.filter((k) => k.split('+').length === keys[0]?.split('+').length);
      if (top.length > 1) {
        const need = modeKey(top.flatMap((k) => k.split('+')).filter((p, i, all) => all.indexOf(p) === i));
        throw new Error(`token ${t.path}: modes ${top.join(' and ')} both apply together; add a "${need}" value`);
      }
    }
  }
}

/** Merge raw tokens into resolved tokens: duplicate paths, missing alias targets and cycles are errors. */
export function resolveTokenTree(entries: RawToken[]): Map<string, Token> {
  const raw = new Map<string, RawToken>();
  for (const e of entries) {
    const prev = raw.get(e.path);
    if (prev) throw new Error(`token ${e.path} is defined twice (${prev.file} and ${e.file})`);
    raw.set(e.path, e);
  }
  const out = new Map<string, Token>();
  const resolve = (path: string, stack: string[]): Token => {
    const done = out.get(path);
    if (done) return done;
    const e = raw.get(path)!;
    const alias = typeof e.raw === 'string' ? e.raw.match(ALIAS_RE) : null;
    let token: Token;
    if (alias) {
      const target = alias[1];
      if (stack.includes(target)) throw new Error(`token alias cycle: ${[...stack, target].join(' -> ')}`);
      if (!raw.has(target)) throw new Error(`${e.file}: token ${path} references missing token ${target}`);
      const t = resolve(target, [...stack, target]);
      if (e.type && e.type !== t.type) throw new Error(`${e.file}: token ${path} is ${e.type} but aliases ${t.type} token ${target}`);
      token = { path, type: t.type, value: t.value, aliasOf: target, description: e.description, file: e.file };
      const own = parseModes({ ...e, type: t.type });
      const modes = { ...t.modes, ...own };
      if (Object.keys(modes).length) token.modes = modes;
      if (Object.keys(own).length) token.ownModeKeys = Object.keys(own);
    } else {
      const value = parseValue(e);
      token = { path, type: value.type, value, description: e.description, file: e.file };
      const own = parseModes(e);
      if (Object.keys(own).length) token.modes = own;
    }
    out.set(path, token);
    return token;
  };
  for (const path of [...raw.keys()].sort()) resolve(path, [path]);
  return out;
}

/** Raw (unresolved) tokens from every file in .antidrift/tokens/, in file-name order. */
export function loadRawTokens(root: string): RawToken[] {
  const dir = tokensDir(root);
  if (!existsSync(dir)) return [];
  const entries: RawToken[] = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    let doc: unknown;
    try {
      doc = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    } catch (e) {
      throw new Error(`${name}: invalid JSON (${(e as Error).message})`);
    }
    entries.push(...parseTokenTree(doc, name));
  }
  return entries;
}

export const loadTokens = (root: string): Map<string, Token> => resolveTokenTree(loadRawTokens(root));
