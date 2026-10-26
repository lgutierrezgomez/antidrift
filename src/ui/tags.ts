export interface ImplTag {
  id: string;
  version: number;
  file: string;
  line: number;
}
export interface UseTag {
  id: string;
  variant?: string;
  file: string;
  line: number;
}

const IMPL_RE = /antidrift\s+impl\s+#([A-Za-z0-9_.-]+)@(\d+)/g;
const USE_RE = /antidrift\s+use\s+#([A-Za-z0-9_.-]+)(?::([A-Za-z0-9_-]+))?/g;

export function parseUiTags(content: string, file: string): { impls: ImplTag[]; uses: UseTag[] } {
  const impls: ImplTag[] = [];
  const uses: UseTag[] = [];
  content.split('\n').forEach((text, i) => {
    for (const m of text.matchAll(IMPL_RE)) impls.push({ id: m[1], version: Number(m[2]), file, line: i + 1 });
    for (const m of text.matchAll(USE_RE)) uses.push({ id: m[1], ...(m[2] ? { variant: m[2] } : {}), file, line: i + 1 });
  });
  return { impls, uses };
}
