import { test, expect, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
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
