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
}
interface RawToken {
  path: string;
  type?: TokenType;
  raw: unknown;
  description?: string;
  file: string;
}

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
      out.push({
        path: path.join('.'),
        type,
        raw: node.$value,
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
    } else {
      const value = parseValue(e);
      token = { path, type: value.type, value, description: e.description, file: e.file };
    }
    out.set(path, token);
    return token;
  };
  for (const path of [...raw.keys()].sort()) resolve(path, [path]);
  return out;
}

export function loadTokens(root: string): Map<string, Token> {
  const dir = tokensDir(root);
  if (!existsSync(dir)) return new Map();
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
  return resolveTokenTree(entries);
}
