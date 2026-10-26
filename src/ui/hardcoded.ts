import type { Token } from './tokens.js';

export interface ColorLiteral {
  raw: string;
  hex: string; // normalized '#RRGGBBAA'
  column: number; // 1-based
}

export const UI_EXTENSIONS = new Set(['css', 'scss', 'less', 'html', 'ts', 'tsx', 'js', 'jsx', 'vue', 'svelte', 'dart', 'kt', 'swift']);
export { BUILD_DIRS as BUILD_SKIP_DIRS } from '../scanner.js';

export const isGeneratedFile = (rel: string) => /\.(g|freezed)\.dart$|\.min\.[^/]+$/.test(rel);

/** Test code legitimately compares against literal colors; the hardcoded check skips it. */
export const isTestFile = (rel: string) =>
  /(^|\/)(test|tests|__tests__|e2e|integration_test)\//.test(rel) || /\.(test|spec)\.[^/.]+$/.test(rel) || /_test\.dart$/.test(rel);

/**
 * Blank out comments outside string literals, keeping every line and column where it was so findings
 * still point at the right place. Comment syntax follows the file type: `//` only where the language
 * has it (not CSS or HTML), `<!-- -->` in markup, JS regex literals and Dart/Kotlin/Swift triple-quoted
 * strings are kept as code.
 */
export function stripComments(src: string, ext = 'ts'): string {
  const lineComments = ext !== 'css' && ext !== 'html';
  const blockComments = ext !== 'html';
  const htmlComments = ext === 'html' || ext === 'vue' || ext === 'svelte';
  const regexLiterals = ['ts', 'tsx', 'js', 'jsx', 'vue', 'svelte'].includes(ext);
  const triple = ext === 'dart' ? ["'''", '"""'] : ext === 'kt' || ext === 'swift' ? ['"""'] : [];
  const trackQuotes = ext !== 'html'; // apostrophes in markup text aren't strings
  let out = '';
  let mode: 'code' | 'line' | 'block' | 'html' | 'regex' = 'code';
  let quote = '';
  let inClass = false; // inside a regex [...] class
  let prev = ''; // last non-space code character, to tell a regex from a division
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\n') {
      if (mode === 'line' || mode === 'regex') mode = 'code';
      if (quote.length === 1 && quote !== '`') quote = '';
      out += c;
      continue;
    }
    if (mode === 'line') {
      out += ' ';
      continue;
    }
    if (mode === 'block' || mode === 'html') {
      const end = mode === 'block' ? '*/' : '-->';
      if (src.startsWith(end, i)) {
        out += ' '.repeat(end.length);
        i += end.length - 1;
        mode = 'code';
      } else out += ' ';
      continue;
    }
    if (mode === 'regex') {
      out += c;
      if (c === '\\') {
        out += src[i + 1] ?? '';
        i++;
      } else if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) {
        mode = 'code';
        prev = '/';
      }
      continue;
    }
    if (quote) {
      if (c === '\\') {
        out += c + (src[i + 1] ?? '');
        i++;
        continue;
      }
      if (src.startsWith(quote, i)) {
        out += quote;
        i += quote.length - 1;
        quote = '';
        prev = c;
        continue;
      }
      out += c;
      continue;
    }
    const opener = trackQuotes ? (triple.find((q) => src.startsWith(q, i)) ?? (c === '"' || c === "'" || c === '`' ? c : '')) : '';
    if (opener) {
      quote = opener;
      out += opener;
      i += opener.length - 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '/' && lineComments) mode = 'line';
    else if (c === '/' && src[i + 1] === '*' && blockComments) mode = 'block';
    else if (htmlComments && src.startsWith('<!--', i)) mode = 'html';
    else if (c === '/' && regexLiterals && (prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev))) {
      mode = 'regex';
      inClass = false;
      out += c;
      continue;
    }
    out += mode === 'code' ? c : ' ';
    if (mode === 'code' && c.trim()) prev = c;
  }
  return out;
}

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
    if (t.value.type !== 'color') continue;
    if (!t.aliasOf) out.set(t.value.hex, [...(out.get(t.value.hex) ?? []), t.path]);
    // An alias's inherited values are indexed under its target; only its own mode values are new.
    for (const [key, v] of Object.entries(t.modes ?? {}))
      if (v.type === 'color' && (!t.aliasOf || t.ownModeKeys?.includes(key)))
        out.set(v.hex, [...(out.get(v.hex) ?? []), `${t.path} (${key})`]);
  }
  return out;
}
