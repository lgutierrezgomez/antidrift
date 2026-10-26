import type { UsageTag } from './types.js';
/** Build output folders: they hold copies of source comments, so their tags would be duplicates (and go stale on their own). */
export declare const BUILD_DIRS: Set<string>;
export declare function parseTags(content: string): Array<{
    id: string;
    version: number;
    line: number;
}>;
export declare function scanFile(path: string, root: string): UsageTag[];
/** Every regular file under root (default ignores, no symlinks, size-capped), with its POSIX relative path. */
export declare function walkFiles(root: string, skip?: (rel: string, isDir: boolean) => boolean): Generator<{
    path: string;
    rel: string;
}>;
export declare function scanRepo(root: string): UsageTag[];
