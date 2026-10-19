/** A relationship id that isn't a known entity is a broken reference. */
export function computeBrokenRefs(entities, knownIds) {
    const out = [];
    for (const e of entities)
        for (const r of e.relationships ?? [])
            if (!knownIds.has(r))
                out.push({ entity: e.id, ref: r });
    return out;
}
/** A projection whose base entity moved past the version it was written against (or vanished). */
export function computeDerivedDrift(entities, versions) {
    const out = [];
    for (const e of entities)
        for (const [base, builtOn] of Object.entries(e.derivedFrom ?? {})) {
            const currentVersion = versions.get(base) ?? null;
            if (currentVersion === null)
                out.push({ entity: e.id, base, builtOn, currentVersion, status: 'orphan' });
            else if (builtOn < currentVersion)
                out.push({ entity: e.id, base, builtOn, currentVersion, status: 'stale' });
        }
    return out;
}
