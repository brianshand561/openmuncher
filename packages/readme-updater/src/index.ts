import { readFileSync, writeFileSync } from 'node:fs';
import type { LeaderboardResponse } from '@openmuncher/shared';
import { renderLeaderboardBlock } from './render.js';

const START_MARKER = '<!-- LEADERBOARD:START -->';
const END_MARKER = '<!-- LEADERBOARD:END -->';

export interface UpdateOptions {
  readmePath: string;
  leaderboardUrl: string;
  fetchFn?: typeof fetch;
}

export async function updateReadme(opts: UpdateOptions): Promise<void> {
  const fetchFn = opts.fetchFn ?? fetch;
  const res = await fetchFn(opts.leaderboardUrl);
  if (!res.ok) {
    throw new Error(`leaderboard fetch failed: ${res.status}`);
  }
  const data = (await res.json()) as LeaderboardResponse;
  const block = renderLeaderboardBlock(data);

  const current = readFileSync(opts.readmePath, 'utf8');
  const startIdx = current.indexOf(START_MARKER);
  const endIdx = current.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error('LEADERBOARD start/end marker not found in README');
  }
  const next =
    current.slice(0, startIdx + START_MARKER.length) +
    '\n' +
    block +
    '\n' +
    current.slice(endIdx);
  writeFileSync(opts.readmePath, next, 'utf8');
}

async function main() {
  const url = process.env.LEADERBOARD_URL;
  if (!url) {
    process.stderr.write('LEADERBOARD_URL env var required\n');
    process.exit(2);
  }
  const path = process.env.README_PATH ?? 'README.md';
  await updateReadme({ readmePath: path, leaderboardUrl: url });
}

const isMain = (() => {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    return import.meta.url === new URL(`file://${argv1}`).href;
  } catch {
    return false;
  }
})();
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`readme-updater: ${err?.message ?? err}\n`);
    process.exit(1);
  });
}
