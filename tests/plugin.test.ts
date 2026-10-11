import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';

test('plugin manifest and command files are valid', () => {
  JSON.parse(readFileSync('.claude-plugin/plugin.json', 'utf8'));
  const hooks = JSON.parse(readFileSync('hooks/hooks.json', 'utf8'));
  expect(hooks.hooks.PostToolUse).toBeTruthy();
  expect(readFileSync('commands/antidrift-list.md', 'utf8')).toContain('cli.js list');
  expect(readFileSync('skills/antidrift/SKILL.md', 'utf8')).toContain('antidrift #');
});
