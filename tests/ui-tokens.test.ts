import { test, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTokens, tokensDir } from '../src/ui/tokens.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ad-tok-'));
});
const put = (name: string, doc: unknown) => {
  mkdirSync(tokensDir(root), { recursive: true });
  writeFileSync(join(tokensDir(root), name), typeof doc === 'string' ? doc : JSON.stringify(doc));
};

test('loadTokens returns empty map without tokens dir', () => {
  expect(loadTokens(root).size).toBe(0);
});

test('inherits group $type and normalizes colors', () => {
  put('color.json', { color: { $type: 'color', brand: { primary: { $value: '#1e5bff' } } } });
  const t = loadTokens(root).get('color.brand.primary')!;
  expect(t.type).toBe('color');
  expect(t.value).toEqual({ type: 'color', hex: '#1E5BFFFF' });
});

test('parses dimension object and string forms', () => {
  put('size.json', { radius: { $type: 'dimension', md: { $value: { value: 8, unit: 'px' } }, half: { $value: '0.5rem' } } });
  const tokens = loadTokens(root);
  expect(tokens.get('radius.md')!.value).toEqual({ type: 'dimension', value: 8, unit: 'px' });
  expect(tokens.get('radius.half')!.value).toEqual({ type: 'dimension', value: 0.5, unit: 'rem' });
});

test('resolves aliases', () => {
  put('color.json', {
    color: { $type: 'color', brand: { primary: { $value: '#1E5BFF' } }, 'on-brand': { $value: '{color.brand.primary}' } },
  });
  const t = loadTokens(root).get('color.on-brand')!;
  expect(t.aliasOf).toBe('color.brand.primary');
  expect(t.value).toEqual({ type: 'color', hex: '#1E5BFFFF' });
});

test('rejects missing alias target', () => {
  put('color.json', { color: { $type: 'color', a: { $value: '{color.nope}' } } });
  expect(() => loadTokens(root)).toThrow(/color\.nope/);
});

test('rejects alias cycles', () => {
  put('color.json', { color: { $type: 'color', a: { $value: '{color.b}' }, b: { $value: '{color.a}' } } });
  expect(() => loadTokens(root)).toThrow(/cycle/i);
});

test('rejects the same path in two files', () => {
  put('a.json', { color: { x: { $type: 'color', $value: '#000000' } } });
  put('b.json', { color: { x: { $type: 'color', $value: '#ffffff' } } });
  expect(() => loadTokens(root)).toThrow(/a\.json[\s\S]*b\.json/);
});

test('rejects unsafe fontFamily names', () => {
  put('font.json', { font: { body: { $type: 'fontFamily', $value: 'Inter"; } body {' } } });
  expect(() => loadTokens(root)).toThrow(/font\.body/);
});

test('fontWeight keywords map to numbers', () => {
  put('font.json', { weight: { $type: 'fontWeight', strong: { $value: 'semi-bold' } } });
  expect(loadTokens(root).get('weight.strong')!.value).toEqual({ type: 'fontWeight', weight: 600 });
});

test('parses duration and rejects unknown $type', () => {
  put('motion.json', { motion: { $type: 'duration', fast: { $value: '200ms' }, slow: { $value: { value: 0.4, unit: 's' } } } });
  const tokens = loadTokens(root);
  expect(tokens.get('motion.fast')!.value).toEqual({ type: 'duration', ms: 200 });
  expect(tokens.get('motion.slow')!.value).toEqual({ type: 'duration', ms: 400 });
  put('bad.json', { shadow: { x: { $type: 'shadow', $value: {} } } });
  expect(() => loadTokens(root)).toThrow(/shadow\.x/);
});

test('loadTokens names the file on bad JSON', () => {
  put('broken.json', '{ nope');
  expect(() => loadTokens(root)).toThrow(/broken\.json/);
});
