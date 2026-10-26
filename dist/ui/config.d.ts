import { type ModeAxis, type Token } from './tokens.js';
export interface UiTarget {
    lang: string;
    out: string;
    className?: string;
}
export interface UiConfig {
    targets: UiTarget[];
    ignore: string[];
    hardcoded: 'warn' | 'error';
    modes: ModeAxis[];
}
export declare const uiConfigPath: (root: string) => string;
/** The UI module is on only when its folders exist — otherwise antidrift behaves as before. */
export declare const uiEnabled: (root: string) => boolean;
export declare function readUiConfig(root: string): UiConfig;
/** Minimal glob: `**` spans directories, `*` stays within one, `?` is one character. Matches repo-relative POSIX paths. */
export declare function globToRegExp(glob: string): RegExp;
export declare function generateTarget(root: string, t: UiTarget, tokens?: Map<string, Token>, modes?: ModeAxis[]): string;
/** Targets whose file is missing or differs from a fresh generation (tokens changed, or hand-edited). */
export declare function staleTargets(root: string, cfg?: UiConfig): UiTarget[];
