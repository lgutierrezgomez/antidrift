import { compile } from 'json-schema-to-typescript';
import type { Entity } from './types.js';

export interface Emitter {
  lang: string;
  ext: string;
  emit(entities: Entity[]): Promise<string> | string;
}

const pascal = (s: string) => s.replace(/(^|[_.\-])(\w)/g, (_m, _sep, c: string) => c.toUpperCase());

// json-schema-to-typescript honors these keywords by emitting raw TS verbatim — a code-injection
// vector when entity schemas come from untrusted imports. Strip them before compiling.
const UNSAFE_KEYS = new Set(['tsType', 'tsEnumNames']);
function sanitizeForCompile(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeForCompile);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) if (!UNSAFE_KEYS.has(k)) out[k] = sanitizeForCompile(v);
    return out;
  }
  return node;
}

export const tsEmitter: Emitter = {
  lang: 'ts',
  ext: 'ts',
  async emit(entities) {
    const parts: string[] = [];
    for (const e of entities) {
      parts.push(
        await compile(sanitizeForCompile(e.schema) as object, pascal(e.id), {
          bannerComment: '',
          additionalProperties: false,
          // Never resolve external refs — importer input is untrusted (no file read / SSRF).
          $refOptions: { resolve: { file: false, http: false } },
        }),
      );
    }
    return parts.join('\n');
  },
};

export const EMITTERS = new Map<string, Emitter>([[tsEmitter.lang, tsEmitter]]);
