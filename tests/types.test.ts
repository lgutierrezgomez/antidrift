import { expectTypeOf, test } from 'vitest';
import type { Entity } from '../src/types.js';

test('Entity type is importable and shaped', () => {
  const e: Entity = { id: 'x', version: 1, hash: 'h', schema: {} };
  expectTypeOf(e.version).toEqualTypeOf<number>();
});
