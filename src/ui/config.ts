import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { storeDir } from '../store.js';
import { loadTokens, tokensDir, type Token } from './tokens.js';
import { TOKEN_EMITTERS } from './token-emitters.js';

export interface UiTarget {
  lang: string;
  out: string;
  className?: string;
}
export interface UiConfig {
  targets: UiTarget[];
  ignore: string[];
  hardcoded: 'warn' | 'error';
}

export const uiConfigPath = (root: string) => join(storeDir(root), 'ui.json');

/** The UI module is on only when its folders exist — otherwise antidrift behaves as before. */
export const uiEnabled = (root: string) => existsSync(tokensDir(root)) || existsSync(join(storeDir(root), 'components'));

export function readUiConfig(root: string): UiConfig {
  const path = uiConfigPath(root);
  if (!existsSync(path)) return { targets: [], ignore: [], hardcoded: 'warn' };
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`ui.json: invalid JSON (${(e as Error).message})`);
  }
  const targets = (raw.targets ?? []) as UiTarget[];
  if (!Array.isArray(targets)) throw new Error('ui.json: "targets" must be an array');
  for (const t of targets) {
    if (!t || typeof t.out !== 'string' || !t.out) throw new Error('ui.json: every target needs an "out" path');
    if (!TOKEN_EMITTERS.has(t.lang))
      throw new Error(`ui.json: unknown target lang ${JSON.stringify(t.lang)} (have: ${[...TOKEN_EMITTERS.keys()].join(', ')})`);
  }
  const ignore = (raw.ignore ?? []) as string[];
  if (!Array.isArray(ignore) || !ignore.every((g) => typeof g === 'string')) throw new Error('ui.json: "ignore" must be an array of globs');
  const hardcoded = (raw.hardcoded ?? 'warn') as UiConfig['hardcoded'];
  if (hardcoded !== 'warn' && hardcoded !== 'error') throw new Error('ui.json: "hardcoded" must be "warn" or "error"');
  return { targets, ignore, hardcoded };
}

/** Minimal glob: `**` spans directories, `*` stays within one, `?` is one character. Matches repo-relative POSIX paths. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') {
        i++;
        re += '(?:.*/)?';
      } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export function generateTarget(root: string, t: UiTarget, tokens: Map<string, Token> = loadTokens(root)): string {
  const emitter = TOKEN_EMITTERS.get(t.lang);
  if (!emitter) throw new Error(`unknown token target lang: ${t.lang}`);
  return emitter.emit(tokens, { className: t.className });
}

/** Targets whose file is missing or differs from a fresh generation (tokens changed, or hand-edited). */
export function staleTargets(root: string, cfg: UiConfig = readUiConfig(root)): UiTarget[] {
  const tokens = loadTokens(root);
  return cfg.targets.filter((t) => {
    const path = resolve(root, t.out);
    return !existsSync(path) || readFileSync(path, 'utf8') !== generateTarget(root, t, tokens);
  });
}
