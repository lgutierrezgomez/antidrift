import type { Entity } from './types.js';
export interface BrokenRef {
    entity: string;
    ref: string;
}
/** A relationship id that isn't a known entity is a broken reference. */
export declare function computeBrokenRefs(entities: Entity[], knownIds: Set<string>): BrokenRef[];
export interface DerivedDrift {
    entity: string;
    base: string;
    builtOn: number;
    currentVersion: number | null;
    status: 'stale' | 'orphan';
}
/** A projection whose base entity moved past the version it was written against (or vanished). */
export declare function computeDerivedDrift(entities: Entity[], versions: Map<string, number>): DerivedDrift[];
