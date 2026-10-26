import type { Token } from './tokens.js';
export interface ColorLiteral {
    raw: string;
    hex: string;
    column: number;
}
export declare const UI_EXTENSIONS: Set<string>;
export { BUILD_DIRS as BUILD_SKIP_DIRS } from '../scanner.js';
export declare const isGeneratedFile: (rel: string) => boolean;
/** Test code legitimately compares against literal colors; the hardcoded check skips it. */
export declare const isTestFile: (rel: string) => boolean;
/**
 * Blank out comments outside string literals, keeping every line and column where it was so findings
 * still point at the right place. Comment syntax follows the file type: `//` only where the language
 * has it (not CSS or HTML), `<!-- -->` in markup, JS regex literals and Dart/Kotlin/Swift triple-quoted
 * strings are kept as code.
 */
export declare function stripComments(src: string, ext?: string): string;
/** Color literals in one line of code, normalized so they can be compared with token values. */
export declare function findColorLiterals(line: string): ColorLiteral[];
/** Resolved color value → the (non-alias) token paths that hold it. */
export declare function colorIndex(tokens: Map<string, Token>): Map<string, string[]>;
