import { test, expect } from 'vitest';
import { parseTokenTree, resolveTokenTree, resolveFor, modeContexts, validateTokenModes, type ModeAxis } from '../src/ui/tokens.js';
import { cssTokenEmitter, dartTokenEmitter } from '../src/ui/token-emitters.js';
import { colorIndex } from '../src/ui/hardcoded.js';

const M = 'com.antidrift.modes';
const tokens = (doc: unknown) => resolveTokenTree(parseTokenTree(doc, 'x.json'));
const AXES: ModeAxis[] = [
  { axis: 'scheme', values: ['light', 'dark'], attribute: 'data-theme', followSystem: true },
  { axis: 'palette', values: ['github', 'savile'], attribute: 'data-palette' },
];
const DOC = {
  color: {
    $type: 'color',
    primary: { $value: '#0969DA', $extensions: { [M]: { dark: '#58A6FF', savile: '#3C5A70', 'dark+savile': '#7FA8C4' } } },
    text: { $value: '#1F2328', $extensions: { [M]: { dark: '#E6EDF3' } } },
    link: { $value: '{color.primary}' },
    border: { $value: '#D1D9E0' },
  },
};

test('mode overrides are parsed, normalized and inherited by aliases', () => {
  const t = tokens(DOC);
  expect(t.get('color.primary')!.modes).toEqual({
    dark: { type: 'color', hex: '#58A6FFFF' },
    savile: { type: 'color', hex: '#3C5A70FF' },
    'dark+savile': { type: 'color', hex: '#7FA8C4FF' },
  });
  expect(t.get('color.link')!.modes).toEqual(t.get('color.primary')!.modes);
  expect(t.get('color.border')!.modes).toBeUndefined();
});

test('mode keys are order-insensitive and values are type-checked', () => {
  const t = tokens({ c: { $type: 'color', a: { $value: '#000000', $extensions: { [M]: { 'savile+dark': '#111111' } } } } });
  expect(Object.keys(t.get('c.a')!.modes!)).toEqual(['dark+savile']);
  expect(() => tokens({ c: { $type: 'color', a: { $value: '#000000', $extensions: { [M]: { dark: '8px' } } } } })).toThrow(/c\.a.*dark/);
});

test('resolveFor picks the most specific override', () => {
  const t = tokens(DOC);
  const p = t.get('color.primary')!;
  expect(resolveFor(p, [])).toEqual({ type: 'color', hex: '#0969DAFF' });
  expect(resolveFor(p, ['dark'])).toEqual({ type: 'color', hex: '#58A6FFFF' });
  expect(resolveFor(p, ['savile', 'dark'])).toEqual({ type: 'color', hex: '#7FA8C4FF' });
  expect(resolveFor(t.get('color.text')!, ['savile', 'dark'])).toEqual({ type: 'color', hex: '#E6EDF3FF' });
});

test('modeContexts enumerates every non-default combination in axis order', () => {
  expect(modeContexts(AXES)).toEqual([[], ['dark'], ['savile'], ['dark', 'savile']]);
});

test('validateTokenModes rejects undeclared modes, two values of one axis, and ambiguity', () => {
  expect(() => validateTokenModes(tokens(DOC), AXES)).not.toThrow();
  const undeclared = tokens({ c: { $type: 'color', a: { $value: '#000000', $extensions: { [M]: { sepia: '#111111' } } } } });
  expect(() => validateTokenModes(undeclared, AXES)).toThrow(/sepia/);
  const sameAxis = tokens({ c: { $type: 'color', a: { $value: '#000000', $extensions: { [M]: { 'dark+light': '#111111' } } } } });
  expect(() => validateTokenModes(sameAxis, AXES)).toThrow(/dark\+light/);
  const ambiguous = tokens({ c: { $type: 'color', a: { $value: '#000000', $extensions: { [M]: { dark: '#111111', savile: '#222222' } } } } });
  expect(() => validateTokenModes(ambiguous, AXES)).toThrow(/c\.a.*dark\+savile/);
});

test('css emits one block per mode key plus a prefers-color-scheme fallback', () => {
  const out = cssTokenEmitter.emit(tokens(DOC), { modes: AXES });
  expect(out).toContain(':root {\n  --color-border: #d1d9e0;\n  --color-link: var(--color-primary);\n  --color-primary: #0969da;\n  --color-text: #1f2328;\n}');
  expect(out).toContain(':root[data-theme="dark"] {\n  --color-primary: #58a6ff;\n  --color-text: #e6edf3;\n}');
  expect(out).toContain('@media (prefers-color-scheme: dark) {\n  :root:not([data-theme]) {\n    --color-primary: #58a6ff;\n    --color-text: #e6edf3;\n  }\n}');
  expect(out).toContain(':root[data-palette="savile"] {\n  --color-primary: #3c5a70;\n}');
  expect(out).toContain(':root[data-theme="dark"][data-palette="savile"] {\n  --color-primary: #7fa8c4;\n}');
  expect(out).toContain(
    '@media (prefers-color-scheme: dark) {\n  :root:not([data-theme])[data-palette="savile"] {\n    --color-primary: #7fa8c4;\n  }\n}',
  );
  expect(out).not.toContain('--color-link: #');
});

test('dart emits one full class per mode combination', () => {
  const out = dartTokenEmitter.emit(tokens(DOC), { modes: AXES });
  expect(out).toContain('abstract final class DsTokens {');
  expect(out).toContain('abstract final class DsTokensDark {');
  expect(out).toContain('abstract final class DsTokensSavile {');
  expect(out).toContain('abstract final class DsTokensDarkSavile {');
  const dark = out.slice(out.indexOf('class DsTokensDark {'), out.indexOf('class DsTokensSavile {'));
  expect(dark).toContain('static const colorPrimary = Color(0xFF58A6FF);');
  expect(dark).toContain('static const colorBorder = Color(0xFFD1D9E0);');
  expect(dark).toContain('static const colorLink = colorPrimary;');
});

