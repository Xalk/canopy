import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.js';
import { parseEnvFile } from './env.js';
import { githubSlug } from './github.js';
import { neededSecrets } from './init.js';
import { bad, CliError, ok, say, warn } from './run.js';

type Body = {
  login?: string;
  ok?: boolean;
  result?: { username?: string };
  data?: { viewer?: { name?: string } };
};

/** One HTTP call. Errors are reported without details: URLs and headers may carry tokens. */
async function request(url: string, init: RequestInit = {}): Promise<{ ok: boolean; body?: Body }> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'User-Agent': 'canopy-cli', ...init.headers },
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => undefined)) as Body | undefined;
    return { ok: res.ok, body };
  } catch {
    return { ok: false };
  }
}

/** `canopy init --check`: validate the keys in .env against the real services, no container needed. */
export async function check(dir: string): Promise<number> {
  const cfg = loadConfig(dir);
  const envPath = join(dir, '.env');
  if (!existsSync(envPath))
    throw new CliError('.env not found.', 'Run `canopy init` to create it.');
  const env = parseEnvFile(readFileSync(envPath, 'utf8'));

  let failed = 0;
  const result = (good: boolean, label: string, hint: string) => {
    if (good) ok(label);
    else {
      bad(label, hint);
      failed++;
    }
  };
  say('Checking the keys in .env (values are never printed)…');

  for (const k of neededSecrets(cfg)) {
    if (!env[k])
      result(false, `${k} is set`, 'fill it in .env; the comment above it says where to get it');
  }

  if (env.AUTHORIZED_KEYS) {
    result(
      /^(ssh-|ecdsa-|sk-)/.test(env.AUTHORIZED_KEYS),
      'AUTHORIZED_KEYS looks like a public key',
      'paste the contents of a .pub file, not the private key',
    );
  }

  if (env.GH_TOKEN) {
    const auth = { Authorization: `Bearer ${env.GH_TOKEN}` };
    const user = await request('https://api.github.com/user', { headers: auth });
    result(
      user.ok,
      `GH_TOKEN is valid${user.body?.login ? ` (${user.body.login})` : ''}`,
      'invalid or expired token',
    );
    if (user.ok) {
      for (const repo of [...cfg.repos.map((r) => r.repo), ...(cfg.vault ? [cfg.vault] : [])]) {
        const slug = githubSlug(repo);
        if (!slug) {
          warn(`${repo}: not on github.com, skipped`);
          continue;
        }
        const r = await request(`https://api.github.com/repos/${slug}`, { headers: auth });
        result(r.ok, `GH_TOKEN can see ${slug}`, "add it to the token's repository access");
      }
    }
  }

  if (env.LINEAR_API_KEY) {
    const r = await request('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { Authorization: env.LINEAR_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ viewer { name } }' }),
    });
    const name = r.body?.data?.viewer?.name;
    result(
      r.ok && !!name,
      `LINEAR_API_KEY is valid${name ? ` (${name})` : ''}`,
      'create a new personal API key',
    );
  }

  if (env.TELEGRAM_BOT_TOKEN) {
    const r = await request(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`);
    const bot = r.body?.result?.username;
    result(
      r.ok && !!r.body?.ok,
      `TELEGRAM_BOT_TOKEN is valid${bot ? ` (@${bot})` : ''}`,
      'copy the token from @BotFather again',
    );
  }

  console.log();
  if (failed) bad(`${failed} check(s) failed.`);
  else ok('All keys work. Next: canopy up');
  return failed ? 1 : 0;
}
