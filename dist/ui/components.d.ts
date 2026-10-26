import type { Token, TokenValue } from './tokens.js';
export interface Component {
    id: string;
    version: number;
    hash: string;
    title?: string;
    summary?: string;
    variants: string[];
    states: string[];
    /** variant → state → property → "{token.path}" */
    styles: Record<string, Record<string, Record<string, string>>>;
}
export declare const componentsDir: (root: string) => string;
export declare const componentPath: (root: string, id: string) => string;
export declare function listComponentIds(root: string): string[];
/** Parse + validate one component file; errors name the file instead of throwing. */
export declare function loadComponent(root: string, id: string): {
    component: Component;
} | {
    error: string;
};
export declare function readComponent(root: string, id: string): Component;
export declare function validateComponent(c: Component): void;
export declare function writeComponent(root: string, c: Component): void;
/** Same rules as entities: an empty hash is stamped without a bump; any spec change bumps. */
export declare function reconcileComponent(root: string, id: string): Component;
export interface ResolvedSlot {
    ref: string;
    value: TokenValue | null;
}
/** Every variant × every state, with each state merged over its variant's default. */
export declare function resolveMatrix(c: Component, tokens: Map<string, Token>): Record<string, Record<string, Record<string, ResolvedSlot>>>;
export interface BrokenTokenRef {
    component: string;
    slot: string;
    ref: string;
}
/** References to tokens that don't exist, reported where they are written (not per inherited state). */
export declare function brokenTokenRefs(c: Component, tokens: Map<string, Token>): BrokenTokenRef[];
