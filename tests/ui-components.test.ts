import { test, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as S from '../src/store.js';
import { parseTokenTree, resolveTokenTree } from '../src/ui/tokens.js';
import {
  componentsDir,
  readComponent,
  validateComponent,
  writeComponent,
  reconcileComponent,
  resolveMatrix,
  brokenTokenRefs,
  listComponentIds,
  type Component,
} from '../src/ui/components.js';

const tokens = resolveTokenTree(
  parseTokenTree(
    {
      color: {
        $type: 'color',
        brand: { primary: { $value: '#1E5BFF' }, 'primary-pressed': { $value: '#1440CC' } },
        'on-brand': { $value: '#FFFFFF' },
        neutral: { '300': { $value: '#D0D4DC' }, '600': { $value: '#5A6170' } },
        transparent: { $value: '#00000000' },
      },
      radius: { md: { $type: 'dimension', $value: '8px' } },
    },
    'base.json',
  ),
);

const pagar = (): Component => ({
  id: 'pagar_button',
  version: 1,
  hash: '',
  title: 'Pagar button',
  summary: 'Primary pay action at checkout.',
  variants: ['primary', 'secondary'],
  states: ['default', 'pressed', 'disabled', 'loading'],
  styles: {
    primary: {
      default: { background: '{color.brand.primary}', text: '{color.on-brand}', radius: '{radius.md}' },
      pressed: { background: '{color.brand.primary-pressed}' },
      disabled: { background: '{color.neutral.300}', text: '{color.neutral.600}' },
    },
    secondary: { default: { background: '{color.transparent}', text: '{color.brand.primary}', radius: '{radius.md}' } },
  },
});

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ad-comp-'));
});

test('validateComponent rejects a raw literal', () => {
  const c = pagar();
  c.styles.primary.default.background = '#fff';
  expect(() => validateComponent(c)).toThrow(/primary\.default\.background/);
});

test('validateComponent requires default state and default blocks', () => {
  const noDefault = pagar();
  noDefault.states = ['pressed'];
  expect(() => validateComponent(noDefault)).toThrow(/default/);
  const noBlock = pagar();
  delete (noBlock.styles as Record<string, unknown>).secondary;
  expect(() => validateComponent(noBlock)).toThrow(/secondary/);
  const unknownState = pagar();
  unknownState.styles.primary.hover = { background: '{color.brand.primary}' };
  expect(() => validateComponent(unknownState)).toThrow(/hover/);
});

test('reconcileComponent stamps then bumps', () => {
  writeComponent(root, pagar());
  const stamped = reconcileComponent(root, 'pagar_button');
  expect(stamped.version).toBe(1);
  expect(stamped.hash).not.toBe('');
  const c = readComponent(root, 'pagar_button');
  c.styles.primary.pressed.text = '{color.on-brand}';
  writeComponent(root, c);
  expect(reconcileComponent(root, 'pagar_button').version).toBe(2);
  expect(reconcileComponent(root, 'pagar_button').version).toBe(2);
  expect(listComponentIds(root)).toEqual(['pagar_button']);
});

test('resolveMatrix applies inheritance', () => {
  const m = resolveMatrix(pagar(), tokens);
  expect(m.primary.disabled.radius.ref).toBe('{radius.md}');
  expect(m.primary.disabled.background.value).toEqual({ type: 'color', hex: '#D0D4DCFF' });
  expect(m.primary.loading).toEqual(m.primary.default);
  expect(Object.keys(m.secondary)).toEqual(['default', 'pressed', 'disabled', 'loading']);
});

test('brokenTokenRefs finds a typoed ref', () => {
  const c = pagar();
  c.styles.primary.pressed.background = '{color.brand.primary-pressd}';
  expect(brokenTokenRefs(c, tokens)).toEqual([
    { component: 'pagar_button', slot: 'primary.pressed.background', ref: '{color.brand.primary-pressd}' },
  ]);
  expect(resolveMatrix(c, tokens).primary.pressed.background.value).toBeNull();
});

test('writeComponent refuses an id used by an entity', () => {
  S.writeEntity(root, { id: 'pagar_button', version: 1, hash: '', schema: { type: 'object' } });
  expect(() => writeComponent(root, pagar())).toThrow(/entity/);
});

test('computeIndex includes components; clash is reported, not thrown', () => {
  writeComponent(root, pagar());
  mkdirSync(componentsDir(root), { recursive: true });
  writeFileSync(join(componentsDir(root), 'x.json'), JSON.stringify({ ...pagar(), id: 'x' }));
  S.writeEntity(root, { id: 'x', version: 1, hash: '', schema: { type: 'object' } });
  const idx = S.computeIndex(root);
  expect(idx.map((e) => [e.id, e.kind ?? 'entity'])).toEqual([
    ['x', 'entity'],
    ['pagar_button', 'component'],
    ['x', 'component'],
  ]);
  expect(idx.find((e) => e.id === 'pagar_button')).toMatchObject({ file: 'components/pagar_button.json', title: 'Pagar button' });
});

test('buildIndex persists the index when only components exist', () => {
  writeComponent(root, pagar());
  S.buildIndex(root);
  expect(S.readIndex(root).map((e) => e.id)).toEqual(['pagar_button']);
});
