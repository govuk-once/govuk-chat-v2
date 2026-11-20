import { service } from './service.ts';
import { TurnCursor } from '../schemas/turn-cursor.ts';
import type {
  AssistantTurnMessages,
  UserTurnMessages,
} from '../schemas/turn-messages.ts';

interface TurnPosition {
  turnId: string;
  createdAt: string;
}

export type StoredTurn =
  | (TurnPosition & { sender: 'user'; messages: UserTurnMessages })
  | (TurnPosition & {
      sender: 'assistant';
      messages: AssistantTurnMessages;
    });

export interface TurnPage {
  turns: StoredTurn[];
  earlier?: TurnCursor;
  later?: TurnCursor;
}

type Order = 'asc' | 'desc';

export const TURN_PAGE_SIZE = 100;

function queryFrom(systemThreadId: string, from?: TurnCursor) {
  const query = service.collections.threadTurns({ systemThreadId });
  if (!from) {
    return query;
  }
  const { createdAt, turnId } = from;
  // ElectroDB's lt has no lower bound, so a page reaching the first turn
  // would read on through other entities' gsi1 items. Starting the range at
  // the collection's prefix stops it there.
  return from.direction === 'before'
    ? query.between({ createdAt: '' }, { createdAt, turnId })
    : query.gt({ createdAt, turnId });
}

function compare(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function byPosition(order: Order) {
  const direction = order === 'asc' ? 1 : -1;
  return (a: TurnPosition, b: TurnPosition): number =>
    direction *
    (compare(a.createdAt, b.createdAt) || compare(a.turnId, b.turnId));
}

interface TurnBatch {
  turns: StoredTurn[];
  cursor: string | undefined;
}

async function readTurnBatch(
  systemThreadId: string,
  from: TurnCursor | undefined,
  order: Order,
  cursor: string | undefined,
): Promise<TurnBatch> {
  const response = await queryFrom(systemThreadId, from).go({
    order,
    limit: TURN_PAGE_SIZE + 1,
    cursor,
  });
  const { userTurn, assistantTurn } = response.data;
  const turns: StoredTurn[] = [
    ...userTurn.map(({ turnId, createdAt, messages }) => ({
      turnId,
      createdAt,
      sender: 'user' as const,
      messages,
    })),
    ...assistantTurn.map(({ turnId, createdAt, messages }) => ({
      turnId,
      createdAt,
      sender: 'assistant' as const,
      messages,
    })),
  ];

  // gt compares against the cursor's key, which stops short of the entity
  // suffix every stored key ends with, so a forward page reads the cursor's
  // own turn too.
  return {
    turns:
      from?.direction === 'after'
        ? turns.filter(({ turnId }) => turnId !== from.turnId)
        : turns,
    cursor: response.cursor ?? undefined,
  };
}

// A collection query ignores count, so this reads until it has one more
// turn than a page, or the thread runs out. Each response groups its turns
// by entity, so they're merged back into order at the end.
async function readTurns(
  systemThreadId: string,
  from: TurnCursor | undefined,
  order: Order,
): Promise<StoredTurn[]> {
  const turns: StoredTurn[] = [];
  let cursor: string | undefined;

  do {
    const batch = await readTurnBatch(systemThreadId, from, order, cursor);
    turns.push(...batch.turns);
    cursor = batch.cursor;
  } while (cursor !== undefined && turns.length <= TURN_PAGE_SIZE);

  return turns.toSorted(byPosition(order));
}

export async function getTurnPage(
  systemThreadId: string,
  from?: TurnCursor,
): Promise<TurnPage> {
  const isAscending = from?.direction === 'after';
  const read = await readTurns(
    systemThreadId,
    from,
    isAscending ? 'asc' : 'desc',
  );

  const hasMoreInPagedDirection = read.length > TURN_PAGE_SIZE;
  const page = read.slice(0, TURN_PAGE_SIZE);
  const turns = isAscending ? page : page.toReversed();

  const oldest = turns.at(0);
  const newest = turns.at(-1);
  if (!oldest || !newest) {
    return { turns };
  }

  // A page reached from a cursor always has the cursor's turn on the side
  // it came from, so only the paged direction needs the extra read.
  const hasEarlier = isAscending || hasMoreInPagedDirection;
  const hasLater =
    from !== undefined && (!isAscending || hasMoreInPagedDirection);

  return {
    turns,
    ...(hasEarlier && { earlier: TurnCursor.before(oldest) }),
    ...(hasLater && { later: TurnCursor.after(newest) }),
  };
}
