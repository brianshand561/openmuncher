import { describe, it, expect, vi } from 'vitest';
import { runAnimation } from '../src/animation.js';
import { MASCOTS } from '../src/mascots.js';

const MASCOT = MASCOTS[0]!;

describe('runAnimation', () => {
  it('skips when stdout is not a TTY', async () => {
    const stream = { isTTY: false, write: vi.fn() } as unknown as NodeJS.WriteStream;
    await runAnimation({ stream, durationMs: 50, mascot: MASCOT });
    expect(stream.write).not.toHaveBeenCalled();
  });

  it('skips when disabled flag is set', async () => {
    const stream = { isTTY: true, write: vi.fn() } as unknown as NodeJS.WriteStream;
    await runAnimation({ stream, durationMs: 50, disabled: true, mascot: MASCOT });
    expect(stream.write).not.toHaveBeenCalled();
  });

  it('skips when no mascot is provided', async () => {
    const stream = { isTTY: true, write: vi.fn() } as unknown as NodeJS.WriteStream;
    await runAnimation({ stream, durationMs: 50 });
    expect(stream.write).not.toHaveBeenCalled();
  });

  it('writes frames when TTY and enabled with a mascot', async () => {
    const stream = { isTTY: true, write: vi.fn() } as unknown as NodeJS.WriteStream;
    await runAnimation({ stream, durationMs: 50, mascot: MASCOT });
    expect((stream.write as any).mock.calls.length).toBeGreaterThan(0);
  });
});
