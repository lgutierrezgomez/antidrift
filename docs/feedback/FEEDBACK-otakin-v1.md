# Field feedback: Otakin V1 (first real-world use)

Date: 2026-10-19 · Project: `~/Documents/code/otakin` (branch `feat/v1`)
Stack: pnpm monorepo — Fastify 5 + Drizzle + PostGIS server, two Next.js 16 apps (public site, backoffice), shared `@otakin/entities` package.
Built in 18 tasks by subagents, each implementer told "the entity file is the source of truth; tag where you use it".

## How it was used

| Measure | Value |
|---|---|
| Entities | 6 (`place`, `placeImage`, `region`, `comuna`, `adminUser`, `placeImport`), JSON Schema 2020-12 |
| Edits to `.antidrift/` after creation | 0 — every entity stayed at version 1 |
| Usage tags | ~106 at the end of the build (`#place` 50, `#placeImage` 18, `#comuna` 10, `#region` 10, `#adminUser` 9, `#placeImport` 9) |
| `antidrift scan` | Ran in every `pnpm test` (dozens of runs). Always clean. |
| Drift caught | None — there was never any to catch |
| Commands used | `reconcile`, `gen-types ts`, `scan` |

Setup: entity JSON → `gen-types ts` → `code/shared/entities/src/generated.ts`; the server validates request bodies directly against the same JSON schemas with Ajv. No Zod/TypeBox/Prisma copies.

## What worked

- **Single source of truth held.** The final whole-branch review found the data definitions consistent across server, public site and backoffice. Validation and TS types could not disagree because both come from the same files.
- **Easy rule to hand to agents.** "Entity file is truth, tag where you use it" fit in one line of every dispatch. No agent invented a parallel schema.
- **Tags make blast radius visible.** You can see at a glance which files depend on `place`. (Not exercised: no schema change happened.)

## What it cost (traps hit)

1. **Ajv draft mismatch.** Ajv's default import is draft-07; antidrift schemas are 2020-12. You need `Ajv2020` from `ajv/dist/2020.js` (named import under `moduleResolution: NodeNext`). Not obvious from the docs.
2. **`ajv-formats` is CJS.** Default import under NodeNext needed a small interop shim (`TS2349` otherwise). Schemas use `format: uuid/email/uri`, so formats are mandatory.
3. **Validator leaks into browser bundles.** The shared entities package compiled every schema at import time. Front-end code that only needed the enums (`PLACE_TYPES`, `FOOD_TYPES`) pulled in Ajv + every schema. Workaround: a separate `@otakin/entities/enums` entry point with values only.
4. **Ceremony.** ~106 tag comments added mechanically, plus a scan step in every test run. Cheap, but not free; nobody used the tags for navigation during the build.

## Where it didn't reach

- **API response shapes are outside antidrift.** The contracts that actually changed during the build were hand-written TS in `api.ts`: `NearbyPlace`, `PlaceDetail`, `PlaceImageUrls`, `AdminPlaceRow`, `ImportReport` (e.g. the import report gained a place id). These are projections of entities, and that is exactly where drift happens in practice — but they're unguarded.
- **Internal columns.** A late fix added a DB-only `import_key` to `places`. It was kept out of the `place` entity, so the version stayed at 1 and the scan never had to flag anything. This is the right call for internal columns, but it means the first live drift test never happened. Unclear guidance on "should DB-only fields be in the entity?" might be worth a doc line.
- **Behaviour bugs.** The real cross-task bugs (re-import duplicating renamed places, wrong empty-state copy) are behaviour, not shape — out of scope for any schema tool, noted for expectation-setting.

## Suggestions

1. **Ship (or generate) an enums/types-only entry point**, so front-end code never imports the validator or compiles schemas. E.g. `gen-types` could also emit `enums.ts` with `as const` arrays for every `enum` in the schemas.
2. **Document the Ajv 2020-12 setup** (or ship a tiny `createValidator()` helper): `Ajv2020` import path, `ajv-formats` interop under NodeNext, compiling lazily rather than at import time.
3. **Cover API responses, not just stored entities.** Let response shapes be declared as entities or as projections of them (pick/omit/extend an entity, with the version of the base tracked), so files like `api.ts` come under `scan`.
4. **Guidance on what belongs in an entity** — DB-internal columns (keys, hashes, timestamps), derived fields, and when a change warrants a version bump.
5. **Optional: make tags cheaper.** A file-level tag (one per file) or inferring usage from imports of the generated types would remove most of the mechanical comments.
