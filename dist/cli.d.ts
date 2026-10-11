#!/usr/bin/env node
import type { DriftItem } from './types.js';
export declare function cmdList(root: string): string;
export declare function cmdShow(root: string, id: string): string;
export declare function cmdScan(root: string): {
    report: string;
    problems: DriftItem[];
};
export declare function cmdNotify(root: string, id: string): string;
