import { describe, it, expect } from 'vitest';
import { MASCOTS, pickMascot, colorize } from '../src/mascots.js';

describe('MASCOTS', () => {
  it('contains at least 5 mascots', () => {
    expect(MASCOTS.length).toBeGreaterThanOrEqual(5);
  });

  it('every mascot has a name, color, frames, and trophy', () => {
    for (const m of MASCOTS) {
      expect(m.name.length).toBeGreaterThan(0);
      expect(m.color.length).toBeGreaterThan(0);
      expect(m.frames.length).toBeGreaterThanOrEqual(2);
      expect(m.trophy.length).toBeGreaterThan(0);
    }
  });

  it('every mascot has frames of equal line count (so cursor-up overwrite works)', () => {
    for (const m of MASCOTS) {
      const lineCounts = m.frames.map((f) => f.split('\n').length);
      const first = lineCounts[0]!;
      for (const lc of lineCounts) {
        expect(lc).toBe(first);
      }
    }
  });
});

describe('pickMascot', () => {
  it('returns a member of MASCOTS', () => {
    const m = pickMascot();
    expect(MASCOTS).toContain(m);
  });

  it('honors injected RNG', () => {
    expect(pickMascot(() => 0)).toBe(MASCOTS[0]);
    expect(pickMascot(() => 0.999)).toBe(MASCOTS[MASCOTS.length - 1]);
  });
});

describe('colorize', () => {
  it('wraps with the color and reset', () => {
    const out = colorize('hello', '\x1b[31m');
    expect(out).toBe('\x1b[31mhello\x1b[0m');
  });
});
