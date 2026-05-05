const FRAMES = [
  '🪵 → ⚙️    ',
  '   🪵 → ⚙️  ',
  '     🪵 → ⚙️',
  '       🔥💨',
];

export interface AnimationOptions {
  stream?: NodeJS.WriteStream;
  durationMs?: number;
  disabled?: boolean;
}

export async function runAnimation(opts: AnimationOptions = {}): Promise<void> {
  const stream = opts.stream ?? process.stdout;
  if (opts.disabled) return;
  if (!stream.isTTY) return;
  const duration = opts.durationMs ?? 800;
  const frameDuration = 100;
  const start = Date.now();
  let i = 0;
  while (Date.now() - start < duration) {
    stream.write('\r' + FRAMES[i % FRAMES.length]);
    i++;
    await new Promise((r) => setTimeout(r, frameDuration));
  }
  stream.write('\r' + ' '.repeat(20) + '\r');
}
