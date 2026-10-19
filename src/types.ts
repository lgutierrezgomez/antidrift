export interface Entity {
  id: string;
  version: number;
  hash: string;
  title?: string;
  summary?: string;
  relationships?: string[];
  /** Projections: base entity id -> the base version this entity's schema was written against. */
  derivedFrom?: Record<string, number>;
  schema: Record<string, unknown>;
}
export interface IndexEntry {
  id: string;
  title: string;
  version: number;
  hash: string;
  summary: string;
  file: string;
}
export interface UsageTag {
  id: string;
  version: number;
  file: string;
  line: number;
}
export type DriftStatus = 'ok' | 'stale' | 'orphan';
export interface DriftItem {
  tag: UsageTag;
  currentVersion: number | null;
  status: DriftStatus;
}
