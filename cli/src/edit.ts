import { readFileSync, writeFileSync } from 'node:fs';
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
