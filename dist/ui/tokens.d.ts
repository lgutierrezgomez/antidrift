export type TokenType = 'color' | 'dimension' | 'fontFamily' | 'fontWeight' | 'number' | 'duration';
export type TokenValue = {
    type: 'color';
    hex: string;
} | {
    type: 'dimension';
    value: number;
    unit: 'px' | 'rem';
} | {
    type: 'fontFamily';
    families: string[];
} | {
    type: 'fontWeight';
    weight: number;
} | {
    type: 'number';
    value: number;
} | {
    type: 'duration';
    ms: number;
};
export interface Token {
    path: string;
    type: TokenType;
    value: TokenValue;
    aliasOf?: string;
    description?: string;
    file: string;
    /** Mode overrides keyed by sorted, '+'-joined mode names ('dark', 'dark+savile'). Aliases inherit their target's. */
    modes?: Record<string, TokenValue>;
    /** Override keys an alias declares itself (emitters only restate those; the rest follow the target). */
    ownModeKeys?: string[];
}
export interface RawToken {
    path: string;
    type?: TokenType;
    raw: unknown;
    modes?: Record<string, unknown>;
    description?: string;
    file: string;
}
/** One mode dimension declared in ui.json; `values[0]` is the default (it never needs an override). */
export interface ModeAxis {
    axis: string;
    values: string[];
    attribute: string;
    followSystem?: boolean;
}
export declare const MODES_EXTENSION = "com.antidrift.modes";
export declare const tokensDir: (root: string) => string;
/** Flatten one DTCG document into raw tokens (group `$type` inherited, `$`-keys are metadata). */
export declare function parseTokenTree(doc: unknown, file: string): RawToken[];
/** Every combination of non-default mode values, first axis varying fastest; [] is the default context. */
export declare function modeContexts(axes: ModeAxis[]): string[][];
/** A token's value in a mode context: the most specific applicable override, else its default value. */
export declare function resolveFor(t: Token, ctx: string[]): TokenValue;
/** Mode names must be declared, one per axis, non-default, and every context must have one most-specific value. */
export declare function validateTokenModes(tokens: Map<string, Token>, axes: ModeAxis[]): void;
/** Merge raw tokens into resolved tokens: duplicate paths, missing alias targets and cycles are errors. */
export declare function resolveTokenTree(entries: RawToken[]): Map<string, Token>;
/** Raw (unresolved) tokens from every file in .antidrift/tokens/, in file-name order. */
export declare function loadRawTokens(root: string): RawToken[];
export declare const loadTokens: (root: string) => Map<string, Token>;
