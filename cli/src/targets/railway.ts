import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { confirm } from '@inquirer/prompts';
import type { Config, Endpoint } from '../config.js';
import { configToEnv, parseEnvFile } from '../env.js';
import { CliError, ok, run, say, sleep, warn } from '../run.js';
import { sshArgv } from './remote.js';
import type { Target } from './target.js';

/** Variables for the Railway service: secrets from .env + canopy.yaml values (+ the Claude Code build arg). */
export function railwayVariables(
  cfg: Config,
  dotenv: Record<string, string>,
): Record<string, string> {
  const all: Record<string, string> = {
    ...dotenv,
    ...configToEnv(cfg),
    ...(cfg.claudeCodeVersion ? { CLAUDE_CODE_VERSION: cfg.claudeCodeVersion } : {}),
  };
  return Object.fromEntries(Object.entries(all).filter(([, v]) => v !== ''));
}

/**
 * target: railway. Deploys the image sources with the Railway CLI from the folder linked to your
 * service; exec/ssh go through the TCP proxy (canopy.yaml `ssh:`). The TCP proxy itself can only be
 * created in the dashboard.
 */
export function railwayTarget(cfg: Config, projectDir: string, packageDir: string): Target {
  const ssh = cfg.ssh as Endpoint;
  const rw = (args: string[], opts: { capture?: boolean; input?: string } = {}) =>
    run(['railway', ...args], { cwd: projectDir, ...opts });
  // When the container started: the entrypoint rewrites /run/canopy/.env on every start.
  // The old deployment keeps answering SSH until the new one is up, so readiness = a new start time.
  const startedAt = () => {
    const r = run(sshArgv(ssh, ['stat', '-c', '%Y', '/run/canopy/.env']), { capture: true });
    return r.code === 0 ? r.stdout.trim() : undefined;
  };
  let before: string | undefined;

  return {
    async up() {
      before = startedAt();
      if (rw(['status', '--json'], { capture: true }).code !== 0) {
        say('Link this folder to your Railway project and service (once).');
        if (rw(['link']).code !== 0)
          throw new CliError('railway link failed.', 'Run `railway login` first.');
      }

      const envPath = join(projectDir, '.env');
      if (!existsSync(envPath)) throw new CliError('.env not found.', 'Run `canopy init` first.');
      const vars = railwayVariables(cfg, parseEnvFile(readFileSync(envPath, 'utf8')));
      say(`Variables for the service: ${Object.keys(vars).join(', ')}`);
      const write = await confirm({
        message: 'Write them to the linked Railway service? Values are sent, never printed.',
        default: true,
      });
      if (!write) throw new CliError('Cancelled: nothing was changed on Railway.');
      for (const [k, v] of Object.entries(vars)) {
        // --stdin keeps secrets out of the process list.
        const r = rw(['variable', 'set', k, '--stdin', '--skip-deploys'], {
          input: v,
          capture: true,
        });
        if (r.code !== 0) throw new CliError(`Setting ${k} failed.`, 'Check `railway status`.');
      }
      ok('Variables set.');

      if (!rw(['volume', 'list', '--json'], { capture: true }).stdout.includes('"/root"')) {
        const add = await confirm({
          message: 'No volume on /root: logins and clones would be lost on every deploy. Add one?',
          default: true,
        });
        if (add && rw(['volume', 'add', '--mount-path', '/root']).code !== 0) {
          warn(
            'Adding the volume failed. Add it in the dashboard: service -> Volumes -> mount /root.',
          );
        }
      }

      say('Deploying the image sources (railway up)…');
      const code = rw(['up', packageDir, '--path-as-root', '--detach', '-m', 'canopy up']).code;
      if (code === 0) {
        say(`SSH goes through the TCP proxy at ${ssh.host}:${ssh.port} (canopy.yaml \`ssh:\`).`);
        say(
          'No proxy yet? Dashboard -> service -> Settings -> Networking -> TCP Proxy -> port 22.',
        );
      }
      return code;
    },
    async down() {
      const sure = await confirm({
        message: 'Remove the latest Railway deployment? The volume stays.',
      });
      return sure ? rw(['down', '-y']).code : 0;
    },
    logs: () => rw(['logs']).code,
    exec: (argv, opts) => run(sshArgv(ssh, argv), { capture: opts?.capture }),
    interactive: (argv) => run(sshArgv(ssh, argv, { tty: true })).code,
    waitReady(timeoutSec) {
      const until = Date.now() + timeoutSec * 1000;
      while (Date.now() < until) {
        const now = startedAt();
        if (now && now !== before) return true;
        sleep(5000);
      }
      return false;
    },
  };
}
