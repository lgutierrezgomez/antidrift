import type { Entity } from './types.js';
export interface Emitter {
    lang: string;
    ext: string;
    emit(entities: Entity[]): Promise<string> | string;
    /** Optional values-only module (no types, no validator) safe to import from browser bundles. */
    emitEnums?(entities: Entity[]): string;
}
export declare const tsEmitter: Emitter;
export declare const EMITTERS: Map<string, Emitter>;
