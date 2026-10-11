export function computeDrift(tags, index) {
    const current = new Map(index.map((e) => [e.id, e.version]));
    return tags.map((tag) => {
        const currentVersion = current.has(tag.id) ? current.get(tag.id) : null;
        const status = currentVersion === null ? 'orphan' : tag.version < currentVersion ? 'stale' : 'ok';
        return { tag, currentVersion, status };
    });
}
export const problems = (items) => items.filter((i) => i.status !== 'ok');
