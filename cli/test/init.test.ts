import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseConfig } from '../src/config.js';
import { parseEnvFile } from '../src/env.js';
import { githubSlug } from '../src/github.js';
import { buildEnv, buildYaml, ensureGitignore, neededSecrets, parseHead } from '../src/init.js';

test('buildYaml round-trips through parseConfig', () => {
  const cfg = parseConfig(`
target: railway
vault: me/vault
repos: [me/app, { repo: me/api, branch: develop }]
git: { email: me@example.com }
mcp: [linear]
ssh: { host: proxy.example.net, port: 30029, key: ~/.ssh/id_me }
`);
  assert.deepEqual(parseConfig(buildYaml(cfg)), cfg);
  assert.match(buildYaml(cfg), /^# canopy environment\. No secrets here/);
});

test('only the secrets the config needs', () => {
  assert.deepEqual(neededSecrets(parseConfig('channel: none')), ['AUTHORIZED_KEYS', 'GH_TOKEN']);
  assert.deepEqual(neededSecrets(parseConfig('mcp: [linear, figma]')), [
    'AUTHORIZED_KEYS',
    'GH_TOKEN',
    'LINEAR_API_KEY',
    'TELEGRAM_BOT_TOKEN',
  ]);
});

test('buildEnv keeps existing values, comments each key, keeps unknown keys', () => {
  const out = buildEnv(['GH_TOKEN', 'TELEGRAM_BOT_TOKEN'], { GH_TOKEN: 'abc', TZ: 'UTC' });
  const env = parseEnvFile(out);
  assert.deepEqual(env, { GH_TOKEN: 'abc', TELEGRAM_BOT_TOKEN: '', TZ: 'UTC' });
  assert.match(out, /# GitHub fine-grained token: https:\/\/github\.com\/settings/);
  assert.match(out, /# Other\nTZ=UTC/);
});

test('parseEnvFile handles comments, quotes and CRLF', () => {
  assert.deepEqual(parseEnvFile('# c\r\nA=1\r\nB="two words"\r\n\r\nC=\n'), {
    A: '1',
    B: 'two words',
    C: '',
  });
});

test('ensureGitignore adds only what is missing', () => {
  assert.equal(ensureGitignore(''), '.env\n.canopy/\n*.local.*\n');
  assert.equal(
    ensureGitignore('node_modules\n.env\n'),
    'node_modules\n.env\n.canopy/\n*.local.*\n',
  );
  const full = '.env\n.canopy/\n*.local.*\n';
  assert.equal(ensureGitignore(full), full);
});

test('default branch from ls-remote and GitHub slugs', () => {
  assert.equal(parseHead('ref: refs/heads/develop\tHEAD\nabc123\tHEAD\n'), 'develop');
  assert.equal(parseHead(''), undefined);
  assert.equal(githubSlug('me/app'), 'me/app');
  assert.equal(githubSlug('https://github.com/me/app.git'), 'me/app');
  assert.equal(githubSlug('https://gitlab.com/me/app'), undefined);
});

test('telegram pairing code format', async () => {
  const { isPairingCode } = await import('../src/login.js');
  assert.ok(isPairingCode('a1b2c3'));
  assert.ok(isPairingCode(' A1B2C3 '));
  assert.ok(!isPairingCode('a1b2c'));
  assert.ok(!isPairingCode('a1b2c3; rm -rf /'));
  assert.ok(!isPairingCode('zzzzzz'));
});

test('buildYaml hints at canopy mcp add when no MCP server is on', () => {
  const plain = buildYaml(parseConfig('repos: [me/app]'));
  assert.match(plain, /# mcp: \[linear, figma\]\s+\(turn on with: canopy mcp add linear\)/);
  assert.deepEqual(parseConfig(plain).mcp, []);
  assert.doesNotMatch(buildYaml(parseConfig('mcp: [figma]')), /turn on with/);
});
