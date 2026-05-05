export const TABLE_NAME = 'openmuncher';

export const TOP_USERS_INDEX = 'top-users-index';

export const COUNTER_SHARDS = 10;

export const KEYS = {
  event: (eventId: string) => ({ pk: `EVENT#${eventId}`, sk: 'EVENT' }),
  userAgg: (nickname: string) => ({ pk: `USER#${nickname}`, sk: 'AGG' }),
  counterShard: (shard: number) => ({ pk: 'COUNTER#GLOBAL', sk: `SHARD#${shard}` }),
  banned: (nickname: string) => ({ pk: `BANNED#${nickname}`, sk: 'BAN' }),
} as const;

/** GSI partition key value. Constant — all aggregates share it; sort by leaderboardTokens DESC. */
export const TOP_USERS_PK = 'USERS';
