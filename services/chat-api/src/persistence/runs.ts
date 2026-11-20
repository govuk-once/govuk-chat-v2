import type { WhereAttributeSymbol } from 'electrodb';
import {
  AssistantTurnMessagesSchema,
  UserTurnMessagesSchema,
  type AssistantTurnMessages,
  type UserTurnMessages,
} from '../schemas/turn-messages.ts';
import {
  absentOrExpired,
  cancellationCodes,
  chatRegularRetention,
  epochSeconds,
  service,
} from './service.ts';

const leaseSeconds = Number(process.env.RUN_LOCK_LEASE_SECONDS);
if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds <= 0) {
  throw new Error('RUN_LOCK_LEASE_SECONDS is not configured');
}

export interface RunKey {
  systemThreadId: string;
  runId: string;
  messageId: string;
}

export interface MessageInput {
  messageId: string;
  role: string;
  content: string;
  createdAt: string;
}

export interface TurnInput {
  userTurn: { createdAt: string; messages: UserTurnMessages };
  assistantTurn: { firstOutputAt: string; messages: AssistantTurnMessages };
}

export interface TurnIds {
  userTurnId: string;
  assistantTurnId: string;
}

export type RunClaim =
  | { status: 'claimed' }
  | { status: 'thread-busy' }
  | { status: 'duplicate-run' }
  | { status: 'duplicate-message' };

interface ClaimedRecord {
  runId: WhereAttributeSymbol<string>;
}

interface ClaimOperations {
  notExists: (attribute: WhereAttributeSymbol<string>) => string;
  eq: (attribute: WhereAttributeSymbol<string>, value: string) => string;
}

function claimedBy(runId: string) {
  return (attribute: ClaimedRecord, operation: ClaimOperations): string =>
    `(${operation.notExists(attribute.runId)} OR ${operation.eq(attribute.runId, runId)})`;
}

export async function beginRun(key: RunKey): Promise<RunClaim> {
  const now = new Date();
  const nowSeconds = epochSeconds(now);
  const { systemThreadId, runId, messageId } = key;

  const result = await service.transaction
    .write(({ runLock, run, message }) => [
      runLock
        .put({
          systemThreadId,
          runId,
          expiresAt: nowSeconds + leaseSeconds,
        })
        .where(
          (attribute, operation) =>
            `(${operation.notExists(attribute.runId)} OR ${operation.lte(attribute.expiresAt, nowSeconds)})`,
        )
        .commit(),
      run.check({ systemThreadId, runId }).where(absentOrExpired(now)).commit(),
      message
        .check({ systemThreadId, messageId })
        .where(absentOrExpired(now))
        .commit(),
    ])
    .go();

  if (!result.canceled) {
    return { status: 'claimed' };
  }

  const codes = cancellationCodes(result.data);
  const [lockCode, runCode, messageCode] = codes;

  if (
    lockCode === 'ConditionalCheckFailed' ||
    codes.includes('TransactionConflict')
  ) {
    return { status: 'thread-busy' };
  }
  if (runCode === 'ConditionalCheckFailed') {
    return { status: 'duplicate-run' };
  }
  if (messageCode === 'ConditionalCheckFailed') {
    return { status: 'duplicate-message' };
  }
  throw new Error(`Run claim was cancelled: ${codes.join(', ')}`);
}

type TransactionEntities = Parameters<
  Parameters<typeof service.transaction.write>[0]
>[0];
type TurnEntities = Pick<
  TransactionEntities,
  'userTurn' | 'assistantTurn' | 'messagePointer'
>;

// Turns get ids of their own, as run and message ids come from the client
// or the agent.
function turnWrites(
  { userTurn, assistantTurn, messagePointer }: TurnEntities,
  { systemThreadId, runId }: RunKey,
  turns: TurnInput,
  { userTurnId, assistantTurnId }: TurnIds,
  now: Date,
  expiresAt: number,
) {
  const userMessages = UserTurnMessagesSchema.parse(turns.userTurn.messages);
  const assistantMessages = AssistantTurnMessagesSchema.parse(
    turns.assistantTurn.messages,
  );

  return [
    userTurn
      .put({
        systemThreadId,
        turnId: userTurnId,
        sender: 'user',
        runId,
        messages: userMessages,
        createdAt: turns.userTurn.createdAt,
        expiresAt,
      })
      .commit(),
    assistantTurn
      .put({
        systemThreadId,
        turnId: assistantTurnId,
        sender: 'assistant',
        runId,
        messages: assistantMessages,
        createdAt: now.toISOString(),
        firstOutputAt: turns.assistantTurn.firstOutputAt,
        expiresAt,
      })
      .commit(),
    messagePointer
      .put({
        systemThreadId,
        messageId: userMessages[0].id,
        turnId: userTurnId,
        expiresAt,
      })
      .where(absentOrExpired(now))
      .commit(),
  ];
}

export async function finishRun(
  key: RunKey,
  messages: MessageInput[],
  turns: TurnInput,
): Promise<TurnIds> {
  const now = new Date();
  const expiresAt = chatRegularRetention(now);
  const { systemThreadId, runId } = key;
  const turnIds = {
    userTurnId: crypto.randomUUID(),
    assistantTurnId: crypto.randomUUID(),
  };

  const result = await service.transaction
    .write(({ runLock, run, message, ...turnEntities }) => [
      run
        .put({
          systemThreadId,
          runId,
          createdAt: now.toISOString(),
          expiresAt,
        })
        .where(absentOrExpired(now))
        .commit(),
      ...messages.map((input) =>
        message
          .put({
            systemThreadId,
            messageId: input.messageId,
            role: input.role,
            content: input.content,
            runId,
            createdAt: input.createdAt,
            expiresAt,
          })
          .where(absentOrExpired(now))
          .commit(),
      ),
      ...turnWrites(turnEntities, key, turns, turnIds, now, expiresAt),
      runLock.delete({ systemThreadId }).where(claimedBy(runId)).commit(),
    ])
    .go();

  if (!result.canceled) {
    return turnIds;
  }

  const codes = cancellationCodes(result.data);
  throw new Error(`Run completion was cancelled: ${codes.join(', ')}`);
}

export async function releaseRun(
  key: Pick<RunKey, 'systemThreadId' | 'runId'>,
): Promise<void> {
  await service.entities.runLock
    .delete({ systemThreadId: key.systemThreadId })
    .where(claimedBy(key.runId))
    .go();
}
