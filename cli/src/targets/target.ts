/** Where the canopy container runs. Commands call these; nothing else knows about docker/ssh/railway. */
export interface Target {
  /** Build/deploy and start the container. */
  up(): number;
  /** Stop the container; the /root volume is kept. */
  down(): number;
  /** Follow container logs. */
  logs(): number;
  /** Run a command inside the container; output goes to the terminal unless captured. */
  exec(argv: string[], opts?: { capture?: boolean }): { code: number; stdout: string };
  /** Run an interactive command (with a TTY) inside the container. */
  interactive(argv: string[]): number;
  /** Wait until the container finished its setup (entrypoint printed "ready"). */
  waitReady(timeoutSec: number): boolean;
}

/** Run a canopy script inside the container with a login shell, so PATH and env from profile.d are loaded. */
export const sh = (script: string) => ['bash', '-lc', script];
