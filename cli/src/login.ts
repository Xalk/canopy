import { confirm, input } from '@inquirer/prompts';
import type { Config } from './config.js';
import { bad, CliError, ok, say } from './run.js';
import { sh, type Target } from './targets/target.js';

export const SERVICES = ['claude', 'telegram', 'figma', 'status'] as const;
export type Service = (typeof SERVICES)[number];

/** Pairing codes from the Telegram plugin are 6 hex characters. */
export const isPairingCode = (v: string) => /^[a-f0-9]{6}$/i.test(v.trim());

const quiet = (t: Target, argv: string[]) => t.exec(argv, { capture: true });
const done = (msg: string) => {
  ok(msg);
  return true;
};
const skipped = (msg: string) => {
  say(msg);
  return true;
};
const claudeLoggedIn = (t: Target) => quiet(t, ['claude', 'auth', 'status']).code === 0;
const telegramPaired = (t: Target) =>
  quiet(t, [
    'jq',
    '-e',
    '(.allowFrom | length > 0) and .dmPolicy == "allowlist"',
    '/root/.claude/channels/telegram/access.json',
  ]).code === 0;
const mcpConnected = (t: Target, name: string) =>
  quiet(t, sh(`claude mcp list 2>/dev/null | grep -q '^${name}:.*Connected'`)).code === 0;

/** Start the agent's tmux session if it isn't running (e.g. Claude exited). */
export function ensureSession(t: Target): void {
  if (quiet(t, ['tmux', 'has-session', '-t', 'claude']).code !== 0) quiet(t, sh('start.sh'));
}

/** Open the agent's live Claude session; the user can type in it. */
export function openChat(t: Target): number {
  ensureSession(t);
  say("Opening the agent's Claude session. You can type here.");
  say('Leave without stopping it: Ctrl+B, then D. Ctrl+C interrupts Claude.');
  return t.interactive(['tmux', 'attach', '-t', 'claude']);
}

async function loginClaude(t: Target): Promise<boolean> {
  if (claudeLoggedIn(t)) return done('Claude: logged in');
  ensureSession(t);
  say('Claude: you will see the agent session. Pick a theme, log in (open the link,');
  say('paste the code back), and trust the folder.');
  say('When the input box appears, detach: press Ctrl+B, release, then press D.');
  await confirm({ message: 'Open the agent session now?', default: true });
  t.interactive(['tmux', 'attach', '-t', 'claude']);
  if (!claudeLoggedIn(t)) {
    throw new CliError('Claude is still not logged in.', 'Run `canopy login claude` again.');
  }
  ok('Claude: logged in');
  return true;
}

async function loginTelegram(t: Target, cfg: Config): Promise<boolean> {
  if (cfg.channel !== 'telegram') return skipped('Telegram: channel is "none", skipped');
  if (telegramPaired(t)) return done('Telegram: paired, allowlist on');
  if (!claudeLoggedIn(t)) {
    throw new CliError(
      'Telegram needs a logged-in agent: the bot runs inside its session.',
      'Run `canopy login claude` first.',
    );
  }
  say('Telegram: send any message to your bot. It replies with a 6-character pairing code.');
  for (;;) {
    const code = await input({
      message: 'Pairing code from the bot',
      validate: (v) => isPairingCode(v) || '6 characters: digits and letters a-f',
    });
    // Done by a script, not the agent: no tokens spent, no permission prompt.
    const r = quiet(t, ['telegram-pair.sh', code.trim()]);
    if (r.code === 0) {
      ok('Telegram: paired, allowlist on. The bot will reply "you\'re in".');
      return true;
    }
    bad(r.stdout.trim() || 'Pairing failed.');
    if (!(await confirm({ message: 'Try another code?', default: true }))) return false;
  }
}

export async function loginFigma(t: Target, cfg: Config): Promise<boolean> {
  if (!cfg.mcp.includes('figma'))
    return skipped('Figma: not enabled (canopy mcp add figma), skipped');
  if (mcpConnected(t, 'figma')) return done('Figma: connected');
  if (quiet(t, ['claude', 'mcp', 'get', 'figma']).code !== 0) {
    throw new CliError(
      'The figma MCP server is not added in the container yet.',
      'Run `canopy up` (it adds the servers in `mcp:`), then `canopy login figma`.',
    );
  }
  say('Figma: Claude prints a link. Open it in your browser and click Allow.');
  say('The browser then fails to load a localhost address. That is expected:');
  say('copy that full address and paste it where Claude asks for it.');
  for (;;) {
    t.interactive(['claude', 'mcp', 'login', 'figma', '--no-browser']);
    if (mcpConnected(t, 'figma')) {
      ok('Figma: connected');
      // The running agent connected to figma before the login; restart it so it picks up the token.
      quiet(t, sh('fresh.sh --continue'));
      say('The agent restarts in ~25 s to load Figma, and keeps the conversation.');
      return true;
    }
    bad('Figma is not connected yet.');
    const again = await confirm({
      message: 'Try again? Each address works only once, so you will get a new link.',
      default: true,
    });
    if (!again) return false;
  }
}

/** The login lines of doctor.sh. */
function status(t: Target): number {
  const lines = quiet(t, sh('doctor.sh')).stdout.split('\n');
  const mine = lines.filter((l) => /claude logged in|telegram|figma|linear/.test(l));
  for (const l of mine) console.log(l);
  return mine.some((l) => l.startsWith('✘')) ? 1 : 0;
}

/** `canopy login [service]`: every step in order, skipping the ones already done. */
export async function login(t: Target, cfg: Config, service?: Service): Promise<number> {
  if (service === 'status') return status(t);
  const steps = {
    claude: () => loginClaude(t),
    telegram: () => loginTelegram(t, cfg),
    figma: () => loginFigma(t, cfg),
  };
  const todo = service ? [service] : (['claude', 'telegram', 'figma'] as const);
  let failed = 0;
  for (const s of todo) if (!(await steps[s]())) failed++;
  if (!service && !failed) ok('All set. Message your bot in Telegram to say hi to the agent.');
  return failed ? 1 : 0;
}
