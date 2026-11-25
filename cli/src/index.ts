#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { styleText } from 'node:util';
import { confirm, password } from '@inquirer/prompts';
import { Command } from 'commander';
import { check } from './check.js';
import { type Config, ConfigError, loadConfig } from './config.js';
import {
  addRepoYaml,
  claudeVersionInDockerfile,
  editConfigFile,
  editEnvFile,
  isMcpName,
  latestClaudeVersion,
  MCP_SERVERS,
  removeRepoYaml,
  repoDirName,
  setEnvValue,
  setMcpYaml,
  setYamlValue,
} from './edit.js';
import { parseEnvFile } from './env.js';
import { init } from './init.js';
import { login, loginFigma, openChat, SERVICES, type Service } from './login.js';
import { CliError, ok, say, warn } from './run.js';
import { makeTarget } from './targets/index.js';
import { sh, type Target } from './targets/target.js';

/** The installed package root: holds the image sources (Dockerfile, entrypoint.sh, config/, scripts/). */
const packageDir = fileURLToPath(new URL('../../', import.meta.url));
const cwd = process.cwd();

const target = (cfg: Config = loadConfig(cwd)): Target => makeTarget(cfg, cwd, packageDir);

function doctor(t: Target): number {
  say('Checking the environment (doctor.sh)…');
  if (t.exec(sh('doctor.sh')).code === 0) return 0;
  warn('Some checks failed. Each ✘ line above says how to fix it.');
  return 1;
}

