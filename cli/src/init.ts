import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { confirm, input, select } from '@inquirer/prompts';
import { stringify } from 'yaml';
import { CONFIG_FILE, type Config, loadConfig, REPO, type Repo } from './config.js';
import { parseEnvFile } from './env.js';
import { createVault } from './github.js';
import { ok, run, say, warn } from './run.js';

/** Secrets canopy may need, with where to get each one. Order = order in .env. */
const SECRETS: Record<string, string> = {
  AUTHORIZED_KEYS:
    'Public SSH key(s) allowed to log in to the container; several: separate with ";".',
  GH_TOKEN:
    'GitHub fine-grained token: https://github.com/settings/personal-access-tokens/new\n' +
    '# Repository access: only the repos in canopy.yaml + the vault.\n' +
    '# Permissions: Contents and Pull requests read/write.',
  LINEAR_API_KEY: 'Linear -> Settings -> Security & access -> Personal API keys.',
  TELEGRAM_BOT_TOKEN: 'Telegram: message @BotFather, send /newbot. Use one bot per environment.',
};

export function neededSecrets(cfg: Config): string[] {
  return [
    'AUTHORIZED_KEYS',
    'GH_TOKEN',
    ...(cfg.mcp.includes('linear') ? ['LINEAR_API_KEY'] : []),
    ...(cfg.channel === 'telegram' ? ['TELEGRAM_BOT_TOKEN'] : []),
  ];
}

export function buildYaml(cfg: Config): string {
  const o: Record<string, unknown> = { name: cfg.name, target: cfg.target, profile: cfg.profile };
  if (cfg.vault) o.vault = cfg.vault;
  o.repos = cfg.repos.map((r) => (r.branch ? { repo: r.repo, branch: r.branch } : r.repo));
  if (cfg.workdir) o.workdir = cfg.workdir;
  if (cfg.git?.name || cfg.git?.email) o.git = clean(cfg.git);
  if (cfg.tz) o.tz = cfg.tz;
  o.channel = cfg.channel;
  if (cfg.mcp.length) o.mcp = cfg.mcp;
  if (cfg.claudeCodeVersion) o.claudeCodeVersion = cfg.claudeCodeVersion;
  if (cfg.ssh) o.ssh = clean(cfg.ssh);
  if (cfg.vps) o.vps = clean(cfg.vps);
  const hint = cfg.mcp.length
    ? ''
    : '# mcp: [linear, figma]   (turn on with: canopy mcp add linear)\n';
  return `# canopy environment. No secrets here: they live in .env.\n${stringify(o)}${hint}`;
}
const clean = (o: object) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** .env with a comment above each secret. Existing values are kept, unknown keys moved to the end. */
export function buildEnv(keys: string[], existing: Record<string, string>): string {
  let out = '# canopy secrets. Never commit this file.\n';
  for (const k of keys) out += `\n# ${SECRETS[k]}\n${k}=${existing[k] ?? ''}\n`;
  const extra = Object.keys(existing).filter((k) => !keys.includes(k));
  if (extra.length) out += `\n# Other\n${extra.map((k) => `${k}=${existing[k]}\n`).join('')}`;
  return out;
}

export function ensureGitignore(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const missing = ['.env', '.canopy/', '*.local.*'].filter((l) => !lines.includes(l));
  if (!missing.length) return text;
  return `${text}${text && !text.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`;
}

/** `git ls-remote --symref <url> HEAD` output -> default branch. */
/** Add a public key to AUTHORIZED_KEYS (";"-separated) unless it is already there; keeps the others. */
export function mergeAuthorizedKeys(existing: string | undefined, key: string): string {
  if (!existing) return key;
  const body = key.split(/\s+/)[1];
  return body && existing.includes(body) ? existing : `${existing};${key}`;
}

export function parseHead(lsRemote: string): string | undefined {
  return lsRemote.match(/^ref: refs\/heads\/(\S+)\s+HEAD/m)?.[1];
}

const repoUrl = (r: string) => (r.startsWith('https://') ? r : `https://github.com/${r}.git`);
function defaultBranch(repo: string): string | undefined {
  // GIT_TERMINAL_PROMPT=0: fail instead of asking for a password in the middle of the wizard.
  const r = run(['git', 'ls-remote', '--symref', repoUrl(repo), 'HEAD'], {
    capture: true,
    env: { GIT_TERMINAL_PROMPT: '0' },
  });
  return r.code === 0 ? parseHead(r.stdout) : undefined;
}
const gitConfig = (key: string) =>
  run(['git', 'config', '--global', key], { capture: true }).stdout.trim() || undefined;
