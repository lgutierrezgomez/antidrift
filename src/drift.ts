import type { UsageTag, IndexEntry, DriftItem } from './types.js';

export function computeDrift(tags: UsageTag[], index: IndexEntry[]): DriftItem[] {
  const current = new Map(index.map((e) => [e.id, e.version]));
  return tags.map((tag) => {
    const currentVersion = current.has(tag.id) ? current.get(tag.id)! : null;
    const status: DriftItem['status'] =
      currentVersion === null ? 'orphan' : tag.version < currentVersion ? 'stale' : 'ok';
    return { tag, currentVersion, status };
  });
}

export const problems = (items: DriftItem[]): DriftItem[] => items.filter((i) => i.status !== 'ok');
