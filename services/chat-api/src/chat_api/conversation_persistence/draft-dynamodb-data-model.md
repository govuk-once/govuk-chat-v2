# Modelling Chat Conversation History

This is an early exploration of whether the draft Chat API history model could fit DynamoDB.

It is intended to capture likely access patterns, modelling ideas, and open questions rather than propose a final schema. The team has not yet decided that DynamoDB is the right persistence technology, so this is more of a discussion document than an implementation plan.

## Why this exists

Compared with existing rudimentary persistence prototype in this repo, the API spec introduces some persistence requirements that are worth thinking through:

- listing a user's previous conversations
- loading a conversation and its messages
- streaming assistant responses before persisting them
- stopping a stream and storing a partial assistant message
- soft-deleting conversations
- editing user messages
- regenerating assistant messages
- representing branches caused by edits and regenerations

## Relevant API concepts

The API spec currently suggests:

- A `Conversation` belongs to an `end_user_id`.
- A `Conversation` has a user-facing label/title.
- A `Conversation` has messages.
- Message history may become branched rather than purely linear.
- The API only exposes one branch at a time: the default branch.
- User messages and assistant responses are persisted once streaming has completed.
- A stopped stream should leave a partial assistant response in history.
- Deleting a conversation probably means hiding it from the user, rather than immediately removing all stored history.

## Access patterns

### GET /conversations

Expected data need:
List active conversations for the current end user, ordered by most recent activity.

DynamoDB consideration:
This likely needs a user-scoped index ordered by `last_activity_at`. Soft-deleted conversations should probably be absent from this active-list index.

### GET /conversations/{id}

Expected data need:
Load conversation metadata, check ownership, check deletion state, find the default branch, and optionally return recent messages.

DynamoDB consideration:
The conversation itself should be directly readable by `conversation_id`. If messages are included, the model also needs an efficient way to read the default branch's messages.

### GET /conversations/{id}/messages

Expected data need:
Return messages for the default branch, probably paginated.

DynamoDB consideration:
Messages need stable ordering within a branch. A sequence number may be more useful than a timestamp alone, because edits and regenerations can create messages with a later timestamp that logically belong earlier in a conversation path.

### POST /conversations

Expected data need:
Start a new conversation by accepting a user message, generating an assistant message, and then persisting the conversation and initial messages once streaming has completed.

DynamoDB consideration:
This probably needs a transaction after streaming completes, because the conversation, initial branch, user message, and assistant message need to be persisted together.

### POST /conversations/{id}/messages

Expected data need:
Append a user message and generated assistant response to the current default branch.

DynamoDB consideration:
The write should probably check that the branch tip has not changed since generation started. This avoids appending to the wrong history if two clients submit messages to the same conversation.

### PATCH /conversations/{id}

Expected data need:
Rename a conversation.

DynamoDB consideration:
We need to decide whether retaining previous titles matters, or whether only the current title is needed.

### DELETE /conversations/{id}

Expected data need:
Hide or delete a conversation for the current end user.

DynamoDB consideration:
We need to decide how soft deletes are handled. Deleted conversations should presumably disappear from the user's active conversation list, but should direct access to a deleted conversation should also be blocked?

### DELETE /conversation-stream/{id}

Expected data need:
Mark an in-progress stream as stopped so the streaming process can stop and store a partial assistant response.

DynamoDB consideration:
This needs short-lived stream state that can be checked during generation. That state may not need to live in the same table as long-term conversation history.

## Branching

The simpler access patterns look straight-forward in DynamoDB.

The key cases that affect the nuance of the data model are the ones related to branching:

- `PATCH /conversations/{conversation_id}/messages/{message_id}`
- `POST /conversations/{conversation_id}/messages/{message_id}/regenerate`

### Finding a message by ID

The edit and regenerate routes receive a `conversation_id` and a `message_id`.

If messages are stored only as branch-ordered items, the application may not be able to find a message efficiently from only those two values. We may need one of:

- a message lookup item
- a secondary index for messages within a conversation
- a different key shape
- an API shape that exposes more branch/position information

I didn't go too far down this route yet, but it is a sign that the branch model and API shape affect each other.