/** Build/deploy, wait for the entrypoint, run doctor. Used by up, add-repo, remove-repo, update, mcp. */
async function upFlow(t: Target, runDoctor = true): Promise<number> {
  if ((await t.up()) !== 0) {
    throw new CliError(
      'Starting the environment failed.',
      'Check the output above, fix it, then run `canopy up` again.',
    );
  }
  say('Waiting for the container to finish setup…');
  if (!t.waitReady(600)) {
    throw new CliError('The container did not finish setup.', 'Run `canopy logs` to see why.');
  }
  ok('Container is up.');
  return runDoctor ? doctor(t) : 0;
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
const version = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')).version;

const program = new Command('canopy')
  .version(version)
  .description(
    'Manage a canopy environment: Claude Code with your repos, vault, rules and channels.\n' +
      'Run commands in the folder that holds canopy.yaml and .env.',
  );

program
  .command('init')
  .description('create canopy.yaml and .env by answering a few questions')
  .option('--check', 'validate the keys in .env against GitHub, Linear and Telegram')
  .addHelpText('after', example('canopy init', 'canopy init --check'))
  .action(action((opts: { check?: boolean }) => (opts.check ? check(cwd) : init(cwd, packageDir))));

program
  .command('up')
  .description('build/deploy and start the environment, then run doctor')
  .addHelpText('after', example('canopy up'))
  .action(action(() => upFlow(target())));

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
        say('The agent restarts in ~25 s and keeps the conversation. Watch: canopy logs --agent');
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

program
  .command('login')
  .argument('[service]', `one of: ${SERVICES.join(', ')} (default: all, skipping what is done)`)
  .description(
    'log in to Claude, pair Telegram and authorize Figma without typing in the container',
  )
  .addHelpText('after', example('canopy login', 'canopy login telegram', 'canopy login status'))
  .action(
    action((service?: string) => {
      if (service && !SERVICES.includes(service as Service)) {
        throw new CliError(`Unknown service "${service}".`, `Use one of: ${SERVICES.join(', ')}.`);
      }
      const cfg = loadConfig(cwd);
      return login(target(cfg), cfg, service as Service | undefined);
    }),
  );

program
  .command('add-repo')
  .argument('<repo>', 'owner/name or an https URL')
  .option('--branch <branch>', 'branch to check out after cloning')
  .description('add a project: update canopy.yaml and clone it, no image rebuild')
  .addHelpText(
    'after',
    example('canopy add-repo you/api', 'canopy add-repo you/web --branch develop'),
  )
  .action(
    action(async (repo: string, opts: { branch?: string }) => {
      editConfigFile(cwd, (text) => addRepoYaml(text, repo, opts.branch));
      ok(`Added ${repo} to canopy.yaml.`);
      warn(`Make sure GH_TOKEN can access ${repo}: GitHub -> token settings -> Repository access.`);
      say('Applying: the container restarts and clones it; the agent keeps its conversation.');
      return upFlow(target());
    }),
  );

program
  .command('remove-repo')
  .argument('<repo>', 'as written in canopy.yaml')
  .description('remove a project from canopy.yaml; deleting its files in the container is optional')
  .addHelpText('after', example('canopy remove-repo you/api'))
  .action(
    action(async (repo: string) => {
      editConfigFile(cwd, (text) => removeRepoYaml(text, repo));
      ok(`Removed ${repo} from canopy.yaml.`);
      const t = target();
      const code = await upFlow(t);
      const dir = `/root/projects/${repoDirName(repo)}`;
      const del = await confirm({
        message: `Also delete ${dir} in the container? Unpushed work there is lost.`,
        default: false,
      });
      if (del) t.exec(['rm', '-rf', dir]);
      return code;
    }),
  );

program
  .command('update')
  .option('--claude [version]', 'move Claude Code to a version (default: latest)')
  .description('update Claude Code in the image, or show how to update canopy itself')
  .addHelpText('after', example('canopy update --claude', 'canopy update --claude 2.1.326'))
  .action(
    action(async (opts: { claude?: string | true }) => {
      if (opts.claude === undefined) {
        say(`canopy ${version}. To update it: npm i -g canopy-cli@latest`);
        say(
          '(from a clone: git pull && npm run build), then run `canopy up` to rebuild the image.',
        );
        say('To move Claude Code to another version: canopy update --claude [version]');
        return 0;
      }
      const cfg = loadConfig(cwd);
      const current =
        cfg.claudeCodeVersion ??
        claudeVersionInDockerfile(readFileSync(join(packageDir, 'Dockerfile'), 'utf8')) ??
        'unknown';
      const to = opts.claude === true ? await latestClaudeVersion() : opts.claude;
      if (!/^\d+\.\d+\.\d+$/.test(to)) throw new CliError(`"${to}" is not a version like 2.1.326.`);
      if (to === current) {
        ok(`Claude Code is already ${to}.`);
        return 0;
      }
      say(`Claude Code ${current} -> ${to}: the image is rebuilt and the container restarted.`);
      say('Logins, clones and the conversation are kept (they live in the volume).');
      if (!(await confirm({ message: 'Update now?', default: true }))) return 0;
      editConfigFile(cwd, (text) => setYamlValue(text, 'claudeCodeVersion', to));
      const rollback = () =>
        warn(`Something failed after the update. Roll back: canopy update --claude ${current}`);
      try {
        const code = await upFlow(target());
        if (code !== 0) rollback();
        return code;
      } catch (e) {
        rollback();
        throw e;
      }
    }),
  );

program
  .command('chat')
  .alias('attach')
  .description("open the agent's live Claude session and type in it (leave: Ctrl+B, then D)")
  .addHelpText('after', example('canopy chat'))
  .action(action(() => openChat(target())));

const mcp = program
  .command('mcp')
  .description(`turn MCP servers on or off: ${Object.keys(MCP_SERVERS).join(', ')}`);

const mcpName = (name: string) => {
  if (!isMcpName(name)) {
    throw new CliError(
      `Unknown MCP server "${name}".`,
      `Use one of: ${Object.keys(MCP_SERVERS).join(', ')}.`,
    );
  }
  return name;
};

mcp
  .command('list')
  .description('show which MCP servers are on')
  .action(
    action(() => {
      const on = loadConfig(cwd).mcp;
      for (const name of Object.keys(MCP_SERVERS)) {
        console.log(on.includes(name) ? `✔ ${name}` : `– ${name} (off: canopy mcp add ${name})`);
      }
      return 0;
    }),
  );

mcp
  .command('add')
  .argument('<name>', Object.keys(MCP_SERVERS).join(' | '))
  .description('turn an MCP server on: save its key, apply, log in if it needs to')
  .addHelpText('after', example('canopy mcp add linear', 'canopy mcp add figma'))
  .action(
    action(async (raw: string) => {
      const name = mcpName(raw);
      const spec = MCP_SERVERS[name];
      if ('secret' in spec && !parseEnvFile(readEnv())[spec.secret]) {
        const key = await password({
          message: `${spec.secret} (${spec.where})`,
          mask: '*',
          validate: (v) => !!v.trim() || 'Paste the key',
        });
        editEnvFile(cwd, (text) => setEnvValue(text, spec.secret, key.trim(), spec.where));
        ok(`Saved ${spec.secret} to .env.`);
      }
      editConfigFile(cwd, (text) => setMcpYaml(text, name, true));
      ok(`${name} is on in canopy.yaml. Applying it (the agent keeps its conversation)…`);
      const cfg = loadConfig(cwd);
      const t = target(cfg);
      if (name !== 'figma') return upFlow(t);
      // Figma needs a browser login before doctor can show it as connected.
      await upFlow(t, false);
      return (await loginFigma(t, cfg)) ? doctor(t) : 1;
    }),
  );

mcp
  .command('remove')
  .argument('<name>', Object.keys(MCP_SERVERS).join(' | '))
  .description('turn an MCP server off and apply')
  .addHelpText('after', example('canopy mcp remove figma'))
  .action(
    action(async (raw: string) => {
      const name = mcpName(raw);
      editConfigFile(cwd, (text) => setMcpYaml(text, name, false));
      ok(`${name} is off in canopy.yaml. Applying it…`);
      const spec = MCP_SERVERS[name];
      if ('secret' in spec)
        say(`${spec.secret} stays in .env; delete that line if you no longer need it.`);
      return upFlow(target());
    }),
  );

function readEnv(): string {
  const file = join(cwd, '.env');
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

await program.parseAsync();
