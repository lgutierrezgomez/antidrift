import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
const TAG_RE = /antidrift\s+#([A-Za-z0-9_.-]+)@(\d+)/g;
const IGNORE = new Set(['.git', 'node_modules', '.antidrift', 'dist']);
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
export function scanRepo(root) {
    const tags = [];
    const walk = (dir) => {
        for (const name of readdirSync(dir)) {
            if (IGNORE.has(name))
                continue;
            const full = join(dir, name);
            const st = statSync(full);
            if (st.isDirectory())
                walk(full);
            else if (st.isFile()) {
                try {
                    tags.push(...scanFile(full, root));
                }
                catch {
                    /* skip unreadable/binary */
                }
            }
        }
    };
    walk(root);
    return tags;
}
