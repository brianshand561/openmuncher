import { describe, it, expect, vi } from 'vitest';
import { runAnimation } from '../src/animation.js';

describe('runAnimation', () => {
  it('skips when stdout is not a TTY', async () => {
    const stream = { isTTY: false, write: vi.fn() } as unknown as NodeJS.WriteStream;
    await runAnimation({ stream, durationMs: 50 });
    expect(stream.write).not.toHaveBeenCalled();
  });

  it('skips when disabled flag is set', async () => {
    const stream = { isTTY: true, write: vi.fn() } as unknown as NodeJS.WriteStream;
    await runAnimation({ stream, durationMs: 50, disabled: true });
    expect(stream.write).not.toHaveBeenCalled();
  });

  it('writes frames when TTY and enabled', async () => {
    const stream = { isTTY: true, write: vi.fn() } as unknown as NodeJS.WriteStream;
    await runAnimation({ stream, durationMs: 50 });
    expect((stream.write as any).mock.calls.length).toBeGreaterThan(0);
  });
});
