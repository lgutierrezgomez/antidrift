import type { Entity } from './types.js';
export interface BrokenRef {
    entity: string;
    ref: string;
}
/** A relationship id that isn't a known entity is a broken reference. */
export declare function computeBrokenRefs(entities: Entity[], knownIds: Set<string>): BrokenRef[];
