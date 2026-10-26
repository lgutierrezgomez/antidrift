import { type Token, type TokenValue } from './tokens.js';
import { type ImplTag, type UseTag } from './tags.js';
/** `  [dark: #58A6FF, savile: …]` for a token with mode values, else ''. */
export declare function formatModes(t: Token | undefined): string;
export declare function formatTokenValue(v: TokenValue): string;
/** Every impl/use tag in the repo (walkFiles already skips build output folders). */
export declare function collectUiTags(root: string): {
    impls: ImplTag[];
    uses: UseTag[];
};
/** Compact by default (each non-default state lists only what it changes); `full` expands every slot. */
export declare function cmdShowComponent(root: string, id: string, opts?: {
    full?: boolean;
}): string;
export declare function cmdTokens(root: string, prefix?: string): string;
export declare function cmdNotifyComponent(root: string, id: string): string;
export declare function cmdNotifyTokens(root: string): string;
/** Copy a DTCG file into .antidrift/tokens/ after validating it together with the existing tokens. */
export declare function cmdImportTokens(root: string, file: string): string;
export declare function cmdUiInit(root: string): string;
