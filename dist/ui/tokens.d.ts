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
}
export interface RawToken {
    path: string;
    type?: TokenType;
    raw: unknown;
    description?: string;
    file: string;
}
export declare const tokensDir: (root: string) => string;
/** Flatten one DTCG document into raw tokens (group `$type` inherited, `$`-keys are metadata). */
export declare function parseTokenTree(doc: unknown, file: string): RawToken[];
/** Merge raw tokens into resolved tokens: duplicate paths, missing alias targets and cycles are errors. */
export declare function resolveTokenTree(entries: RawToken[]): Map<string, Token>;
/** Raw (unresolved) tokens from every file in .antidrift/tokens/, in file-name order. */
export declare function loadRawTokens(root: string): RawToken[];
export declare const loadTokens: (root: string) => Map<string, Token>;
