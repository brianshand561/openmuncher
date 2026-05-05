import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runMunch } from '../src/munch.js';

describe('runMunch', () => {
  it('returns a fully populated result', async () => {
    const home = mkdtempSync(join(tmpdir(), 'om-'));
    const result = await runMunch({
      home,
      env: { CLAUDE_CODE_MODEL: 'claude-haiku-4-5' },
      argv: { tokens: 3000, model: undefined, intensity: undefined, animation: false },
      askNickname: vi.fn().mockResolvedValue('brian'),
      seed: 'unit-test',
    });
    expect(result.model).toBe('claude-haiku-4-5');
    expect(result.inputTokens).toBeGreaterThan(2700);
    expect(result.inputTokens).toBeLessThan(3300);
    expect(result.outputTokensEst).toBeGreaterThan(0);
    expect(result.totalCostUsd).toBeGreaterThan(0);
    expect(result.payloadText.toLowerCase()).toContain('do not summarize');
    expect(result.config.nickname).toBe('brian');
  });

  it('reuses an existing config without prompting', async () => {
    const home = mkdtempSync(join(tmpdir(), 'om-'));
    const fs = await import('node:fs');
    fs.mkdirSync(join(home, '.openmuncher'), { recursive: true });
    fs.writeFileSync(
      join(home, '.openmuncher', 'config.json'),
      JSON.stringify({
        nickname: 'existing',
        deviceId: '11111111-1111-1111-1111-111111111111',
        lifetimeTokens: 0,
        lifetimeCostUsd: 0,
        lastGlobalTokens: 0,
        lastGlobalCostUsd: 0,
      }),
    );
    const ask = vi.fn();
    const result = await runMunch({
      home,
      env: {},
      argv: { tokens: 2000, model: undefined, intensity: undefined, animation: false },
      askNickname: ask,
      seed: 'unit-test-2',
    });
    expect(ask).not.toHaveBeenCalled();
    expect(result.config.nickname).toBe('existing');
  });

  it('updates lifetime totals after a run', async () => {
    const home = mkdtempSync(join(tmpdir(), 'om-'));
    const result = await runMunch({
      home,
      env: {},
      argv: { tokens: 2000, model: undefined, intensity: undefined, animation: false },
      askNickname: vi.fn().mockResolvedValue('brian'),
      seed: 'unit-test-3',
    });
    expect(result.config.lifetimeTokens).toBe(result.inputTokens + result.outputTokensEst);
    expect(result.config.lifetimeCostUsd).toBeCloseTo(result.totalCostUsd, 6);
  });
});
