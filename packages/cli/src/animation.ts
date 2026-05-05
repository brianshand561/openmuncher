import { type Mascot, colorize } from './mascots.js';

export interface AnimationOptions {
  stream?: NodeJS.WriteStream;
  durationMs?: number;
  disabled?: boolean;
  /** When set, animate this mascot. When omitted, the animation is a no-op. */
  mascot?: Mascot;
}

export async function runAnimation(opts: AnimationOptions = {}): Promise<void> {
  const stream = opts.stream ?? process.stdout;
  if (opts.disabled) return;
  if (!stream.isTTY) return;
  if (!opts.mascot) return;

  const duration = opts.durationMs ?? 2400;
  const frameDuration = 200;
  const start = Date.now();
  const frames = opts.mascot.frames;

  const colorSupport = process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb';
  const display = colorSupport
    ? frames.map((f) => colorize(f, opts.mascot!.color))
    : frames;

  const frameLines = (frames[0] ?? '').split('\n').length;

  stream.write('\x1b[?25l'); // hide cursor

  let i = 0;
  while (Date.now() - start < duration) {
    if (i > 0) stream.write(`\x1b[${frameLines}A`); // overwrite prior frame
    stream.write(display[i % frames.length]! + '\n');
    i++;
    await new Promise((r) => setTimeout(r, frameDuration));
  }

  stream.write('\x1b[?25h'); // show cursor
}
