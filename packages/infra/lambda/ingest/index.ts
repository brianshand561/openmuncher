import {
  DynamoDBClient,
  TransactWriteItemsCommand,
  ConditionalCheckFailedException,
} from '@aws-sdk/client-dynamodb';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { verifyHmac } from '../shared/hmac.js';
import { validateMunchEvent } from '../shared/validate.js';
import { BanCache } from '../shared/ban-cache.js';
import { checkAndBumpRateLimit } from '../shared/rate-limit.js';
import { pickShard, readGlobalCounter } from '../shared/counter-shard.js';
import { KEYS, TABLE_NAME } from '../../lib/keys.js';

const ddb = new DynamoDBClient({});
const banCache = new BanCache(ddb, 60_000);

const LEADERBOARD_DAILY_CAP = 10_000_000;

function reply(statusCode: number, body: object): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function isCcfe(err: unknown): boolean {
  return (
    err instanceof ConditionalCheckFailedException ||
    (err as { name?: string })?.name === 'ConditionalCheckFailedException'
  );
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const secret = process.env.HMAC_SECRET;
  if (!secret) return reply(500, { ok: false, error: 'server misconfigured' });

  const sig = event.headers['x-om-sig'] ?? event.headers['X-OM-Sig'];
  const raw = event.body ?? '';
  if (typeof sig !== 'string' || !verifyHmac(raw, sig, secret)) {
    return reply(401, { ok: false, error: 'bad signature' });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return reply(400, { ok: false, error: 'invalid json' });
  }

  const validated = validateMunchEvent(parsed, Date.now());
  if (!validated.ok) return reply(400, { ok: false, error: validated.error });
  const ev = validated.event;

  const banned = await banCache.isBanned(ev.nickname);

  if (!banned) {
    const rl = await checkAndBumpRateLimit(ddb, ev.nickname, Date.now());
    if (!rl.ok) return reply(429, { ok: false, error: 'rate limited' });
  }

  const shard = pickShard();
  const eventKey = KEYS.event(ev.eventId);
  const userKey = KEYS.userAgg(ev.nickname);
  const counterKey = KEYS.counterShard(shard);

  const todayUtc = new Date().toISOString().slice(0, 10);
  const totalTokens = ev.inputTokens + ev.outputTokensEst;

  const transactItems: TransactWriteItemsCommand['input']['TransactItems'] = [
    {
      Put: {
        TableName: TABLE_NAME,
        Item: {
          pk: { S: eventKey.pk },
          sk: { S: eventKey.sk },
          nickname: { S: ev.nickname },
          model: { S: ev.model },
          inputTokens: { N: String(ev.inputTokens) },
          outputTokensEst: { N: String(ev.outputTokensEst) },
          costUsd: { N: String(ev.costUsd) },
          ts: { N: String(ev.ts) },
          deviceId: { S: ev.deviceId },
        },
        ConditionExpression: 'attribute_not_exists(pk)',
      },
    },
    {
      Update: {
        TableName: TABLE_NAME,
        Key: { pk: { S: counterKey.pk }, sk: { S: counterKey.sk } },
        UpdateExpression: 'ADD tokens :t, costUsd :c',
        ExpressionAttributeValues: {
          ':t': { N: String(totalTokens) },
          ':c': { N: String(ev.costUsd) },
        },
      },
    },
  ];

  if (!banned) {
    transactItems.push({
      Update: {
        TableName: TABLE_NAME,
        Key: { pk: { S: userKey.pk }, sk: { S: userKey.sk } },
        UpdateExpression:
          'ADD totalTokens :t, totalCostUsd :c, munchCount :one ' +
          'SET lastMunchTs = :ts, ' +
          'leaderboardDate = if_not_exists(leaderboardDate, :today), ' +
          'leaderboardTokens = if_not_exists(leaderboardTokens, :zero), ' +
          'gsiPk = :gsiPk, ' +
          'nickname = :nick',
        ExpressionAttributeValues: {
          ':t': { N: String(totalTokens) },
          ':c': { N: String(ev.costUsd) },
          ':one': { N: '1' },
          ':ts': { N: String(ev.ts) },
          ':today': { S: todayUtc },
          ':zero': { N: '0' },
          ':gsiPk': { S: 'USERS' },
          ':nick': { S: ev.nickname },
        },
      },
    });

    transactItems.push({
      Update: {
        TableName: TABLE_NAME,
        Key: { pk: { S: userKey.pk }, sk: { S: userKey.sk } },
        UpdateExpression:
          'SET leaderboardDate = :today, ' +
          'leaderboardTokens = if_not_exists(leaderboardTokens, :zero) + :t',
        ConditionExpression:
          'attribute_not_exists(leaderboardDate) OR leaderboardDate <> :today OR leaderboardTokens < :cap',
        ExpressionAttributeValues: {
          ':today': { S: todayUtc },
          ':zero': { N: '0' },
          ':t': { N: String(totalTokens) },
          ':cap': { N: String(LEADERBOARD_DAILY_CAP) },
        },
      },
    });
  }

  try {
    await ddb.send(new TransactWriteItemsCommand({ TransactItems: transactItems }));
  } catch (err) {
    if (isCcfe(err)) {
      // Duplicate eventId or leaderboard cap reached — treat as soft success.
    } else {
      console.error('transact write failed', err);
      return reply(503, { ok: false, error: 'storage error' });
    }
  }

  const counter = await readGlobalCounter(ddb);
  return reply(200, { ok: true, globalTokens: counter.tokens, globalCostUsd: counter.costUsd });
};
