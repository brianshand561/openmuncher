import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Config {
  nickname: string;
  deviceId: string;
  lifetimeTokens: number;
  lifetimeCostUsd: number;
  lastGlobalTokens: number;
  lastGlobalCostUsd: number;
}

const REQUIRED_KEYS: (keyof Config)[] = [
  'nickname', 'deviceId', 'lifetimeTokens', 'lifetimeCostUsd',
  'lastGlobalTokens', 'lastGlobalCostUsd',
];

function configDir(home: string) {
  return join(home, '.openmuncher');
}
function configPath(home: string) {
  return join(configDir(home), 'config.json');
}

export function loadConfig(home: string = homedir()): Config | null {
  try {
    const raw = readFileSync(configPath(home), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    for (const k of REQUIRED_KEYS) {
      if (!(k in parsed)) return null;
    }
    return parsed as Config;
  } catch {
    return null;
  }
}

export function saveConfig(home: string = homedir(), cfg: Config): void {
  mkdirSync(configDir(home), { recursive: true });
  writeFileSync(configPath(home), JSON.stringify(cfg, null, 2), 'utf8');
}
