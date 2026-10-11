import { compile } from 'json-schema-to-typescript';
import type { Entity } from './types.js';

export interface Emitter {
  lang: string;
  ext: string;
  emit(entities: Entity[]): Promise<string> | string;
}

const pascal = (s: string) => s.replace(/(^|[_.\-])(\w)/g, (_m, _sep, c: string) => c.toUpperCase());

export const tsEmitter: Emitter = {
  lang: 'ts',
  ext: 'ts',
  async emit(entities) {
    const parts: string[] = [];
    for (const e of entities) {
      parts.push(
        await compile(e.schema as object, pascal(e.id), {
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
