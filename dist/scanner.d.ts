import type { UsageTag } from './types.js';
export declare function parseTags(content: string): Array<{
    id: string;
    version: number;
    line: number;
}>;
export declare function scanFile(path: string, root: string): UsageTag[];
export declare function scanRepo(root: string): UsageTag[];
