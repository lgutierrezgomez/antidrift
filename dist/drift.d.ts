import type { UsageTag, IndexEntry, DriftItem } from './types.js';
export declare function computeDrift(tags: UsageTag[], index: IndexEntry[]): DriftItem[];
export declare const problems: (items: DriftItem[]) => DriftItem[];