const repoRule = (v: string) => !v || REPO.test(v) || 'Use owner/name or an https URL';

export async function init(dir: string, packageDir: string): Promise<number> {
  const cfgPath = join(dir, CONFIG_FILE);
  const envPath = join(dir, '.env');
  let prev: Config | undefined;
  let prevEnv: Record<string, string> = {};

  if (existsSync(cfgPath) || existsSync(envPath)) {
    const mode = await select({
      message: 'canopy.yaml or .env already exists here. What now?',
      choices: [
        { name: 'Update: current values become defaults, secrets are kept', value: 'update' },
        { name: 'Overwrite: start from scratch', value: 'overwrite' },
        { name: 'Cancel', value: 'cancel' },
      ],
    });
    if (mode === 'cancel') return 0;
    if (mode === 'update') {
      try {
        prev = existsSync(cfgPath) ? loadConfig(dir) : undefined;
      } catch (e) {
        warn(`Current canopy.yaml is invalid (${(e as Error).message}); starting from defaults.`);
      }
      if (existsSync(envPath)) prevEnv = parseEnvFile(readFileSync(envPath, 'utf8'));
    }
  }

  const profile = await select({
    message: 'Profile',
    default: prev?.profile,
    choices: [
      { name: 'personal: your assistant across your own repos', value: 'personal' as const },
      { name: 'project: an environment for one project', value: 'project' as const },
    ],
  });

  const target = await select({
    message: 'Where will it run?',
    default: prev?.target,
    choices: [
      {
        name: 'docker on this machine (this VPS, or your laptop to try it)',
        value: 'docker' as const,
      },
      { name: 'a VPS, driven from here over SSH', value: 'ssh' as const },
      { name: 'Railway', value: 'railway' as const },
    ],
  });

  // The SSH key: its .pub goes to AUTHORIZED_KEYS, its private half is what the CLI connects with.
  const sshDir = join(homedir(), '.ssh');
  const pubs = existsSync(sshDir) ? readdirSync(sshDir).filter((f) => f.endsWith('.pub')) : [];
  let key: string | undefined;
  if (pubs.length) {
    const pub = await select({
      message: 'SSH key to log in to the container',
      choices: pubs.map((p) => ({
        name: `${p}  ${readFileSync(join(sshDir, p), 'utf8').trim().split(/\s+/)[2] ?? ''}`,
        value: p,
      })),
    });
    prevEnv.AUTHORIZED_KEYS = mergeAuthorizedKeys(
      prevEnv.AUTHORIZED_KEYS,
      readFileSync(join(sshDir, pub), 'utf8').trim(),
    );
    key = `~/.ssh/${pub.replace(/\.pub$/, '')}`;
  } else {
    // Typical when init runs on the server itself: no key pair here, but the key you log in
    // with is in authorized_keys, and that's the one the container should accept too.
    const authFile = join(sshDir, 'authorized_keys');
    const authorized = existsSync(authFile)
      ? readFileSync(authFile, 'utf8')
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => /^(ssh-|ecdsa-|sk-)/.test(l))
      : [];
    const useThem =
      authorized.length > 0 &&
      (await confirm({
        message: `No key pair on this machine. Use the key you log in here with (${authorized.length} in ~/.ssh/authorized_keys)?`,
        default: true,
      }));
    if (useThem) {
      prevEnv.AUTHORIZED_KEYS = authorized.reduce(
        (all, k) => mergeAuthorizedKeys(all || undefined, k),
        prevEnv.AUTHORIZED_KEYS ?? '',
      );
    } else if (!prevEnv.AUTHORIZED_KEYS) {
      say(
        'No SSH key picked. That is fine: put your public key into AUTHORIZED_KEYS in .env later.',
      );
    }
  }

  let ssh: Config['ssh'] = { host: 'localhost', port: prev?.ssh?.port ?? 2222, key };
  let vps: Config['vps'];
  if (target === 'ssh') {
    const host = await input({ message: 'VPS host', default: prev?.vps?.host, required: true });
    const user = await input({ message: 'VPS user', default: prev?.vps?.user ?? 'root' });
    const port = Number(
      await input({ message: 'VPS SSH port', default: String(prev?.vps?.port ?? 22) }),
    );
    vps = { host, user, port, key };
    ssh = { host, port: prev?.ssh?.port ?? 2222, key };
  } else if (target === 'railway') {
    say('Railway: Settings -> Networking -> TCP Proxy on port 22 gives you host:port.');
    const host = await input({
      message: 'TCP proxy host',
      default: prev?.ssh?.host,
      required: true,
    });
    const port = Number(
      await input({
        message: 'TCP proxy port',
        default: String(prev?.ssh?.port ?? ''),
        required: true,
      }),
    );
    ssh = { host, port, key };
  }

  const vaultMode = await select({
    message: 'Knowledge vault (a git repo synced every 5 min)',
    default: prev?.vault ? 'existing' : undefined,
    choices: [
      { name: 'I have one', value: 'existing' },
      { name: 'Create a new private repo from the canopy example', value: 'create' },
      { name: 'No vault', value: 'none' },
    ],
  });
  let vault: string | undefined;
  if (vaultMode !== 'none') {
    vault = await input({
      message: 'Vault repo (owner/name)',
      default: prev?.vault,
      required: true,
      validate: repoRule,
    });
    if (vaultMode === 'create') createVault(vault, join(packageDir, 'examples', 'vault'));
  }

  const repos: Repo[] = [];
  for (const r of prev?.repos ?? [])
    say(`Current repo: ${r.repo}${r.branch ? `#${r.branch}` : ''}`);
  if (
    prev?.repos.length &&
    (await select({
      message: 'Keep the current repos?',
      choices: [
        { name: 'Yes', value: true },
        { name: 'No, enter them again', value: false },
      ],
    }))
  )
    repos.push(...prev.repos);
  for (;;) {
    const repo = (
      await input({ message: 'Repo to clone (owner/name), empty to finish', validate: repoRule })
    ).trim();
    if (!repo) break;
    const head = defaultBranch(repo);
    if (!head) {
      // Usually a private repo and no git login on this machine; the container clones with GH_TOKEN.
      say(`Can't look into ${repo} from this machine (private repo, or no git login here).`);
      say(
        'That is fine: the container clones it with GH_TOKEN. Press Enter for its default branch.',
      );
    }
    const branch = (await input({ message: `Branch for ${repo}`, default: head ?? '' })).trim();
    repos.push({ repo, branch: branch && branch !== head ? branch : undefined });
  }

  const telegram = await confirm({
    message: 'Talk to the agent from Telegram?',
    default: prev ? prev.channel === 'telegram' : true,
  });
  say('Linear and Figma can be turned on any time: canopy mcp add linear | figma');

  const gitName = await input({
    message: 'Git author name (empty: your GitHub login)',
    default: prev?.git?.name ?? gitConfig('user.name'),
  });
  const gitEmail = await input({
    message: 'Git author email (empty: GitHub noreply)',
    default: prev?.git?.email ?? gitConfig('user.email'),
  });
  const tz = await input({
    message: 'Time zone',
    default: prev?.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  const cfg: Config = {
    name: prev?.name ?? 'canopy',
    target,
    profile,
    vault,
    repos,
    workdir: prev?.workdir,
    git: { name: gitName || undefined, email: gitEmail || undefined },
    tz: tz || undefined,
    channel: telegram ? 'telegram' : 'none',
    mcp: prev?.mcp ?? [],
    claudeCodeVersion: prev?.claudeCodeVersion,
    ssh,
    vps,
  };

  const secrets = neededSecrets(cfg);
  writeFileSync(cfgPath, buildYaml(cfg));
  writeFileSync(envPath, buildEnv(secrets, prevEnv), { mode: 0o600 });
  const gi = join(dir, '.gitignore');
  writeFileSync(gi, ensureGitignore(existsSync(gi) ? readFileSync(gi, 'utf8') : ''));
  ok('Wrote canopy.yaml, .env and .gitignore.');

  const empty = secrets.filter((k) => !prevEnv[k]);
  const slugs = [...cfg.repos.map((r) => r.repo), ...(cfg.vault ? [cfg.vault] : [])];
  console.log('\nNext steps:');
  if (empty.length)
    console.log(`  1. Fill in .env: ${empty.join(', ')} (each has a comment on where to get it).`);
  if (slugs.length) console.log(`  2. Give GH_TOKEN access to: ${slugs.join(', ')}`);
  console.log('  3. Check the keys:   canopy init --check');
  console.log('  4. Start:            canopy up');
  return 0;
}
