import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { BanCache } from '../lambda/shared/ban-cache.js';

const ddbMock = mockClient(DynamoDBClient);

beforeEach(() => {
  ddbMock.reset();
});

describe('BanCache', () => {
  it('returns false for never-loaded nickname after first load with empty result', async () => {
    ddbMock.on(ScanCommand).resolves({ Items: [] });
    const cache = new BanCache(new DynamoDBClient({}), 60_000);
    expect(await cache.isBanned('brian')).toBe(false);
  });

  it('returns true for a banned nickname', async () => {
    ddbMock.on(ScanCommand).resolves({
      Items: [{ pk: { S: 'BANNED#evil' }, sk: { S: 'BAN' } }],
    });
    const cache = new BanCache(new DynamoDBClient({}), 60_000);
    expect(await cache.isBanned('evil')).toBe(true);
    expect(await cache.isBanned('brian')).toBe(false);
  });

  it('refreshes after TTL expires', async () => {
    let scanCount = 0;
    ddbMock.on(ScanCommand).callsFake(() => {
      scanCount++;
      return { Items: scanCount === 1 ? [] : [{ pk: { S: 'BANNED#newban' }, sk: { S: 'BAN' } }] };
    });
    const cache = new BanCache(new DynamoDBClient({}), 100);
    expect(await cache.isBanned('newban')).toBe(false);
    await new Promise((r) => setTimeout(r, 150));
    expect(await cache.isBanned('newban')).toBe(true);
    expect(scanCount).toBe(2);
  });

  it('does not refresh within TTL', async () => {
    let scanCount = 0;
    ddbMock.on(ScanCommand).callsFake(() => {
      scanCount++;
      return { Items: [] };
    });
    const cache = new BanCache(new DynamoDBClient({}), 60_000);
    await cache.isBanned('a');
    await cache.isBanned('b');
    await cache.isBanned('c');
    expect(scanCount).toBe(1);
  });
});
