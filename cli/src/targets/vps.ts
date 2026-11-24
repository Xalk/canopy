import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { confirm } from '@inquirer/prompts';
import type { Config, Endpoint } from '../config.js';
import { configToEnv, formatEnvFile } from '../env.js';
import { CliError, run, runBytes, say, sleep } from '../run.js';
import { composeFile } from './docker.js';
import { sshArgv } from './remote.js';
import type { Target } from './target.js';

/** What the image is built from; uploaded to the server next to the compose file. */
export const IMAGE_FILES = ['Dockerfile', 'entrypoint.sh', 'config', 'scripts', '.dockerignore'];

/** argv builders for target: ssh (docker on your VPS). Everything runs in ~/canopy-<name>. */
export function vpsArgv(cfg: Config) {
  const vps = cfg.vps as Endpoint;
  const dir = `canopy-${cfg.name}`;
  const compose = (...args: string[]) => [
    'docker',
    'compose',
    '-f',
    `${dir}/compose.yml`,
    '-p',
    cfg.name,
    ...args,
  ];
  return {
    dir,
    upload: sshArgv(vps, [
      'sh',
      '-c',
      `mkdir -p ${dir} && tar -xzf - -C ${dir} && (chmod 600 ${dir}/.env 2>/dev/null || true)`,
    ]),
    hasEnv: sshArgv(vps, ['test', '-f', `${dir}/.env`]),
    up: sshArgv(vps, compose('up', '-d', '--build')),
    down: sshArgv(vps, compose('down')),
    logs: sshArgv(vps, compose('logs', '-f'), { tty: true }),
    logsOnce: sshArgv(vps, compose('logs', '--no-log-prefix')),
    exec: (argv: string[], tty: boolean) =>
      sshArgv(vps, compose('exec', tty ? '-it' : '-T', 'canopy', ...argv), { tty }),
  };
}

export function vpsTarget(cfg: Config, projectDir: string, packageDir: string): Target {
  const a = vpsArgv(cfg);
  const host = (cfg.vps as Endpoint).host;

  return {
    async up() {
      // Paths in the uploaded compose file are relative to ~/canopy-<name> on the server.
      const stage = join(projectDir, '.canopy', 'remote');
      mkdirSync(stage, { recursive: true });
      writeFileSync(
        join(stage, 'compose.yml'),
        composeFile(cfg, { context: '.', envFiles: ['.env', 'config.env'] }),
      );
      writeFileSync(join(stage, 'config.env'), formatEnvFile(configToEnv(cfg)));

      const remoteHasEnv = run(a.hasEnv, { capture: true }).code === 0;
      const sendEnv = await confirm({
        message: remoteHasEnv
          ? `Replace .env on ${host} with your local .env (secrets)?`
          : `Upload your local .env (secrets) to ${host}:~/${a.dir}/.env (chmod 600)?`,
        default: !remoteHasEnv,
      });
      if (!sendEnv && !remoteHasEnv) {
        throw new CliError(
          `${host} has no .env, so the container can't start.`,
          'Run `canopy up` again and allow the upload, or copy .env there yourself.',
        );
      }
      if (sendEnv && !existsSync(join(projectDir, '.env'))) {
        throw new CliError('No local .env to upload.', 'Run `canopy init` first.');
      }

      say(`Uploading image sources and config to ${host}:~/${a.dir}…`);
      const tar = runBytes([
        'tar',
        '-czf',
        '-',
        '-C',
        packageDir,
        ...IMAGE_FILES,
        '-C',
        stage,
        'compose.yml',
        'config.env',
        ...(sendEnv ? ['-C', projectDir, '.env'] : []),
      ]);
      if (run(a.upload, { input: tar, capture: true }).code !== 0) {
        throw new CliError('Upload failed.', `Check that this works: ssh ${host}`);
      }
      say(`Building and starting on ${host} (docker compose up -d --build)…`);
      return run(a.up).code;
    },
    down: () => run(a.down).code,
    logs: () => run(a.logs).code,
    exec: (argv, opts) => run(a.exec(argv, false), { capture: opts?.capture }),
    interactive: (argv) => run(a.exec(argv, true)).code,
    waitReady(timeoutSec) {
      const until = Date.now() + timeoutSec * 1000;
      while (Date.now() < until) {
        const out = run(a.logsOnce, { capture: true }).stdout;
        if (out.includes('[canopy] ready')) return true;
        if (out.includes('[canopy] ERROR')) return false;
        sleep(5000);
      }
      return false;
    },
  };
}
