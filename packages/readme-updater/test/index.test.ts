import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { updateReadme } from '../src/index.js';
import type { LeaderboardResponse } from '@openmuncher/shared';

const FIXTURE: LeaderboardResponse = {
  globalTokens: 100,
  globalCostUsd: 1,
  topUsers: [{ nickname: 'a', totalTokens: 10, totalCostUsd: 1, munchCount: 1 }],
  generatedAt: '2026-05-05T14:00:00.000Z',
};

const README_TEMPLATE = `# Test
Foo bar

<!-- LEADERBOARD:START -->
*old content*
<!-- LEADERBOARD:END -->

Trailing.
`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'om-readme-'));
});

function fakeFetch(payload: LeaderboardResponse): typeof fetch {
  return (async () => new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch;
}

describe('updateReadme', () => {
  it('replaces the leaderboard block in-place', async () => {
    const path = join(dir, 'README.md');
    writeFileSync(path, README_TEMPLATE);
    await updateReadme({
      readmePath: path,
      leaderboardUrl: 'https://example.test/leaderboard',
      fetchFn: fakeFetch(FIXTURE),
    });
    const out = readFileSync(path, 'utf8');
    expect(out).toContain('<!-- LEADERBOARD:START -->');
    expect(out).toContain('<!-- LEADERBOARD:END -->');
    expect(out).toContain('a'); // nickname rendered
    expect(out).not.toContain('*old content*');
    expect(out.startsWith('# Test')).toBe(true);
    expect(out.endsWith('Trailing.\n')).toBe(true);
  });

  it('throws if start marker is missing', async () => {
    const path = join(dir, 'README.md');
    writeFileSync(path, '# Test\nNo markers\n');
    await expect(
      updateReadme({
        readmePath: path,
        leaderboardUrl: 'https://example.test/leaderboard',
        fetchFn: fakeFetch(FIXTURE),
      }),
    ).rejects.toThrow(/marker/i);
  });

  it('throws on non-2xx fetch', async () => {
    const path = join(dir, 'README.md');
    writeFileSync(path, README_TEMPLATE);
    const failingFetch = (async () => new Response('nope', { status: 500 })) as typeof fetch;
    await expect(
      updateReadme({
        readmePath: path,
        leaderboardUrl: 'https://example.test/leaderboard',
        fetchFn: failingFetch,
      }),
    ).rejects.toThrow();
  });
});
