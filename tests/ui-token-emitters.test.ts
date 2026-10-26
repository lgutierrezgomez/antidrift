import { test, expect } from 'vitest';
import { parseTokenTree, resolveTokenTree } from '../src/ui/tokens.js';
import { cssTokenEmitter, dartTokenEmitter, GENERATED_HEADER, TOKEN_EMITTERS } from '../src/ui/token-emitters.js';

const tokens = (doc: unknown) => resolveTokenTree(parseTokenTree(doc, 'x.json'));

const BASE = {
  color: { $type: 'color', brand: { primary: { $value: '#1E5BFF' } }, 'on-brand': { $value: '{color.brand.primary}' } },
  radius: { md: { $type: 'dimension', $value: { value: 8, unit: 'px' } } },
  font: {
    body: { $type: 'fontFamily', $value: ['Inter', 'Helvetica Neue'] },
    strong: { $type: 'fontWeight', $value: 600 },
  },
  motion: { fast: { $type: 'duration', $value: '200ms' } },
  opacity: { muted: { $type: 'number', $value: 0.6 } },
};

test('registry exposes css and dart', () => {
  expect([...TOKEN_EMITTERS.keys()].sort()).toEqual(['css', 'dart']);
});

test('css emits root variables with header', () => {
  const out = cssTokenEmitter.emit(tokens(BASE));
  expect(out).toContain(GENERATED_HEADER);
  expect(out).toContain(':root {');
  expect(out).toContain('  --color-brand-primary: #1e5bff;');
  expect(out).toContain('  --radius-md: 8px;');
  expect(out).toContain('  --font-body: "Inter", "Helvetica Neue";');
  expect(out).toContain('  --font-strong: 600;');
  expect(out).toContain('  --motion-fast: 200ms;');
  expect(out).toContain('  --opacity-muted: 0.6;');
});

test('css keeps alpha and emits var() for aliases', () => {
  const out = cssTokenEmitter.emit(
    tokens({ color: { $type: 'color', veil: { $value: '#1E5BFF80' }, brand: { primary: { $value: '#1E5BFF' } }, 'on-brand': { $value: '{color.brand.primary}' } } }),
  );
  expect(out).toContain('  --color-veil: #1e5bff80;');
  expect(out).toContain('  --color-on-brand: var(--color-brand-primary);');
});

test('dart emits a final class with typed constants', () => {
  const out = dartTokenEmitter.emit(tokens(BASE));
  expect(out).toContain(GENERATED_HEADER);
  expect(out).toContain("import 'package:flutter/painting.dart';");
  expect(out).toContain('abstract final class DsTokens {');
  expect(out).toContain('  static const colorBrandPrimary = Color(0xFF1E5BFF);');
  expect(out).toContain('  static const colorOnBrand = colorBrandPrimary;');
  expect(out).toContain('  static const radiusMd = 8.0;');
  expect(out).toContain("  static const fontBody = 'Inter';");
  expect(out).toContain('  static const fontStrong = FontWeight.w600;');
  expect(out).toContain('  static const motionFast = Duration(milliseconds: 200);');
  expect(out).toContain('  static const opacityMuted = 0.6;');
  expect(dartTokenEmitter.emit(tokens(BASE), { className: 'AppTokens' })).toContain('abstract final class AppTokens {');
});

test('dart converts rem at 16px and guards digits/reserved words', () => {
  const out = dartTokenEmitter.emit(
    tokens({ space: { $type: 'dimension', half: { $value: '0.5rem' } }, '2xl': { $type: 'number', $value: 2 }, default: { $type: 'number', $value: 1 } }),
  );
  expect(out).toContain('  static const spaceHalf = 8.0;');
  expect(out).toContain('  static const t2xl = 2.0;');
  expect(out).toContain('  static const defaultToken = 1.0;');
});

test('dart rejects identifier collisions', () => {
  const t = tokens({ color: { $type: 'color', 'a-b': { $value: '#000000' }, aB: { $value: '#ffffff' } } });
  expect(() => dartTokenEmitter.emit(t)).toThrow(/color\.a-b[\s\S]*color\.aB|color\.aB[\s\S]*color\.a-b/);
});

test('emitters are deterministic', () => {
  const a = tokens({ x: { $type: 'number', b: { $value: 2 }, a: { $value: 1 } } });
  const b = tokens({ x: { $type: 'number', a: { $value: 1 }, b: { $value: 2 } } });
  expect(cssTokenEmitter.emit(a)).toBe(cssTokenEmitter.emit(b));
  expect(dartTokenEmitter.emit(a)).toBe(dartTokenEmitter.emit(b));
});
