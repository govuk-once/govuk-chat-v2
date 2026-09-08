import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Entity, Service } from 'electrodb';

const table = process.env.CHAT_API_TABLE_NAME;
if (!table) {
  throw new Error('CHAT_API_TABLE_NAME is not configured');
}

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// One year in seconds.
export const RETENTION_PERIOD_IN_SECONDS = 31_536_000;

const ThreadMapping = new Entity({
  model: { service: 'chat-api', entity: 'threadMapping', version: '1' },
  attributes: {
    endUserId: { type: 'string', required: true },
    userThreadId: { type: 'string', required: true },
    systemThreadId: { type: 'string', required: true, readOnly: true },
    createdAt: { type: 'string', required: true, readOnly: true },
    expiresAt: { type: 'number', required: true },
  },
  indexes: {
    primary: {
      pk: {
        field: 'pk',
        composite: ['endUserId'],
        template: 'USER#${endUserId}',
        casing: 'none',
      },
      sk: {
        field: 'sk',
        composite: ['userThreadId'],
        template: 'THREAD#${userThreadId}',
        casing: 'none',
      },
    },
  },
});

const Thread = new Entity({
  model: { service: 'chat-api', entity: 'thread', version: '1' },
  attributes: {
    systemThreadId: { type: 'string', required: true },
    endUserId: { type: 'string', required: true, readOnly: true },
    createdAt: { type: 'string', required: true, readOnly: true },
    expiresAt: { type: 'number', required: true },
  },
  indexes: {
    primary: {
      pk: {
        field: 'pk',
        composite: ['systemThreadId'],
        template: 'THREAD#${systemThreadId}',
        casing: 'none',
      },
      sk: { field: 'sk', composite: [], template: 'THREAD', casing: 'none' },
    },
  },
});

export const service = new Service(
  { threadMapping: ThreadMapping, thread: Thread },
  { table, client },
);

export function cancellationCodes(
  items: ReadonlyArray<{ code: string }>,
): string[] {
  return items.map((item) => item.code);
}
