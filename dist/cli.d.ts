#!/usr/bin/env node
import { type BrokenRef } from './relationships.js';
import type { DriftItem } from './types.js';
export declare function cmdList(root: string): string;
export declare function cmdShow(root: string, id: string): string;
export declare function cmdScan(root: string): {
    report: string;
    problems: DriftItem[];
    brokenRefs: BrokenRef[];
};
export declare function cmdNotify(root: string, id: string): string;
export declare function cmdTag(root: string, id: string, target: string): string;
export declare function cmdImport(root: string, format: string, file: string): string;
export declare function cmdGenTypes(root: string, lang?: string, out?: string): Promise<string>;
