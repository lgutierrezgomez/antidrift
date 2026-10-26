import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
const TAG_RE = /antidrift\s+#([A-Za-z0-9_.-]+)@(\d+)/g;
/** Build output folders: they hold copies of source comments, so their tags would be duplicates (and go stale on their own). */
export const BUILD_DIRS = new Set(['build', 'out', '.next', '.nuxt', '.svelte-kit', '.turbo', '.dart_tool', 'Pods', '.gradle', 'coverage']);
const IGNORE = new Set(['.git', 'node_modules', '.antidrift', 'dist', ...BUILD_DIRS]);
const MAX_BYTES = 2 * 1024 * 1024;
export function parseTags(content) {
    const out = [];
    content.split('\n').forEach((text, i) => {
        TAG_RE.lastIndex = 0;
        let m;
        while ((m = TAG_RE.exec(text)) !== null)
            out.push({ id: m[1], version: Number(m[2]), line: i + 1 });
    });
    return out;
}
export function scanFile(path, root) {
    return parseTags(readFileSync(path, 'utf8')).map((t) => ({ ...t, file: relative(root, path) }));
}
/** Every regular file under root (default ignores, no symlinks, size-capped), with its POSIX relative path. */
export function* walkFiles(root, skip) {
    const walk = function* (dir) {
        for (const name of readdirSync(dir).sort()) {
            if (IGNORE.has(name))
                continue;
            const full = join(dir, name);
            const rel = relative(root, full).split(sep).join('/');
            const st = lstatSync(full);
            if (st.isSymbolicLink())
                continue;
            if (st.isDirectory()) {
                if (!skip?.(rel, true))
                    yield* walk(full);
            }
            else if (st.isFile() && st.size <= MAX_BYTES && !skip?.(rel, false))
                yield { path: full, rel };
        }
    };
    yield* walk(root);
}
export function scanRepo(root) {
    const tags = [];
    for (const { path } of walkFiles(root)) {
        try {
            tags.push(...scanFile(path, root));
        }
        catch {
            /* skip unreadable/binary */
        }
    }
    return tags;
}
