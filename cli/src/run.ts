import { spawnSync } from 'node:child_process';
import { styleText } from 'node:util';

export const say = (msg: string) => console.log(`${styleText('cyan', '›')} ${msg}`);
export const ok = (msg: string) => console.log(`${styleText('green', '✔')} ${msg}`);
export const warn = (msg: string) => console.error(`${styleText('yellow', '!')} ${msg}`);
export const bad = (msg: string, hint?: string) =>
  console.error(`${styleText('red', '✘')} ${msg}${hint ? ` — ${hint}` : ''}`);

export class CliError extends Error {
  constructor(
    msg: string,
    readonly hint?: string,
  ) {
    super(msg);
  }
}

/** Run a command with the terminal attached (or capture stdout). No shell: argv is passed as is. */
export function run(
  argv: string[],
  opts: { capture?: boolean; cwd?: string; input?: string | Buffer; env?: NodeJS.ProcessEnv } = {},
) {
  const r = spawnSync(argv[0], argv.slice(1), {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : undefined,
    input: opts.input,
    encoding: 'utf8',
    stdio: opts.capture || opts.input !== undefined ? 'pipe' : 'inherit',
  });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ENOENT') {
    throw new CliError(
      `\`${argv[0]}\` not found.`,
      INSTALL_HINTS[argv[0]] ?? `Install ${argv[0]} and make sure it is on PATH.`,
    );
  }
  if (r.error) throw r.error;
  return { code: r.status ?? 1, stdout: r.stdout ?? '' };
}

const INSTALL_HINTS: Record<string, string> = {
  docker: 'Install Docker Desktop (https://docs.docker.com/get-docker/) and start it.',
  ssh: 'Install an OpenSSH client (built into Windows 10+, macOS and most Linux).',
  railway: 'Install the Railway CLI: npm i -g @railway/cli',
};

/** Run a command and return its stdout as bytes (e.g. a tar archive). */
export function runBytes(argv: string[], cwd?: string): Buffer {
  const r = spawnSync(argv[0], argv.slice(1), { cwd, stdio: ['ignore', 'pipe', 'inherit'] });
  if (r.error || r.status !== 0) throw new CliError(`\`${argv.join(' ')}\` failed.`);
  return r.stdout;
}
