import type { Entity, IndexEntry } from './types.js';
export declare const storeDir: (root: string) => string;
export declare const entitiesDir: (root: string) => string;
export declare const indexPath: (root: string) => string;
export declare const entityPath: (root: string, id: string) => string;
export declare function computeHash(schema: Record<string, unknown>): string;
export declare function initStore(root: string): void;
export declare function writeEntity(root: string, entity: Entity): void;
export declare const readEntity: (root: string, id: string) => Entity;
export declare function listEntityIds(root: string): string[];
export declare function reconcileEntity(root: string, id: string): Entity;
/** Pure read: compute the index from entity files without writing anything. */
export declare function computeIndex(root: string): IndexEntry[];
/** Compute the index AND persist it to index.json. Use after an entity changes. */
export declare function buildIndex(root: string): IndexEntry[];
export declare function readIndex(root: string): IndexEntry[];
