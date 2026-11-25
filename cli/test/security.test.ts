import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse } from 'yaml';
import { parseConfig } from '../src/config.js';
import { mergeAuthorizedKeys } from '../src/init.js';
import { composeFile } from '../src/targets/docker.js';

test('values starting with "-" are rejected (ssh/gh/git option injection)', () => {
  assert.throws(
    () => parseConfig('target: ssh\nvps: { host: "-oProxyCommand=calc" }'),
    /"vps.host" must be a hostname/,
  );
  assert.throws(() => parseConfig('ssh: { host: h, user: "-x" }'), /"ssh.user" is not a valid/);
  assert.throws(() => parseConfig('repos: ["-x/y"]'), /must be owner\/name/);
  assert.throws(() => parseConfig('repos: [{ repo: me/app, branch: "--orphan" }]'), /branch/);
  assert.equal(
    parseConfig('repos: [{ repo: me/app, branch: feature/x-1 }]').repos[0].branch,
    'feature/x-1',
  );
});

test('ssh endpoint defaults to the container port 2222, vps to 22', () => {
  assert.equal(parseConfig('ssh: { host: localhost }').ssh?.port, 2222);
  assert.equal(parseConfig('target: ssh\nvps: { host: 1.2.3.4 }').vps?.port, 22);
});

test('on a VPS the container sshd is bound to localhost only', () => {
  const ports = (yaml: string) =>
    parse(composeFile(parseConfig(yaml), { context: '.', envFiles: [] })).services.canopy.ports;
  assert.deepEqual(ports('target: ssh\nvps: { host: 1.2.3.4 }'), ['127.0.0.1:2222:22']);
  assert.deepEqual(ports('target: docker'), ['2222:22']);
});

test('init keeps existing authorized keys and adds a new one once', () => {
  const a = 'ssh-ed25519 AAAAone laptop';
  const b = 'ssh-ed25519 AAAAtwo phone';
  assert.equal(mergeAuthorizedKeys(undefined, a), a);
  assert.equal(mergeAuthorizedKeys(a, a), a);
  assert.equal(mergeAuthorizedKeys(a, b), `${a};${b}`);
  assert.equal(mergeAuthorizedKeys(`${a};${b}`, a), `${a};${b}`);
});

test('optional resource limits reach the compose file', () => {
  const svc = (yaml: string) =>
    parse(composeFile(parseConfig(yaml), { context: '.', envFiles: [] })).services.canopy;
  const limited = svc('limits: { memory: 4g, cpus: 1.5 }');
  assert.equal(limited.mem_limit, '4g');
  assert.equal(limited.cpus, 1.5);
  const plain = svc('name: x');
  assert.equal(plain.mem_limit, undefined);
  assert.equal(plain.cpus, undefined);
  assert.throws(() => parseConfig('limits: { memory: 4 gigs }'), /"limits.memory" must look like/);
  assert.throws(() => parseConfig('limits: { cpus: 0 }'), /"limits.cpus" must be a positive/);
});
