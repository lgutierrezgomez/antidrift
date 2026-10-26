import { test, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cmdShow, cmdList, cmdTokens, cmdTag, cmdNotify, cmdNotifyTokens, cmdImport, cmdUiInit } from '../src/cli.js';
import { tokensDir, loadTokens } from '../src/ui/tokens.js';
import { componentsDir, readComponent } from '../src/ui/components.js';
import { uiConfigPath, uiEnabled } from '../src/ui/config.js';

let root: string;
const put = (rel: string, content: string) => writeFileSync(join(root, rel), content);
const pagar = {
  id: 'pagar_button',
  version: 2,
  hash: '',
  title: 'Pagar button',
  summary: 'Primary pay action at checkout.',
  variants: ['primary', 'secondary'],
  states: ['default', 'disabled'],
  styles: {
    primary: {
      default: { background: '{color.brand.primary}', radius: '{radius.md}' },
      disabled: { background: '{color.neutral.300}' },
    },
    secondary: { default: { background: '{color.brand.primary}' } },
  },
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ad-uicli-'));
  cmdUiInit(root);
  writeFileSync(join(tokensDir(root), 'neutral.json'), JSON.stringify({ color: { neutral: { '300': { $type: 'color', $value: '#D0D4DC' } } } }));
  writeFileSync(join(componentsDir(root), 'pagar_button.json'), JSON.stringify(pagar));
  cmdNotify(root, 'pagar_button'); // stamps the hash, stays @2
});

test('ui init creates the folders and starter files, idempotently', () => {
  expect(uiEnabled(root)).toBe(true);
  expect(JSON.parse(readFileSync(uiConfigPath(root), 'utf8'))).toEqual({ targets: [], ignore: [], hardcoded: 'warn' });
  expect(loadTokens(root).get('color.brand.primary')!.value).toEqual({ type: 'color', hex: '#1E5BFFFF' });
  writeFileSync(uiConfigPath(root), '{"targets":[{"lang":"css","out":"t.css"}]}');
  cmdUiInit(root);
  expect(readFileSync(uiConfigPath(root), 'utf8')).toContain('t.css');
});

test('show <component> prints the resolved matrix, impls and uses', () => {
  put('PagarButton.tsx', '// antidrift impl #pagar_button@1\n');
  put('checkout.dart', '// antidrift use #pagar_button:primary\n');
  const out = cmdShow(root, 'pagar_button');
  expect(out).toContain('#pagar_button@2  [component]');
  expect(out).toContain('Variants: primary, secondary');
  expect(out).toContain('States: default, disabled');
  expect(out).toContain('  primary.disabled.background → {color.neutral.300} = #D0D4DC');
  expect(out).toContain('  primary.disabled.radius → {radius.md} = 8px');
  expect(out).toContain('  PagarButton.tsx:1  @1  [stale]');
  expect(out).toContain('  checkout.dart:1  :primary  [ok]');
});

test('show <component> marks broken token refs', () => {
  const c = readComponent(root, 'pagar_button');
  c.styles.secondary.default.background = '{color.nope}';
  writeFileSync(join(componentsDir(root), 'pagar_button.json'), JSON.stringify(c));
  expect(cmdShow(root, 'pagar_button')).toContain('  secondary.default.background → {color.nope} = [broken-token]');
});

test('list shows components and the token count', () => {
  const out = cmdList(root);
  expect(out).toContain('#pagar_button@2  [component] Pagar button — Primary pay action at checkout.');
  expect(out).toContain('3 token(s) — run tokens to list them');
});

test('tokens lists values and filters by prefix', () => {
  writeFileSync(join(tokensDir(root), 'alias.json'), JSON.stringify({ alias: { brand: { $value: '{color.brand.primary}' } } }));
  const all = cmdTokens(root);
  expect(all).toContain('color.brand.primary  color  #1E5BFF');
  expect(all).toContain('radius.md  dimension  8px');
  expect(all).toContain('alias.brand  color  {color.brand.primary} = #1E5BFF');
  expect(cmdTokens(root, 'color').split('\n')).toEqual(['color.brand.primary  color  #1E5BFF', 'color.neutral.300  color  #D0D4DC']);
  expect(cmdTokens(root, 'nope')).toBe('No tokens.');
});

test('tag --impl and --use insert UI tags', () => {
  put('PagarButton.tsx', 'export const X = 1;\n');
  cmdTag(root, 'pagar_button', join(root, 'PagarButton.tsx') + ':1', { kind: 'impl' });
  expect(readFileSync(join(root, 'PagarButton.tsx'), 'utf8')).toBe('// antidrift impl #pagar_button@2\nexport const X = 1;\n');
  put('checkout.dart', 'x\n');
  cmdTag(root, 'pagar_button', join(root, 'checkout.dart') + ':1', { kind: 'use', variant: 'primary' });
  expect(readFileSync(join(root, 'checkout.dart'), 'utf8')).toBe('// antidrift use #pagar_button:primary\nx\n');
  expect(() => cmdTag(root, 'pagar_button', join(root, 'checkout.dart') + ':1', { kind: 'use', variant: 'tertiary' })).toThrow(/tertiary/);
  expect(() => cmdTag(root, 'ghost', join(root, 'checkout.dart') + ':1', { kind: 'impl' })).toThrow();
});

test('notify on a component edit names the stale impl', () => {
  put('PagarButton.tsx', '// antidrift impl #pagar_button@2\n');
  expect(cmdNotify(root, 'pagar_button')).toBe('antidrift: #pagar_button is now @2. No stale implementations.');
  const c = readComponent(root, 'pagar_button');
  c.styles.primary.disabled.background = '{color.brand.primary}';
  writeFileSync(join(componentsDir(root), 'pagar_button.json'), JSON.stringify(c));
  const msg = cmdNotify(root, 'pagar_button');
  expect(msg).toContain('#pagar_button changed to @3. 1 implementation(s) are now STALE');
  expect(msg).toContain('  PagarButton.tsx:1 (tagged @2)');
});

test('notify-tokens lists a stale target and reports invalid tokens', () => {
  writeFileSync(uiConfigPath(root), JSON.stringify({ targets: [{ lang: 'css', out: 'web/tokens.css' }] }));
  const msg = cmdNotifyTokens(root);
  expect(msg).toContain('run gen-tokens');
  expect(msg).toContain('web/tokens.css');
  expect(existsSync(join(root, 'web/tokens.css'))).toBe(false);
  writeFileSync(uiConfigPath(root), JSON.stringify({ targets: [] }));
  expect(cmdNotifyTokens(root)).toBe('antidrift: tokens OK; generated files up to date.');
  writeFileSync(join(tokensDir(root), 'bad.json'), '{ nope');
  expect(cmdNotifyTokens(root)).toMatch(/^antidrift: tokens invalid — bad\.json/);
});

test('import tokens validates against existing tokens and refuses overwrites', () => {
  mkdirSync(join(root, 'in'));
  put('in/extra.json', JSON.stringify({ space: { md: { $type: 'dimension', $value: '16px' } } }));
  expect(cmdImport(root, 'tokens', join(root, 'in/extra.json'))).toContain('extra.json');
  expect(loadTokens(root).has('space.md')).toBe(true);
  expect(() => cmdImport(root, 'tokens', join(root, 'in/extra.json'))).toThrow(/exists/);
  put('in/dup.json', JSON.stringify({ radius: { md: { $type: 'dimension', $value: '4px' } } }));
  expect(() => cmdImport(root, 'tokens', join(root, 'in/dup.json'))).toThrow(/radius\.md/);
  expect(existsSync(join(tokensDir(root), 'dup.json'))).toBe(false);
});
