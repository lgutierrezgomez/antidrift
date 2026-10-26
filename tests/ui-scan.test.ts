import { test, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import * as S from '../src/store.js';
import { cmdScan, cmdGenTokens } from '../src/cli.js';
import { computeUiScan } from '../src/ui/scan.js';
import { tokensDir } from '../src/ui/tokens.js';
import { componentsDir } from '../src/ui/components.js';
import { uiConfigPath } from '../src/ui/config.js';

let root: string;
const put = (rel: string, content: string) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
};
const component = (styles?: unknown) =>
  JSON.stringify({
    id: 'pagar_button',
    version: 2,
    hash: 'h',
    variants: ['primary', 'secondary'],
    states: ['default', 'disabled'],
    styles: styles ?? {
      primary: { default: { background: '{color.brand.primary}', radius: '{radius.md}' } },
      secondary: { default: { background: '{color.brand.primary}' } },
    },
  });
const cfg = (extra: Record<string, unknown> = {}) =>
  writeFileSync(uiConfigPath(root), JSON.stringify({ targets: [{ lang: 'css', out: 'web/ds/tokens.css' }], ...extra }));
const kinds = (r: { line: string; kind: string }[]) => r.map((f) => f.kind);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ad-uiscan-'));
  S.writeEntity(root, { id: 'student', version: 1, hash: 'x', schema: { type: 'object' } });
  put('app.ts', '// antidrift #student@1\n');
});
const enableUi = () => {
  mkdirSync(tokensDir(root), { recursive: true });
  mkdirSync(componentsDir(root), { recursive: true });
  writeFileSync(
    join(tokensDir(root), 'base.json'),
    JSON.stringify({ color: { $type: 'color', brand: { primary: { $value: '#1E5BFF' } } }, radius: { md: { $type: 'dimension', $value: '8px' } } }),
  );
  writeFileSync(join(componentsDir(root), 'pagar_button.json'), component());
  cfg();
  cmdGenTokens(root);
};

test('scan without UI folders is unchanged', () => {
  const r = cmdScan(root);
  expect(r.ui).toBeNull();
  expect(r.report).toBe('Scanned 1 tag(s). No drift.');
});

test('stale and orphan impls', () => {
  enableUi();
  put('web/ds/PagarButton.tsx', '// antidrift impl #pagar_button@1\n');
  put('mobile/ghost.dart', '// antidrift impl #ghost@1\n');
  const ui = computeUiScan(root);
  expect(ui.problems.map((p) => p.line)).toEqual([
    '  mobile/ghost.dart:1  impl #ghost@1 -> orphan',
    '  web/ds/PagarButton.tsx:1  impl #pagar_button@1 -> stale (current @2)',
  ]);
  expect(ui.implCount).toBe(2);
});

test('broken uses', () => {
  enableUi();
  put('app/checkout.dart', '// antidrift use #pagar_button:tertiary\n// antidrift use #ghost\n// antidrift use #pagar_button:primary\n');
  const ui = computeUiScan(root);
  expect(ui.problems.map((p) => p.line)).toEqual([
    '  app/checkout.dart:1  use #pagar_button:tertiary -> broken (no variant "tertiary")',
    '  app/checkout.dart:2  use #ghost -> broken (no component)',
  ]);
  expect(ui.useCount).toBe(3);
});

test('broken token ref', () => {
  enableUi();
  writeFileSync(
    join(componentsDir(root), 'pagar_button.json'),
    component({ primary: { default: { background: '{color.brand.primary-pressd}' } }, secondary: { default: {} } }),
  );
  expect(computeUiScan(root).problems.map((p) => p.line)).toEqual([
    '  #pagar_button primary.default.background -> {color.brand.primary-pressd} [broken-token]',
  ]);
});

test('stale generated file', () => {
  enableUi();
  rmSync(join(root, 'web/ds/tokens.css'));
  expect(computeUiScan(root).problems.map((p) => p.line)).toEqual(['  web/ds/tokens.css -> out of date or hand-edited (run gen-tokens)']);
  cmdGenTokens(root);
  expect(computeUiScan(root).problems).toEqual([]);
});

test('hardcoded color is a warning', () => {
  enableUi();
  put('web/pay.tsx', "const s = { color: '#1e5bff' };\n");
  const r = cmdScan(root);
  expect(r.ui!.warnings.map((w) => w.line)).toEqual(['  web/pay.tsx:1  #1e5bff matches token color.brand.primary [hardcoded]']);
  expect(r.ui!.problems).toEqual([]);
  expect(r.report).toContain('Warnings (1):');
  expect(r.report).toContain('No drift.');
});

test('hardcoded skips allow lines, generated targets, ignore globs, build dirs and non-UI files', () => {
  enableUi();
  cfg({ ignore: ['legacy/**'] });
  put('web/a.tsx', "const c = '#1e5bff'; // antidrift-allow\n");
  put('legacy/colors.dart', 'const c = Color(0xFF1E5BFF);\n');
  put('build/out.js', "x='#1e5bff'\n");
  put('lib/a.g.dart', 'Color(0xFF1E5BFF)\n');
  put('notes.md', '#1e5bff\n');
  expect(computeUiScan(root).warnings).toEqual([]);
});

test('hardcoded: error counts as a problem', () => {
  enableUi();
  cfg({ hardcoded: 'error' });
  put('web/pay.tsx', "const s = 'rgb(30, 91, 255)';\n");
  const ui = computeUiScan(root);
  expect(kinds(ui.problems)).toEqual(['hardcoded']);
  expect(ui.warnings).toEqual([]);
});

test('id clash is reported', () => {
  enableUi();
  S.writeEntity(root, { id: 'pagar_button', version: 1, hash: 'x', schema: { type: 'object' } });
  expect(computeUiScan(root).problems.map((p) => p.line)).toContain('  #pagar_button is both an entity and a component [id-clash]');
});

test('cmdScan counts UI problems in its report', () => {
  enableUi();
  put('web/ds/PagarButton.tsx', '// antidrift impl #pagar_button@1\n');
  const r = cmdScan(root);
  expect(r.ui!.problems).toHaveLength(1);
  expect(r.report).toContain('1 problem(s)');
  expect(r.report).toContain('impl #pagar_button@1 -> stale (current @2)');
});

test('hardcoded skips comments, test files and ad-hoc generated token files by default', () => {
  enableUi();
  put('web/a.tsx', "// brand is #1e5bff\nconst x = 1; /* #1e5bff */\n");
  put('web/a.test.tsx', "expect(c).toBe('#1e5bff');\n");
  put('App/test/widget_test.dart', 'Color(0xFF1E5BFF)\n');
  cmdGenTokens(root, 'css', join(root, 'web/extra-tokens.css'));
  expect(computeUiScan(root).warnings).toEqual([]);
  put('web/b.tsx', "const c = '#1e5bff'; // real one\n");
  expect(computeUiScan(root).warnings.map((w) => w.line)).toEqual(['  web/b.tsx:1  #1e5bff matches token color.brand.primary [hardcoded]']);
});
