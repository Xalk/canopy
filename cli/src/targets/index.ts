import type { Config } from '../config.js';
import { dockerTarget } from './docker.js';
import { railwayTarget } from './railway.js';
import type { Target } from './target.js';
import { vpsTarget } from './vps.js';

export function makeTarget(cfg: Config, projectDir: string, packageDir: string): Target {
  if (cfg.target === 'ssh') return vpsTarget(cfg, projectDir, packageDir);
  if (cfg.target === 'railway') return railwayTarget(cfg, projectDir, packageDir);
  return dockerTarget(cfg, projectDir, packageDir);
}
