import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { TABLE_NAME } from '../../lib/keys.js';

export class BanCache {
  private bans = new Set<string>();
  private lastLoadedAt = 0;

  constructor(
    private readonly client: DynamoDBClient,
    private readonly ttlMs: number,
  ) {}

  async isBanned(nickname: string): Promise<boolean> {
    if (Date.now() - this.lastLoadedAt > this.ttlMs) {
      await this.load();
    }
    return this.bans.has(nickname);
  }

  private async load(): Promise<void> {
    const out = await this.client.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'begins_with(pk, :prefix)',
        ExpressionAttributeValues: { ':prefix': { S: 'BANNED#' } },
        ProjectionExpression: 'pk',
      }),
    );
    const next = new Set<string>();
    for (const item of out.Items ?? []) {
      const pk = item.pk?.S;
      if (pk && pk.startsWith('BANNED#')) next.add(pk.slice('BANNED#'.length));
    }
    this.bans = next;
    this.lastLoadedAt = Date.now();
  }
}
