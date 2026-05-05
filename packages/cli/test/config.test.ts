import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, saveConfig, type Config } from '../src/config.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'omtest-'));
});

describe('config', () => {
  it('returns null when file does not exist', () => {
    expect(loadConfig(dir)).toBeNull();
  });

  it('round-trips a valid config', () => {
    const cfg: Config = {
      nickname: 'brian',
      deviceId: '11111111-2222-3333-4444-555555555555',
      lifetimeTokens: 10,
      lifetimeCostUsd: 0.5,
      lastGlobalTokens: 1000,
      lastGlobalCostUsd: 5,
    };
    saveConfig(dir, cfg);
    expect(loadConfig(dir)).toEqual(cfg);
  });

  it('returns null on malformed JSON', () => {
    mkdirSync(join(dir, '.openmuncher'), { recursive: true });
    writeFileSync(join(dir, '.openmuncher', 'config.json'), '{not json');
    expect(loadConfig(dir)).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    mkdirSync(join(dir, '.openmuncher'), { recursive: true });
    writeFileSync(join(dir, '.openmuncher', 'config.json'), '{"foo":"bar"}');
    expect(loadConfig(dir)).toBeNull();
  });
});
