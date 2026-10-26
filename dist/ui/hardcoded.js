export const UI_EXTENSIONS = new Set(['css', 'scss', 'less', 'html', 'ts', 'tsx', 'js', 'jsx', 'vue', 'svelte', 'dart', 'kt', 'swift']);
export const BUILD_SKIP_DIRS = new Set(['build', '.dart_tool', 'Pods', '.next']);
export const isGeneratedFile = (rel) => /\.(g|freezed)\.dart$|\.min\.[^/]+$/.test(rel);
/** Test code legitimately compares against literal colors; the hardcoded check skips it. */
export const isTestFile = (rel) => /(^|\/)(test|tests|__tests__|e2e|integration_test)\//.test(rel) || /\.(test|spec)\.[^/.]+$/.test(rel) || /_test\.dart$/.test(rel);
/**
 * Blank out comments (`//`, `/* *\/`, `<!-- -->`, stray JSDoc `*` lines) outside string literals,
 * keeping every line and column where it was so findings still point at the right place.
 */
export function stripComments(src) {
    let out = '';
    let mode = 'code';
    let quote = '';
    const lineStart = (i) => i === 0 || src[i - 1] === '\n';
    for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (c === '\n') {
            if (mode === 'line')
                mode = 'code';
            if (quote && quote !== '`')
                quote = '';
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
            }
            else
                out += ' ';
            continue;
        }
        if (quote) {
            if (c === '\\') {
                out += c + (src[i + 1] ?? '');
                i++;
                continue;
            }
            if (c === quote)
                quote = '';
            out += c;
            continue;
        }
        if (lineStart(i)) {
            const m = src.slice(i).match(/^[ \t]*\*(?=\s|$|\/)/);
            if (m && !src.startsWith('*/', i + m[0].length - 1)) {
                mode = 'line';
                out += ' ';
                continue;
            }
        }
        if (c === '/' && src[i + 1] === '/')
            mode = 'line';
        else if (c === '/' && src[i + 1] === '*')
            mode = 'block';
        else if (src.startsWith('<!--', i))
            mode = 'html';
        else if (c === '"' || c === "'" || c === '`')
            quote = c;
        out += mode === 'code' ? c : ' ';
    }
    return out;
}
const HEX_RE = /(?<![\w&])#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z])/g;
const ARGB_RE = /Color\(\s*0x([0-9a-fA-F]{8})\s*\)/g;
const RGB_RE = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0|1|0?\.\d+)\s*)?\)/g;
const byte = (n) => Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, '0').toUpperCase();
/** Color literals in one line of code, normalized so they can be compared with token values. */
export function findColorLiterals(line) {
    const out = [];
    for (const m of line.matchAll(HEX_RE)) {
        let h = m[1].toUpperCase();
        if (h.length === 3)
            h = [...h].map((c) => c + c).join('');
        if (h.length === 6)
            h += 'FF';
        out.push({ raw: m[0], hex: `#${h}`, column: m.index + 1 });
    }
    for (const m of line.matchAll(ARGB_RE)) {
        const h = m[1].toUpperCase();
        out.push({ raw: m[0], hex: `#${h.slice(2)}${h.slice(0, 2)}`, column: m.index + 1 });
    }
    for (const m of line.matchAll(RGB_RE)) {
        const [r, g, b] = [m[1], m[2], m[3]].map(Number);
        if (r > 255 || g > 255 || b > 255)
            continue;
        const a = m[4] === undefined ? 255 : Number(m[4]) * 255;
        out.push({ raw: m[0], hex: `#${byte(r)}${byte(g)}${byte(b)}${byte(a)}`, column: m.index + 1 });
    }
    return out.sort((x, y) => x.column - y.column);
}
/** Resolved color value → the (non-alias) token paths that hold it. */
export function colorIndex(tokens) {
    const out = new Map();
    for (const t of [...tokens.values()].sort((a, b) => (a.path < b.path ? -1 : 1))) {
        if (t.value.type !== 'color' || t.aliasOf)
            continue;
        out.set(t.value.hex, [...(out.get(t.value.hex) ?? []), t.path]);
        for (const [key, v] of Object.entries(t.modes ?? {}))
            if (v.type === 'color')
                out.set(v.hex, [...(out.get(v.hex) ?? []), `${t.path} (${key})`]);
    }
    return out;
}
