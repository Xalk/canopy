import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument, type YAMLSeq } from 'yaml';
import { CONFIG_FILE, ConfigError, parseConfig, REPO } from './config.js';
import { CliError } from './run.js';

// Edits go through the YAML document, so comments and layout in canopy.yaml survive.

export function addRepoYaml(text: string, repo: string, branch?: string): string {
  if (!REPO.test(repo)) throw new ConfigError(`"${repo}" is not owner/name or an https URL`);
  if (parseConfig(text).repos.some((r) => r.repo === repo)) {
    throw new ConfigError(`${repo} is already in ${CONFIG_FILE}`);
  }
  const doc = parseDocument(text);
  const item = branch ? { repo, branch } : repo;
  const seq = doc.get('repos') as YAMLSeq | undefined;
  if (seq) seq.add(doc.createNode(item));
  else doc.set('repos', doc.createNode([item]));
  return doc.toString();
}

export function removeRepoYaml(text: string, repo: string): string {
  const i = parseConfig(text).repos.findIndex((r) => r.repo === repo);
  if (i < 0) throw new ConfigError(`${repo} is not in ${CONFIG_FILE}`);
  const doc = parseDocument(text);
  (doc.get('repos') as YAMLSeq).delete(i);
  return doc.toString();
}

export function setYamlValue(text: string, key: string, value: string): string {
  const doc = parseDocument(text);
  doc.set(key, value);
  return doc.toString();
}

export function editConfigFile(dir: string, edit: (text: string) => string): void {
  const file = join(dir, CONFIG_FILE);
  writeFileSync(file, edit(readFileSync(file, 'utf8')));
}

/** Folder name the container clones a repo into: ~/projects/<name>. */
export const repoDirName = (repo: string) => (repo.split('/').pop() ?? repo).replace(/\.git$/, '');

export const claudeVersionInDockerfile = (dockerfile: string) =>
  dockerfile.match(/^ARG CLAUDE_CODE_VERSION=(\S+)/m)?.[1];

export async function latestClaudeVersion(): Promise<string> {
  try {
    const res = await fetch('https://registry.npmjs.org/@anthropic-ai/claude-code/latest', {
      signal: AbortSignal.timeout(10_000),
    });
    const { version } = (await res.json()) as { version?: string };
    if (res.ok && version) return version;
  } catch {
    // fall through
  }
  throw new CliError(
    'Could not read the latest Claude Code version from npm.',
    'Pass one: canopy update --claude 2.1.0',
  );
}

/** MCP servers canopy knows how to set up. Linear needs an API key; Figma logs in with OAuth. */
export const MCP_SERVERS = {
  linear: {
    secret: 'LINEAR_API_KEY',
    where: 'Linear -> Settings -> Security & access -> Personal API keys',
  },
  figma: {},
} as const;
export type McpName = keyof typeof MCP_SERVERS;
export const isMcpName = (v: string): v is McpName => Object.hasOwn(MCP_SERVERS, v);

/** Turn an MCP server on or off in `mcp:` (no-op if it already is). */
export function setMcpYaml(text: string, name: McpName, on: boolean): string {
  const current = parseConfig(text).mcp;
  if (current.includes(name) === on) return text;
  const doc = parseDocument(text);
  const seq = doc.get('mcp') as YAMLSeq | undefined;
  if (!on) seq?.delete(current.indexOf(name));
  else if (seq) seq.add(doc.createNode(name));
  else doc.set('mcp', doc.createNode([name]));
  return doc.toString();
}

/** Set KEY=value in .env text: replace the existing line, or append it with a comment. */
export function setEnvValue(text: string, key: string, value: string, comment?: string): string {
  const line = new RegExp(`^${key}=.*$`, 'm');
  if (line.test(text)) return text.replace(line, () => `${key}=${value}`);
  const sep = text && !text.endsWith('\n') ? '\n' : '';
  return `${text}${sep}\n${comment ? `# ${comment}\n` : ''}${key}=${value}\n`;
}

export function editEnvFile(dir: string, edit: (text: string) => string): void {
  const file = join(dir, '.env');
  writeFileSync(file, edit(existsSync(file) ? readFileSync(file, 'utf8') : ''), { mode: 0o600 });
}
