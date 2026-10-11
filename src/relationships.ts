import type { Entity } from './types.js';

export interface BrokenRef {
  entity: string;
  ref: string;
}

/** A relationship id that isn't a known entity is a broken reference. */
export function computeBrokenRefs(entities: Entity[], knownIds: Set<string>): BrokenRef[] {
  const out: BrokenRef[] = [];
  for (const e of entities) for (const r of e.relationships ?? []) if (!knownIds.has(r)) out.push({ entity: e.id, ref: r });
  return out;
}
