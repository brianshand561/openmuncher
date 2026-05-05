import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { checkAndBumpRateLimit } from '../lambda/shared/rate-limit.js';

const ddbMock = mockClient(DynamoDBClient);

beforeEach(() => {
  ddbMock.reset();
});

describe('checkAndBumpRateLimit', () => {
  const now = 1_700_000_000_000;

  it('succeeds for new bucket (first call)', async () => {
    let calls = 0;
    ddbMock.on(UpdateItemCommand).callsFake(() => {
      calls++;
      if (calls === 1) {
        const e = new Error('ConditionalCheckFailedException');
        e.name = 'ConditionalCheckFailedException';
        throw e;
      }
      return {};
    });
    const r = await checkAndBumpRateLimit(new DynamoDBClient({}), 'brian', now);
    expect(r.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it('succeeds for same bucket within cap', async () => {
    ddbMock.on(UpdateItemCommand).resolves({});
    const r = await checkAndBumpRateLimit(new DynamoDBClient({}), 'brian', now);
    expect(r.ok).toBe(true);
  });

  it('rejects when same-bucket cap exceeded', async () => {
    let calls = 0;
    ddbMock.on(UpdateItemCommand).callsFake(() => {
      calls++;
      const e = new Error('ConditionalCheckFailedException');
      e.name = 'ConditionalCheckFailedException';
      throw e;
    });
    const r = await checkAndBumpRateLimit(new DynamoDBClient({}), 'brian', now);
    expect(r.ok).toBe(false);
    expect(calls).toBe(2);
  });
});
