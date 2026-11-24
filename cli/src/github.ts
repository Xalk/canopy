import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CliError, ok, run, say, warn } from './run.js';

/** owner/name from "owner/name" or a github.com URL; undefined for other hosts. */
export function githubSlug(repo: string): string | undefined {
  if (!repo.startsWith('https://')) return repo;
  return repo.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/)?.[1];
}

function hasGh(): boolean {
  try {
    return run(['gh', 'auth', 'status'], { capture: true }).code === 0;
  } catch (e) {
    if (e instanceof CliError) return false; // gh not installed
    throw e;
  }
}

/** Create a private vault repo with gh and push the example vault as its first commit. */
export function createVault(repo: string, templateDir: string): void {
  const slug = githubSlug(repo);
  if (!slug || !hasGh()) {
    say(`Create the vault yourself: https://github.com/new -> name "${slug ?? repo}", Private.`);
    say('canopy clones it on the first start (an empty repo is fine).');
    return;
  }
  say(`Creating private repo ${slug} with gh…`);
  if (run(['gh', 'repo', 'create', slug, '--private']).code !== 0) {
    warn('gh repo create failed. Create it at https://github.com/new, then rerun canopy init.');
    return;
  }
  const tmp = mkdtempSync(join(tmpdir(), 'canopy-vault-'));
  cpSync(templateDir, tmp, { recursive: true });
  const steps = [
    ['git', 'init', '-q', '-b', 'main'],
    ['git', 'add', '-A'],
    ['git', 'commit', '-qm', 'Initial vault from the canopy example'],
    ['git', 'push', '-q', `https://github.com/${slug}.git`, 'main'],
  ];
  const failed = steps.find((argv) => run(argv, { cwd: tmp }).code !== 0);
  rmSync(tmp, { recursive: true, force: true });
  if (failed)
    warn(`Vault created, but "${failed.join(' ')}" failed. It still works: it starts empty.`);
  else ok(`Vault ${slug} created with the example layout.`);
}
