export type ModelId =
  | 'claude-opus-4-7'
  | 'claude-sonnet-4-6'
  | 'claude-haiku-4-5'
  | 'gpt-5'
  | 'gpt-4o'
  | 'o1';

export const KNOWN_MODELS: readonly ModelId[] = [
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'gpt-5',
  'gpt-4o',
  'o1',
] as const;

export interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface MunchEvent {
  v: 1;
  eventId: string;
  nickname: string;
  deviceId: string;
  model: ModelId;
  inputTokens: number;
  outputTokensEst: number;
  costUsd: number;
  ts: number;
}

export interface IngestResponse {
  ok: boolean;
  globalTokens: number;
  globalCostUsd: number;
  error?: string;
}

export interface LeaderboardEntry {
  nickname: string;
  totalTokens: number;
  totalCostUsd: number;
  munchCount: number;
}

export interface LeaderboardResponse {
  globalTokens: number;
  globalCostUsd: number;
  topUsers: LeaderboardEntry[];
  generatedAt: string;
}
