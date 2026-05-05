import { describe, it, expect } from 'vitest';
import { detectModel } from '../src/model-detector.js';

const ENV_VARS = [
  'OPENMUNCHER_MODEL',
  'CLAUDE_CODE_MODEL',
  'ANTHROPIC_MODEL',
  'WINDSURF_MODEL',
  'CURSOR_MODEL',
] as const;

function emptyEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const k of ENV_VARS) delete env[k];
  return env;
}

describe('detectModel', () => {
  it('falls back to claude-opus-4-7 when nothing is set', () => {
    expect(detectModel(emptyEnv())).toBe('claude-opus-4-7');
  });

  it('honors OPENMUNCHER_MODEL above all others', () => {
    expect(
      detectModel({
        OPENMUNCHER_MODEL: 'gpt-4o',
        CLAUDE_CODE_MODEL: 'claude-sonnet-4-6',
      }),
    ).toBe('gpt-4o');
  });

  it('uses CLAUDE_CODE_MODEL when OPENMUNCHER_MODEL is unset', () => {
    expect(detectModel({ CLAUDE_CODE_MODEL: 'claude-sonnet-4-6' })).toBe(
      'claude-sonnet-4-6',
    );
  });

  it('falls through unknown values to the next env var', () => {
    expect(
      detectModel({
        OPENMUNCHER_MODEL: 'made-up',
        CLAUDE_CODE_MODEL: 'claude-haiku-4-5',
      }),
    ).toBe('claude-haiku-4-5');
  });

  it('falls back to opus if all values are unknown', () => {
    expect(detectModel({ CLAUDE_CODE_MODEL: 'made-up' })).toBe(
      'claude-opus-4-7',
    );
  });
});
