import { describe, it, expect } from 'vitest';
import { askNickname } from '../src/prompts.js';

describe('askNickname', () => {
  it('returns the entered nickname', async () => {
    const result = await askNickname({ inject: ['brian'] });
    expect(result).toBe('brian');
  });

  it('returns "anonymous" on empty input', async () => {
    const result = await askNickname({ inject: [''] });
    expect(result).toBe('anonymous');
  });

  it('strips whitespace', async () => {
    const result = await askNickname({ inject: ['  hello  '] });
    expect(result).toBe('hello');
  });
});