### Representing branches

The biggest unresolved question is:

> Does a new branch store a full message history for the conversation, or only the messages after the fork?

If each branch stores a full history, reading the default branch is simpler. Pagination and LLM context building are also simpler, because the default branch can be read as one ordered list.

The trade-off is duplication. Creating a new branch would copy earlier messages representing the same history.

If each branch only stores messages after the fork, there is less duplication and the tree structure is represented more directly.

The trade-off is read complexity. Loading the current branch may require walking parent branches and merging message segments into one linear history.

My current instinct is that for DynamoDB, where matching your data model to your access patterns matters, a branch being essentially a copy of the conversation up to a certain point, rather than a true tree, may be the simpler fit for the API as currently described, because the API exposes one branch at a time and needs that branch as a linear message history.

## Possible DynamoDB shape

A possible DynamoDB model could use a single table with the following items:

- Conversation - Stores ownership, label, creation time, last activity time, default branch, and deletion state.
- Branch - Stores metadata about one linear version of the conversation, including parent branch information and the current tip.
- Message - Stores the data for an individual message, ordered within that branch.

It would likely also need a secondary index for listing active conversations by user and recent activity.

For example:

```
GSI1PK = USER#{end_user_id}#CONVERSATIONS#ACTIVE
GSI1SK = LAST_ACTIVITY#{last_activity_at}#CONVERSATION#{conversation_id}
```

The branch item is not the conversation history itself, it is metadata about a particular version of the conversation, in the same way that the conversation item is metadata about all branches of that conversation. The message items are the actual history for that branch.

For example, an original branch:

```
branch_1:

1. msg_1: user asks "How much tax should I pay?"
2. msg_2: assistant responds
3. msg_3: user asks a follow-up
4. msg_4: assistant responds
```

If the user edits `msg_3`, we might create `branch_2`, which has a complete message history in its own right:

```
branch_2:

1. msg_1: user asks "How much tax should I pay?"
2. msg_2: assistant responds
3. msg_5: edited user follow-up
4. msg_6: new assistant response
```

In this model, the application does not need to walk `branch_1` in order to render `branch_2`.

That might be represented by items like:

```
Conversation item

PK = CONVERSATION#conversation_123
SK = METADATA

end_user_id = user_123
label = "Tax question"
default_branch_id = branch_2
deleted_at = null
```

```
Branch item

PK = CONVERSATION#conversation_123
SK = BRANCH#branch_2

parent_branch_id = branch_1
forked_from_message_id = msg_3
tip_message_id = msg_6
tip_sequence = 4
```

```
Message items for branch_2

PK = CONVERSATION#conversation_123
SK = BRANCH#branch_2#MESSAGE#0001#msg_1

PK = CONVERSATION#conversation_123
SK = BRANCH#branch_2#MESSAGE#0002#msg_2

PK = CONVERSATION#conversation_123
SK = BRANCH#branch_2#MESSAGE#0003#msg_5

PK = CONVERSATION#conversation_123
SK = BRANCH#branch_2#MESSAGE#0004#msg_6
```

An example message payload could look like:

```
message_type = "UserMessageText"
payload = { text: "How much tax should I pay?" }
```

or:

```
message_type = "AssistantMessageText"
payload = { text: "It depends on..." }
```

This leaves room for future message types, such as messages with sources, choices, progress/status information, or richer interactive payloads.

## Things still to work out

- Whether DynamoDB is still worth exploring for this, or whether persistence choices should wait until higher-level product/library/API questions settle.
- Whether edit/regenerate branching is definitely in scope for the MVP.
- Whether branches should be persisted as full message paths or reconstructed from parent branches.
- How to find a message efficiently from `conversation_id + message_id`.
- Whether messages should be ordered by sequence number, timestamp, or both.
- Which records should be mutable and which should be immutable.
- What soft-delete should mean beyond removing a conversation from the active list.
- Whether stopped stream state belongs in the conversation history table or in a separate short-lived store.
- Whether admin, analytics and eval use cases matter here, of if they will work from an entirely separate data store, e.g. an export to OpenSearch.
