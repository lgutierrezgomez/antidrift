import type { Entity } from './types.js';
export interface Emitter {
    lang: string;
    ext: string;
    emit(entities: Entity[]): Promise<string> | string;
}
export declare const tsEmitter: Emitter;
export declare const EMITTERS: Map<string, Emitter>;
