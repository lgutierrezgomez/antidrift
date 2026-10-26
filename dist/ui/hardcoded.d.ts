import type { Token } from './tokens.js';
export interface ColorLiteral {
    raw: string;
    hex: string;
    column: number;
}
export declare const UI_EXTENSIONS: Set<string>;
export declare const BUILD_SKIP_DIRS: Set<string>;
export declare const isGeneratedFile: (rel: string) => boolean;
/** Color literals in one line of code, normalized so they can be compared with token values. */
export declare function findColorLiterals(line: string): ColorLiteral[];
/** Resolved color value → the (non-alias) token paths that hold it. */
export declare function colorIndex(tokens: Map<string, Token>): Map<string, string[]>;
