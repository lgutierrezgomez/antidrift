const HASH = new Set(['py', 'rb', 'sh', 'bash', 'yaml', 'yml', 'toml', 'r']);
const XML = new Set(['html', 'xml', 'vue', 'svelte', 'md']);

/** Returns [prefix, suffix] for a line comment in the file's language, by extension (`// ` by default). */
export function commentSyntax(file: string): [string, string] {
  const ext = (file.split('.').pop() ?? '').toLowerCase();
  if (HASH.has(ext)) return ['# ', ''];
  if (XML.has(ext)) return ['<!-- ', ' -->'];
  return ['// ', ''];
}
