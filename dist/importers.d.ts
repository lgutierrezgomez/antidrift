import type { Entity } from './types.js';
export type Importer = (src: string, name: string) => Entity[];
export declare const sanitizeId: (s: string) => string;
/** Replace any `$ref` node with a self-contained schema. Internal refs would break
 * per-entity compilation; external refs (file://, http://) would leak on resolution. */
export declare function stripRefs(node: unknown): unknown;
export declare const importJsonSchema: Importer;
export declare const importOpenApi: Importer;
export declare const importPrisma: Importer;
export declare const importGraphql: Importer;
export declare const IMPORTERS: Record<string, Importer>;
