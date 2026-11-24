#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { styleText } from 'node:util';
import { Command } from 'commander';
import { check } from './check.js';
import { ConfigError, loadConfig } from './config.js';
import { init } from './init.js';
import { CliError, ok, say, warn } from './run.js';
import { dockerTarget } from './targets/docker.js';
import { sh, type Target } from './targets/target.js';

/** The installed package root: holds the image sources (Dockerfile, entrypoint.sh, config/, scripts/). */
const packageDir = fileURLToPath(new URL('../../', import.meta.url));

function target(): Target {
  const cfg = loadConfig(process.cwd());
  if (cfg.target === 'docker') return dockerTarget(cfg, process.cwd(), packageDir);
  throw new CliError(`target: ${cfg.target} is not supported yet.`, 'Use target: docker for now.');
}

function doctor(t: Target): number {
  say('Checking the environment (doctor.sh)…');
  if (t.exec(sh('doctor.sh')).code === 0) return 0;
  warn('Some checks failed. Each ✘ line above says how to fix it.');
  return 1;
}

/** Wrap a command: print errors with a hint instead of a stack trace, and set the exit code. */
const action =
  <A extends unknown[]>(fn: (...args: A) => number | Promise<number>) =>
  async (...args: A) => {
    try {
      process.exitCode = await fn(...args);
    } catch (e) {
      if (e instanceof Error && e.name === 'ExitPromptError') {
        console.error('Cancelled.');
        process.exitCode = 130;
        return;
      }
      if (!(e instanceof ConfigError || e instanceof CliError)) throw e;
      console.error(`${styleText('red', '✘')} ${e.message}`);
      if (e instanceof CliError && e.hint) console.error(`  ${e.hint}`);
      process.exitCode = 1;
    }
  };

const example = (...lines: string[]) => `\nExample:\n${lines.map((l) => `  $ ${l}`).join('\n')}\n`;

const program = new Command('canopy').description(
  'Manage a canopy environment: Claude Code with your repos, vault, rules and channels.\n' +
    'Run commands in the folder that holds canopy.yaml and .env.',
);

program
  .command('init')
  .description('create canopy.yaml and .env by answering a few questions')
  .option('--check', 'validate the keys in .env against GitHub, Linear and Telegram')
  .addHelpText('after', example('canopy init', 'canopy init --check'))
  .action(
    action((opts: { check?: boolean }) =>
      opts.check ? check(process.cwd()) : init(process.cwd(), packageDir),
    ),
  );

program
  .command('up')
  .description('build and start the environment, then run doctor')
  .addHelpText('after', example('canopy up'))
  .action(
    action(() => {
      const t = target();
      say('Building and starting the container (docker compose up -d --build)…');
      if (t.up() !== 0)
        throw new CliError(
          'Starting the container failed.',
          'Is Docker running? Check the output above, then run `canopy up` again.',
        );
      say('Waiting for the container to finish setup…');
      if (!t.waitReady(240))
        throw new CliError(
          'The container did not finish setup.',
          'Run `canopy logs` to see the entrypoint error.',
        );
      ok('Container is up.');
      return doctor(t);
    }),
  );

program
  .command('down')
  .description('stop the environment (the /root volume with logins and clones is kept)')
  .addHelpText('after', example('canopy down'))
  .action(
    action(() => {
      say('Stopping the container…');
      return target().down();
    }),
  );

program
  .command('restart')
  .description('restart the agent and keep the conversation (--continue)')
  .addHelpText('after', example('canopy restart'))
  .action(
    action(() => {
      const code = target().exec(sh('fresh.sh --continue')).code;
      if (code === 0)
        say(
          'The agent restarts in ~25 s and continues the conversation. Watch: canopy logs --agent',
        );
      return code;
    }),
  );

program
  .command('fresh')
  .description('restart the agent with a clean context (new conversation)')
  .addHelpText('after', example('canopy fresh'))
  .action(
    action(() => {
      const code = target().exec(sh('fresh.sh')).code;
      if (code === 0)
        say('The agent restarts in ~25 s with a clean context. Watch: canopy logs --agent');
      return code;
    }),
  );

program
  .command('doctor')
  .description('check every part of the environment (✔/✘); exit code 1 if anything fails')
  .addHelpText('after', example('canopy doctor'))
  .action(action(() => doctor(target())));

program
  .command('logs')
  .description('follow container logs, or watch the agent session with --agent')
  .option('--agent', 'live, read-only view of the agent session (detach: Ctrl+B, then D)')
  .addHelpText('after', example('canopy logs', 'canopy logs --agent'))
  .action(
    action((opts: { agent?: boolean }) => {
      const t = target();
      if (!opts.agent) return t.logs();
      say('Read-only view of the agent. Detach: Ctrl+B, then D.');
      return t.interactive(['tmux', 'attach', '-r', '-t', 'claude']);
    }),
  );

program
  .command('ssh')
  .description('open a shell inside the container')
  .addHelpText('after', example('canopy ssh'))
  .action(action(() => target().interactive(['bash', '-l'])));

await program.parseAsync();
