#!/usr/bin/env node
import { type BrokenRef, type DerivedDrift } from './relationships.js';
import { type UiScanResult } from './ui/scan.js';
import { cmdShowComponent, cmdTokens, cmdNotifyTokens, cmdUiInit } from './ui/commands.js';
import type { DriftItem } from './types.js';
export { cmdShowComponent, cmdTokens, cmdNotifyTokens, cmdUiInit };
export declare function cmdList(root: string): string;
export declare function cmdShow(root: string, id: string): string;
export declare function cmdScan(root: string): {
    report: string;
    problems: DriftItem[];
    brokenRefs: BrokenRef[];
    derived: DerivedDrift[];
    ui: UiScanResult | null;
};
export declare function cmdNotify(root: string, id: string): string;
export type TagMode = {
    kind: 'impl';
} | {
    kind: 'use';
    variant?: string;
};
export declare function cmdTag(root: string, id: string, target: string, mode?: TagMode): string;
export declare function cmdImport(root: string, format: string, file: string): string;
export declare function cmdGenTypes(root: string, lang?: string, out?: string): Promise<string>;
/** Regenerate token files: every ui.json target, or one ad-hoc `lang` + `out`. */
export declare function cmdGenTokens(root: string, lang?: string, out?: string): string;
