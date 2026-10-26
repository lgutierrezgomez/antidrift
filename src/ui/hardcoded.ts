import type { Token } from './tokens.js';

export interface ColorLiteral {
  raw: string;
  hex: string; // normalized '#RRGGBBAA'
  column: number; // 1-based
}

export const UI_EXTENSIONS = new Set(['css', 'scss', 'less', 'html', 'ts', 'tsx', 'js', 'jsx', 'vue', 'svelte', 'dart', 'kt', 'swift']);
export const BUILD_SKIP_DIRS = new Set(['build', '.dart_tool', 'Pods', '.next']);

export const isGeneratedFile = (rel: string) => /\.(g|freezed)\.dart$|\.min\.[^/]+$/.test(rel);

const HEX_RE = /(?<![\w&])#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z])/g;
const ARGB_RE = /Color\(\s*0x([0-9a-fA-F]{8})\s*\)/g;
const RGB_RE = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0|1|0?\.\d+)\s*)?\)/g;

const byte = (n: number) => Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, '0').toUpperCase();

/** Color literals in one line of code, normalized so they can be compared with token values. */
export function findColorLiterals(line: string): ColorLiteral[] {
  const out: ColorLiteral[] = [];
  for (const m of line.matchAll(HEX_RE)) {
    let h = m[1].toUpperCase();
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    if (h.length === 6) h += 'FF';
    out.push({ raw: m[0], hex: `#${h}`, column: m.index! + 1 });
  }
  for (const m of line.matchAll(ARGB_RE)) {
    const h = m[1].toUpperCase();
    out.push({ raw: m[0], hex: `#${h.slice(2)}${h.slice(0, 2)}`, column: m.index! + 1 });
  }
  for (const m of line.matchAll(RGB_RE)) {
    const [r, g, b] = [m[1], m[2], m[3]].map(Number);
    if (r > 255 || g > 255 || b > 255) continue;
    const a = m[4] === undefined ? 255 : Number(m[4]) * 255;
    out.push({ raw: m[0], hex: `#${byte(r)}${byte(g)}${byte(b)}${byte(a)}`, column: m.index! + 1 });
  }
  return out.sort((x, y) => x.column - y.column);
}

/** Resolved color value → the (non-alias) token paths that hold it. */
export function colorIndex(tokens: Map<string, Token>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const t of [...tokens.values()].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    if (t.value.type !== 'color' || t.aliasOf) continue;
    out.set(t.value.hex, [...(out.get(t.value.hex) ?? []), t.path]);
  }
  return out;
}
