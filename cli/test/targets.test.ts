import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseConfig } from '../src/config.js';
import {
  addRepoYaml,
  claudeVersionInDockerfile,
  removeRepoYaml,
  repoDirName,
  setYamlValue,
} from '../src/edit.js';
import { railwayVariables } from '../src/targets/railway.js';
import { shellQuote, sshArgv } from '../src/targets/remote.js';
import { vpsArgv } from '../src/targets/vps.js';

test('shellQuote leaves safe args alone and quotes the rest', () => {
  assert.equal(shellQuote('doctor.sh'), 'doctor.sh');
  assert.equal(shellQuote('canopy-x/compose.yml'), 'canopy-x/compose.yml');
  assert.equal(shellQuote('fresh.sh --continue'), "'fresh.sh --continue'");
  assert.equal(shellQuote("it's"), "'it'\\''s'");
});

test('sshArgv: port, expanded key, tty, one quoted remote command', () => {
  const argv = sshArgv(
    { host: 'h', port: 30029, key: '~/.ssh/id_me' },
    ['bash', '-lc', 'doctor.sh'],
    {
      tty: true,
    },
  );
  assert.deepEqual(argv.slice(0, 6), [
    'ssh',
    '-t',
    '-p',
    '30029',
    '-i',
    join(homedir(), '.ssh', 'id_me'),
  ]);
  assert.equal(argv.at(-2), 'root@h');
  assert.equal(argv.at(-1), 'bash -lc doctor.sh');
});

test('vps argv runs compose in ~/canopy-<name> on the host', () => {
  const cfg = parseConfig(
    'name: work\ntarget: ssh\nvps: { host: 1.2.3.4, user: deploy, port: 22 }',
  );
  const a = vpsArgv(cfg);
  assert.equal(a.up.at(-2), 'deploy@1.2.3.4');
  assert.equal(a.up.at(-1), 'docker compose -f canopy-work/compose.yml -p work up -d --build');
  assert.match(a.upload.at(-1) ?? '', /^sh -c 'mkdir -p canopy-work && tar -xzf - -C canopy-work/);
  assert.equal(a.exec(['bash', '-l'], true)[1], '-t');
  assert.match(
    a.exec(['bash', '-lc', 'fresh.sh --continue'], false).at(-1) ?? '',
    /exec -T canopy bash -lc 'fresh.sh --continue'$/,
  );
});

test('railway variables: .env + yaml + Claude Code build arg, empty values dropped', () => {
  const cfg = parseConfig(
    'target: railway\nssh: { host: p.rlwy.net, port: 1 }\nrepos: [me/app]\nclaudeCodeVersion: 2.1.0',
  );
  const vars = railwayVariables(cfg, { GH_TOKEN: 'x', LINEAR_API_KEY: '' });
  assert.deepEqual(Object.keys(vars).sort(), [
    'CLAUDE_CODE_VERSION',
    'GH_TOKEN',
    'MCP',
    'PROFILE',
    'REPOS',
  ]);
  assert.equal(vars.REPOS, 'me/app');
});

test('add/remove repo keeps comments; update sets claudeCodeVersion', () => {
  const text = '# my env\nname: canopy # main\nrepos:\n  - me/app # the app\n';
  const added = addRepoYaml(text, 'me/api', 'develop');
  assert.match(added, /# my env/);
  assert.match(added, /- me\/app # the app/);
  assert.deepEqual(parseConfig(added).repos.at(-1), { repo: 'me/api', branch: 'develop' });
  assert.throws(() => addRepoYaml(added, 'me/api'), /already in canopy.yaml/);
  assert.throws(() => addRepoYaml(text, 'nope'), /not owner\/name/);

  const removed = removeRepoYaml(added, 'me/app');
  assert.deepEqual(
    parseConfig(removed).repos.map((r) => r.repo),
    ['me/api'],
  );
  assert.throws(() => removeRepoYaml(removed, 'me/app'), /not in canopy.yaml/);

  assert.equal(parseConfig(addRepoYaml('name: x\n', 'me/new')).repos[0].repo, 'me/new');
  assert.equal(
    parseConfig(setYamlValue(text, 'claudeCodeVersion', '2.2.0')).claudeCodeVersion,
    '2.2.0',
  );
});

test('helpers: repo dir names and the Dockerfile Claude Code version', () => {
  assert.equal(repoDirName('me/app'), 'app');
  assert.equal(repoDirName('https://github.com/me/app.git'), 'app');
  assert.equal(claudeVersionInDockerfile('FROM x\nARG CLAUDE_CODE_VERSION=2.1.326\n'), '2.1.326');
});

test('mcp add/remove edits canopy.yaml and keeps comments; MCP is always sent', async () => {
  const { setMcpYaml, setEnvValue, isMcpName } = await import('../src/edit.js');
  const { configToEnv } = await import('../src/env.js');
  const text = '# env\nname: canopy # main\n';
  assert.equal(configToEnv(parseConfig(text)).MCP, 'none');

  const on = setMcpYaml(text, 'linear', true);
  assert.match(on, /name: canopy # main/);
  assert.deepEqual(parseConfig(setMcpYaml(on, 'figma', true)).mcp, ['linear', 'figma']);
  assert.equal(setMcpYaml(on, 'linear', true), on); // already on: unchanged
  assert.deepEqual(parseConfig(setMcpYaml(on, 'linear', false)).mcp, []);
  assert.equal(configToEnv(parseConfig(on)).MCP, 'linear');
  assert.ok(isMcpName('figma') && !isMcpName('slack') && !isMcpName('toString'));

  assert.equal(setEnvValue('A=1\nKEY=old\n', 'KEY', 'n$1w'), 'A=1\nKEY=n$1w\n');
  assert.equal(setEnvValue('A=1', 'KEY', 'v', 'where'), 'A=1\n\n# where\nKEY=v\n');
});
