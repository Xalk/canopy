import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

export type Repo = { repo: string; branch?: string };
export type Endpoint = { host: string; port: number; key?: string; user?: string };
export type Config = {
  name: string;
  target: 'docker' | 'ssh' | 'railway';
  profile: 'personal' | 'project';
  vault?: string;
  repos: Repo[];
  workdir?: string;
  git?: { name?: string; email?: string };
  tz?: string;
  channel: 'telegram' | 'none';
  mcp: string[];
  claudeCodeVersion?: string;
  limits?: { memory?: string; cpus?: number }; // docker resource limits for the container
  ssh?: Endpoint; // the container's sshd
  vps?: Endpoint; // the docker host (target: ssh)
};

export const CONFIG_FILE = 'canopy.yaml';
export class ConfigError extends Error {}

// No value may start with "-": canopy.yaml is meant to be shared, and these end up as arguments
// to ssh, gh and git, where a leading "-" would be read as an option (e.g. -oProxyCommand=...).
export const REPO = /^(\w[\w.-]*\/\w[\w.-]*|https:\/\/[^\s'"]+)$/;
const NAME = /^[a-z0-9][a-z0-9_-]*$/;
const BRANCH = /^\w[\w./-]*$/;
const HOST = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;
const USER = /^[A-Za-z_][\w.-]*$/;
const MEMORY = /^\d+(\.\d+)?[kmg]$/i;

function limits(v: unknown): Config['limits'] {
  if (v === undefined) return undefined;
  if (typeof v !== 'object' || v === null)
    fail('limits', 'must be a mapping, e.g. { memory: 4g, cpus: 1.5 }');
  const o = v as Record<string, unknown>;
  const memory = str(o.memory, 'limits.memory');
  if (memory && !MEMORY.test(memory))
    fail('limits.memory', `must look like 512m or 4g (got "${memory}")`);
  const cpus = o.cpus === undefined ? undefined : Number(o.cpus);
  if (cpus !== undefined && !(cpus > 0))
    fail('limits.cpus', `must be a positive number (got "${o.cpus}")`);
  return { memory, cpus };
}

function fail(field: string, msg: string): never {
  throw new ConfigError(`${CONFIG_FILE}: "${field}" ${msg}`);
}
function oneOf<T extends string>(v: unknown, field: string, values: readonly T[], def: T): T {
  if (v === undefined) return def;
  if (!values.includes(v as T)) fail(field, `must be one of: ${values.join(', ')} (got "${v}")`);
  return v as T;
}
function str(v: unknown, field: string): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string' && typeof v !== 'number') fail(field, 'must be a string');
  const s = String(v);
  if (/[\r\n]/.test(s)) fail(field, 'must be a single line');
  return s;
}
function endpoint(v: unknown, field: string, defaultPort: number): Endpoint | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'object' || v === null) fail(field, 'must be a mapping with host, port, key');
  const o = v as Record<string, unknown>;
  const host = str(o.host, `${field}.host`) ?? fail(`${field}.host`, 'is required');
  if (!HOST.test(host)) fail(`${field}.host`, `must be a hostname or IP address (got "${host}")`);
  const user = str(o.user, `${field}.user`);
  if (user && !USER.test(user)) fail(`${field}.user`, `is not a valid user name (got "${user}")`);
  const port = Number(o.port ?? defaultPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    fail(`${field}.port`, 'must be a port number');
  return { host, port, key: str(o.key, `${field}.key`), user };
}

export function parseConfig(text: string): Config {
  const raw = (parse(text) ?? {}) as Record<string, unknown>;
  if (typeof raw !== 'object' || Array.isArray(raw))
    throw new ConfigError(`${CONFIG_FILE}: must be a YAML mapping`);

  const name = str(raw.name, 'name') ?? 'canopy';
  if (!NAME.test(name)) fail('name', 'may contain only lowercase letters, digits, "-" and "_"');

  const repos = ((raw.repos ?? []) as unknown[]).map((r, i): Repo => {
    const o = typeof r === 'string' ? { repo: r } : (r as Record<string, unknown>);
    const repo =
      str(o?.repo, `repos[${i}].repo`) ?? fail(`repos[${i}]`, 'needs a repo: owner/name');
    if (!REPO.test(repo)) fail(`repos[${i}]`, `must be owner/name or an https URL (got "${repo}")`);
    const branch = str(o.branch, `repos[${i}].branch`);
    if (branch && !BRANCH.test(branch))
      fail(`repos[${i}].branch`, `is not a valid branch name (got "${branch}")`);
    return { repo, branch };
  });

  const vault = str(raw.vault, 'vault');
  if (vault && !REPO.test(vault))
    fail('vault', `must be owner/name or an https URL (got "${vault}")`);

  const mcp = (raw.mcp ?? []) as unknown;
  if (!Array.isArray(mcp)) fail('mcp', 'must be a list, e.g. [linear, figma]');

  const git = (raw.git ?? {}) as Record<string, unknown>;
  const cfg: Config = {
    name,
    target: oneOf(raw.target, 'target', ['docker', 'ssh', 'railway'] as const, 'docker'),
    profile: oneOf(raw.profile, 'profile', ['personal', 'project'] as const, 'personal'),
    vault,
    repos,
    workdir: str(raw.workdir, 'workdir'),
    git: { name: str(git.name, 'git.name'), email: str(git.email, 'git.email') },
    tz: str(raw.tz, 'tz'),
    channel: oneOf(raw.channel, 'channel', ['telegram', 'none'] as const, 'telegram'),
    mcp: mcp.map((m, i) => str(m, `mcp[${i}]`) ?? fail(`mcp[${i}]`, 'must not be empty')),
    claudeCodeVersion: str(raw.claudeCodeVersion, 'claudeCodeVersion'),
    limits: limits(raw.limits),
    ssh: endpoint(raw.ssh, 'ssh', 2222), // the container's sshd
    vps: endpoint(raw.vps, 'vps', 22), // the docker host
  };
  if (cfg.target === 'ssh' && !cfg.vps)
    fail('vps', 'is required for target: ssh (the docker host: host, port, key)');
  if (cfg.target === 'railway' && !cfg.ssh)
    fail('ssh', 'is required for target: railway (the TCP proxy host and port)');
  return cfg;
}

export function loadConfig(dir: string): Config {
  const file = join(dir, CONFIG_FILE);
  if (!existsSync(file))
    throw new ConfigError(`${CONFIG_FILE} not found in ${dir}. Run \`canopy init\` to create one.`);
  return parseConfig(readFileSync(file, 'utf8'));
}
