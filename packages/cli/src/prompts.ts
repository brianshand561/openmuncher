import promptsLib from 'prompts';

export interface AskOptions {
  /** When set, prompts uses these values instead of stdin (test seam). */
  inject?: unknown[];
}

export async function askNickname(opts: AskOptions = {}): Promise<string> {
  if (opts.inject !== undefined) promptsLib.inject(opts.inject);
  const { nickname } = await promptsLib({
    type: 'text',
    name: 'nickname',
    message: '🪵 OpenMuncher — first run.\nSuggest a leaderboard nickname (your GitHub username is fine):',
  });
  const trimmed = typeof nickname === 'string' ? nickname.trim() : '';
  return trimmed.length === 0 ? 'anonymous' : trimmed;
}
