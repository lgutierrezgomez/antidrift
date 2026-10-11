import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { UsageTag } from './types.js';

const TAG_RE = /antidrift\s+#([A-Za-z0-9_.-]+)@(\d+)/g;
const IGNORE = new Set(['.git', 'node_modules', '.antidrift', 'dist']);
const MAX_BYTES = 2 * 1024 * 1024;

export function parseTags(content: string): Array<{ id: string; version: number; line: number }> {
  const out: Array<{ id: string; version: number; line: number }> = [];
  content.split('\n').forEach((text, i) => {
    TAG_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TAG_RE.exec(text)) !== null) out.push({ id: m[1], version: Number(m[2]), line: i + 1 });
  });
  return out;
}

export function scanFile(path: string, root: string): UsageTag[] {
  return parseTags(readFileSync(path, 'utf8')).map((t) => ({ ...t, file: relative(root, path) }));
}

export function scanRepo(root: string): UsageTag[] {
  const tags: UsageTag[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (IGNORE.has(name)) continue;
      const full = join(dir, name);
      const st = lstatSync(full);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(full);
      else if (st.isFile() && st.size <= MAX_BYTES) {
        try {
          tags.push(...scanFile(full, root));
        } catch {
          /* skip unreadable/binary */
        }
      }
    }
  };
  walk(root);
  return tags;
}
