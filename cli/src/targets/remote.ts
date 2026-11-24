import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Endpoint } from '../config.js';

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
