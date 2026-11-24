import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Endpoint } from '../config.js';
import { run } from '../run.js';

/** "~/.ssh/id" -> absolute path, so it works on Windows too. */
export const expandHome = (p: string) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p);

/** Quote one argument for the remote POSIX shell that ssh hands the command to. */
export const shellQuote = (arg: string) =>
  /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;

/** ssh argv for an endpoint; the remote command is passed as one quoted string. */
export function sshArgv(ep: Endpoint, remote: string[], opts: { tty?: boolean } = {}): string[] {
  return [
    'ssh',
    ...(opts.tty ? ['-t'] : []),
    '-p',
    String(ep.port),
    ...(ep.key ? ['-i', expandHome(ep.key)] : []),
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'ConnectTimeout=10',
    `${ep.user ?? 'root'}@${ep.host}`,
    remote.map(shellQuote).join(' '),
  ];
}

/** Poll until `ssh <ep> true` works: the container's sshd starts only after the entrypoint is done. */
export function waitForSsh(ep: Endpoint, timeoutSec: number): boolean {
  const until = Date.now() + timeoutSec * 1000;
  while (Date.now() < until) {
    if (run(sshArgv(ep, ['true']), { capture: true }).code === 0) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000); // sleep 5 s
  }
  return false;
}
