import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify } from 'yaml';
import type { Config } from '../config.js';
import { configToEnv, formatEnvFile } from '../env.js';
import { run, say, sleep } from '../run.js';
import type { Target } from './target.js';

/**
 * The compose file canopy generates. `context` holds the image sources (the installed package
 * locally, the upload dir on a VPS); `envFiles` are .env and the generated config.env.
 */
export function composeFile(cfg: Config, paths: { context: string; envFiles: string[] }): string {
  const port = cfg.ssh?.port ?? 2222;
  return stringify({
    services: {
      canopy: {
        build: {
          context: paths.context,
          ...(cfg.claudeCodeVersion
            ? { args: { CLAUDE_CODE_VERSION: cfg.claudeCodeVersion } }
            : {}),
        },
        image: cfg.name,
        hostname: cfg.name,
        // Secrets from .env stay out of this file; they still show up in `docker inspect`.
        env_file: paths.envFiles,
        // On a VPS the CLI goes through the host sshd, so keep this one off the internet:
        // Docker-published ports bypass host firewalls such as UFW.
        ports: [cfg.target === 'ssh' ? `127.0.0.1:${port}:22` : `${port}:22`],
        volumes: ['home:/root'],
        restart: 'unless-stopped',
        // More CPUs than the host has makes Docker refuse to start the container.
        ...(cfg.limits?.memory ? { mem_limit: cfg.limits.memory } : {}),
        ...(cfg.limits?.cpus ? { cpus: cfg.limits.cpus } : {}),
      },
    },
    volumes: { home: {} },
  });
}

/** argv builders, kept pure so they can be tested without Docker. */
export function dockerArgv(cfg: Config, projectDir: string) {
  const base = [
    'docker',
    'compose',
    '-f',
    join(projectDir, '.canopy', 'compose.yml'),
    '-p',
    cfg.name,
  ];
  return {
    up: [...base, 'up', '-d', '--build'],
    down: [...base, 'down'],
    logs: [...base, 'logs', '-f'],
    logsOnce: [...base, 'logs', '--no-log-prefix'],
    exec: (argv: string[], tty: boolean) => [
      ...base,
      'exec',
      tty ? '-it' : '-T',
      'canopy',
      ...argv,
    ],
  };
}

export function dockerTarget(cfg: Config, projectDir: string, packageDir: string): Target {
  // Generated files are rewritten before every command, so they always match canopy.yaml.
  mkdirSync(join(projectDir, '.canopy'), { recursive: true });
  writeFileSync(
    join(projectDir, '.canopy', 'compose.yml'),
    composeFile(cfg, {
      context: resolve(packageDir),
      envFiles: [resolve(projectDir, '.env'), resolve(projectDir, '.canopy', 'config.env')],
    }),
  );
  writeFileSync(join(projectDir, '.canopy', 'config.env'), formatEnvFile(configToEnv(cfg)));
  const a = dockerArgv(cfg, projectDir);

  return {
    up() {
      say('Building and starting the container (docker compose up -d --build)…');
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
        sleep(3000);
      }
      return false;
    },
  };
}
