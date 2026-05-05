import {
  DynamoDBClient,
  UpdateItemCommand,
  ConditionalCheckFailedException,
} from '@aws-sdk/client-dynamodb';
import { KEYS, TABLE_NAME } from '../../lib/keys.js';

const PER_MINUTE_CAP = 60;

export interface RateLimitResult {
  ok: boolean;
}

export async function checkAndBumpRateLimit(
  client: DynamoDBClient,
  nickname: string,
  nowMs: number,
): Promise<RateLimitResult> {
  const bucket = Math.floor(nowMs / 60_000);
  const k = KEYS.userAgg(nickname);

  try {
    await client.send(
      new UpdateItemCommand({
        TableName: TABLE_NAME,
        Key: { pk: { S: k.pk }, sk: { S: k.sk } },
        UpdateExpression: 'ADD rateCount :one',
        ConditionExpression: 'rateWindow = :bucket AND rateCount < :cap',
        ExpressionAttributeValues: {
          ':one': { N: '1' },
          ':bucket': { N: String(bucket) },
          ':cap': { N: String(PER_MINUTE_CAP) },
        },
      }),
    );
    return { ok: true };
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      // continue
    } else if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') {
      // continue (handles aws-sdk-client-mock-style rethrows in tests)
    } else {
      throw err;
    }
  }

  try {
    await client.send(
      new UpdateItemCommand({
        TableName: TABLE_NAME,
        Key: { pk: { S: k.pk }, sk: { S: k.sk } },
        UpdateExpression: 'SET rateWindow = :bucket, rateCount = :one',
        ConditionExpression: 'attribute_not_exists(rateWindow) OR rateWindow < :bucket',
        ExpressionAttributeValues: {
          ':one': { N: '1' },
          ':bucket': { N: String(bucket) },
        },
      }),
    );
    return { ok: true };
  } catch (err) {
    if (
      err instanceof ConditionalCheckFailedException ||
      (err as { name?: string })?.name === 'ConditionalCheckFailedException'
    ) {
      return { ok: false };
    }
    throw err;
  }
}
