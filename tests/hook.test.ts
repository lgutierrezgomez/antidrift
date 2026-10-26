import { test, expect, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOOK = join(process.cwd(), 'hooks', 'on-entity-change.sh');
const PLUGIN_ROOT = process.cwd(); // the antidrift repo — has dist/cli.js

function runHook(filePath: string, env: NodeJS.ProcessEnv): string {
  const input = JSON.stringify({ tool_input: { file_path: filePath } });
  return execFileSync('bash', [HOOK], { input, env, encoding: 'utf8' });
}

let proj: string;
beforeEach(() => {
  proj = mkdtempSync(join(tmpdir(), 'ad-hook-'));
  mkdirSync(join(proj, '.antidrift', 'entities'), { recursive: true });
  writeFileSync(
    join(proj, '.antidrift', 'entities', 'student.json'),
    JSON.stringify({ id: 'student', version: 1, hash: 'x', schema: { type: 'object', properties: { id: { type: 'string' } } } }),
  );
  writeFileSync(join(proj, 'app.ts'), '// antidrift #student@1\n');
});

test('hook reports stale usages when an entity changes', () => {
  const out = runHook(join(proj, '.antidrift', 'entities', 'student.json'), { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT });
  const ctx = JSON.parse(out).hookSpecificOutput.additionalContext as string;
  expect(ctx).toContain('STALE');
  expect(ctx).toContain('app.ts:1');
});

test('hook ignores writes outside .antidrift/entities', () => {
  const out = runHook(join(proj, 'src', 'foo.ts'), { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT });
  expect(out.trim()).toBe('');
});

test('hook surfaces a diagnostic when CLAUDE_PLUGIN_ROOT is unset', () => {
  const env = { ...process.env };
  delete env.CLAUDE_PLUGIN_ROOT;
  const out = runHook(join(proj, '.antidrift', 'entities', 'student.json'), env);
  const ctx = JSON.parse(out).hookSpecificOutput.additionalContext as string;
  expect(ctx).toContain('CLAUDE_PLUGIN_ROOT');
});

test('hook ignores json outside the entities folder itself', () => {
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };
  expect(runHook(join(proj, 'x.antidrift', 'entities', 'student.json'), env).trim()).toBe('');
  expect(runHook(join(proj, '.antidrift', 'entities', 'nested', 'student.json'), env).trim()).toBe('');
});

test('hook accepts a relative entity path', () => {
  const input = JSON.stringify({ tool_input: { file_path: '.antidrift/entities/student.json' } });
  const out = execFileSync('bash', [HOOK], { input, cwd: proj, env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT }, encoding: 'utf8' });
  expect(JSON.parse(out).hookSpecificOutput.additionalContext).toContain('app.ts:1');
});

test('hook ignores a nested relative path under entities', () => {
  const input = JSON.stringify({ tool_input: { file_path: '.antidrift/entities/nested/student.json' } });
  const out = execFileSync('bash', [HOOK], { input, cwd: proj, env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT }, encoding: 'utf8' });
  expect(out.trim()).toBe('');
});

test('hook reports stale implementations when a component changes', () => {
  mkdirSync(join(proj, '.antidrift', 'components'), { recursive: true });
  const spec = {
    id: 'pagar_button', version: 2, hash: 'old', variants: ['primary'], states: ['default'],
    styles: { primary: { default: { background: '{color.brand.primary}' } } },
  };
  writeFileSync(join(proj, '.antidrift', 'components', 'pagar_button.json'), JSON.stringify(spec));
  writeFileSync(join(proj, 'Pagar.tsx'), '// antidrift impl #pagar_button@2\n');
  const out = runHook(join(proj, '.antidrift', 'components', 'pagar_button.json'), { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT });
  const ctx = JSON.parse(out).hookSpecificOutput.additionalContext as string;
  expect(ctx).toContain('STALE');
  expect(ctx).toContain('Pagar.tsx:1');
});

test('hook reports out-of-date token files without writing them', () => {
  mkdirSync(join(proj, '.antidrift', 'tokens'), { recursive: true });
  writeFileSync(join(proj, '.antidrift', 'tokens', 'base.json'), JSON.stringify({ c: { $type: 'color', a: { $value: '#000000' } } }));
  writeFileSync(join(proj, '.antidrift', 'ui.json'), JSON.stringify({ targets: [{ lang: 'css', out: 'web/tokens.css' }] }));
  const out = runHook(join(proj, '.antidrift', 'tokens', 'base.json'), { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT });
  const ctx = JSON.parse(out).hookSpecificOutput.additionalContext as string;
  expect(ctx).toContain('run gen-tokens');
  expect(existsSync(join(proj, 'web', 'tokens.css'))).toBe(false);
});
