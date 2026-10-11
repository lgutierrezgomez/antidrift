/** A relationship id that isn't a known entity is a broken reference. */
export function computeBrokenRefs(entities, knownIds) {
    const out = [];
    for (const e of entities)
        for (const r of e.relationships ?? [])
            if (!knownIds.has(r))
                out.push({ entity: e.id, ref: r });
    return out;
}