test('without modes the emitters are unchanged', () => {
  const plain = tokens({ c: { $type: 'color', a: { $value: '#000000' } } });
  expect(cssTokenEmitter.emit(plain, { modes: [] })).toBe(cssTokenEmitter.emit(plain));
  expect(dartTokenEmitter.emit(plain, { modes: [] })).toBe(dartTokenEmitter.emit(plain));
});

test('colorIndex includes mode values, labelled', () => {
  const idx = colorIndex(tokens(DOC));
  expect(idx.get('#58A6FFFF')).toEqual(['color.primary (dark)']);
  expect(idx.get('#0969DAFF')).toEqual(['color.primary']);
});

// --- wiring: ui.json, gen-tokens, scan, tokens, show ---
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readUiConfig, uiConfigPath } from '../src/ui/config.js';
import { tokensDir } from '../src/ui/tokens.js';
import { cmdGenTokens, cmdScan, cmdTokens, cmdShow } from '../src/cli.js';
import { componentsDir } from '../src/ui/components.js';

const project = (modes: unknown, doc: unknown = DOC) => {
  const root = mkdtempSync(join(tmpdir(), 'ad-modes-'));
  mkdirSync(tokensDir(root), { recursive: true });
  writeFileSync(join(tokensDir(root), 'base.json'), JSON.stringify(doc));
  writeFileSync(uiConfigPath(root), JSON.stringify({ modes, targets: [{ lang: 'css', out: 't.css' }, { lang: 'dart', out: 't.dart' }] }));
  return root;
};

test('readUiConfig parses modes and rejects unsafe attributes', () => {
  const root = project(AXES);
  expect(readUiConfig(root).modes).toEqual(AXES);
  const bad = project([{ axis: 'scheme', values: ['light', 'dark'], attribute: 'data-x"] {' }]);
  expect(() => readUiConfig(bad)).toThrow(/attribute/);
  const one = project([{ axis: 'scheme', values: ['light'], attribute: 'data-theme' }]);
  expect(() => readUiConfig(one)).toThrow(/two values/);
});

test('gen-tokens emits modes from ui.json and refuses invalid mode use', () => {
  const root = project(AXES);
  cmdGenTokens(root);
  expect(readFileSync(join(root, 't.css'), 'utf8')).toContain(':root[data-theme="dark"]');
  expect(readFileSync(join(root, 't.dart'), 'utf8')).toContain('abstract final class DsTokensDarkSavile');
  const undeclared = project([]);
  expect(() => cmdGenTokens(undeclared)).toThrow(/dark/);
});

test('scan reports invalid mode use as an invalid-tokens problem', () => {
  const root = project([]);
  const r = cmdScan(root);
  expect(r.ui!.problems.map((p) => p.kind)).toEqual(['invalid-tokens']);
});

test('tokens and show print mode values', () => {
  const root = project(AXES);
  expect(cmdTokens(root, 'color.primary')).toBe('color.primary  color  #0969DA  [dark: #58A6FF, dark+savile: #7FA8C4, savile: #3C5A70]');
  mkdirSync(componentsDir(root), { recursive: true });
  writeFileSync(
    join(componentsDir(root), 'b.json'),
    JSON.stringify({ id: 'b', version: 1, hash: '', variants: ['primary'], states: ['default'], styles: { primary: { default: { text: '{color.text}' } } } }),
  );
  expect(cmdShow(root, 'b')).toContain('  primary.default.text → {color.text} = #1F2328  [dark: #E6EDF3]');
});

test('an alias with its own override resolves the same in CSS, Dart and resolveFor', () => {
  const t = tokens({
    color: {
      $type: 'color',
      t: { $value: '#111111', $extensions: { [M]: { dark: '#222222', 'dark+savile': '#333333' } } },
      a: { $value: '{color.t}', $extensions: { [M]: { dark: '#AAAAAA' } } },
    },
  });
  expect(resolveFor(t.get('color.a')!, ['dark', 'savile']).hex).toBe('#333333FF');
  const css = cssTokenEmitter.emit(t, { modes: AXES });
  const combo = css.slice(css.indexOf(':root[data-theme="dark"][data-palette="savile"]'));
  expect(combo.slice(0, combo.indexOf('}'))).toContain('--color-a: #333333;');
  const dart = dartTokenEmitter.emit(t, { modes: AXES });
  expect(dart.slice(dart.indexOf('class DsTokensDarkSavile {'))).toContain('static const colorA = Color(0xFF333333);');
});

test('mode values whose class names would collide are rejected', () => {
  const root = project([
    { axis: 'scheme', values: ['light', 'dark'], attribute: 'data-theme' },
    { axis: 'palette', values: ['base', 'igm-v1', 'igmV1'], attribute: 'data-palette' },
  ]);
  expect(() => readUiConfig(root)).toThrow(/igm-v1.*igmV1|igmV1.*igm-v1/);
  const empty = project([{ axis: 'scheme', values: ['light', '-'], attribute: 'data-theme' }]);
  expect(() => readUiConfig(empty)).toThrow(/"-"/);
  const combo = project([
    { axis: 'scheme', values: ['light', 'dark'], attribute: 'data-theme' },
    { axis: 'palette', values: ['base', 'savile', 'dark-savile'], attribute: 'data-palette' },
  ]);
  expect(() => cmdGenTokens(combo)).toThrow(/DsTokensDarkSavile/);
});
