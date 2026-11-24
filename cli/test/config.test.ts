import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse } from 'yaml';
import { parseConfig } from '../src/config.js';
import { configToEnv } from '../src/env.js';
import { composeFile, dockerArgv } from '../src/targets/docker.js';

test('defaults for a minimal config', () => {
  const cfg = parseConfig('repos: [me/app]');
  assert.equal(cfg.name, 'canopy');
  assert.equal(cfg.target, 'docker');
  assert.equal(cfg.profile, 'personal');
  assert.deepEqual(cfg.repos, [{ repo: 'me/app', branch: undefined }]);
});

test('validation errors name the field', () => {
  assert.throws(() => parseConfig('target: aws'), /"target" must be one of: docker, ssh, railway/);
  assert.throws(() => parseConfig('repos: [not-a-repo]'), /"repos\[0\]" must be owner\/name/);
  assert.throws(() => parseConfig('name: My Env'), /"name" may contain only/);
  assert.throws(() => parseConfig('target: ssh'), /"vps" is required/);
  assert.throws(() => parseConfig('mcp: figma'), /"mcp" must be a list/);
});

test('yaml maps to container env; branches become repo#branch', () => {
  const env = configToEnv(
    parseConfig(`
vault: me/vault
repos:
  - me/app
  - { repo: me/api, branch: develop }
git: { name: Me, email: me@example.com }
mcp: [linear, figma]
`),
  );
  assert.deepEqual(env, {
    PROFILE: 'personal',
    REPOS: 'me/app,me/api#develop',
    VAULT_REPO: 'me/vault',
    GIT_NAME: 'Me',
    GIT_EMAIL: 'me@example.com',
    MCP: 'linear,figma',
  });
});

test('docker argv and generated compose', () => {
  const cfg = parseConfig(
    'name: test-env\nssh: { host: localhost, port: 2299 }\nclaudeCodeVersion: 2.1.0',
  );
  const a = dockerArgv(cfg, '/p');
  assert.deepEqual(a.up.slice(-5), ['-p', 'test-env', 'up', '-d', '--build']);
  assert.deepEqual(a.exec(['doctor.sh'], false).slice(-4), ['exec', '-T', 'canopy', 'doctor.sh']);
  assert.deepEqual(a.exec(['bash', '-l'], true).slice(-4), ['-it', 'canopy', 'bash', '-l']);
  const svc = parse(composeFile(cfg, { context: '/pkg', envFiles: ['/p/.env'] })).services.canopy;
  assert.deepEqual(svc.ports, ['2299:22']);
  assert.equal(svc.build.args.CLAUDE_CODE_VERSION, '2.1.0');
  assert.equal(svc.image, 'test-env');
});
