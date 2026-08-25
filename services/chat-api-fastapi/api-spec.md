# Draft API Specification

This serves as a draft specification for the HTTP API of Chat V2, with the intention of it being used as a guide for our development. It may well evolve into an OpenAPI specification, as per the one for [Chat v1](https://github.com/alphagov/govuk-chat/blob/main/docs/api_openapi_specification.yml), but it is intentionally loose now for flexibility.

It deliberately includes some tricky concepts compared to Chat V1 - such as stopping a stream, deleting a conversation and conversation branching. This is to help us form opinions on their suitability. It is purposefully quite similar to functionality available in tools like ChatGPT and Anthropic Claude.

## Key changes in comparison to Chat V1

- We no longer have "question" and "answer" terminology instead we use the term "message" to reflect a broadening of purpose
- Message responses are streamed back to a user with [HTTP SSE](https://en.wikipedia.org/wiki/Server-sent_events)
- A user message is not persisted to the conversation history until a response has been generated (to avoid the risk of user having unanswered queries in their history)
- We aim to make conversations a resource in it's own right with the ability to return a paginated endpoint of conversations to enable navigation through history
- We expect to have ability to edit user messages and regenerate responses, both are things that lead to conversation branching

## Things still to work out

- Authentication technology for the API (likely AWS Cognito)
- Whether and what we'd give the API as a prefix name, in order to allow future backwards incompatible APIs that replace it (for example how OpenAI have the [Responses API](https://developers.openai.com/api/reference/responses/overview) that replaces the [Chat Completions API](https://developers.openai.com/api/docs/guides/migrate-to-responses?api-mode=responses))
- Whether we'll have a `/v1` (or similar) version route prefix
- Whether there is a need for a mechanism for a user to be able to view another user's conversation, either full or in part (as per sharing on ChatGPT)
- Where and how to apply rate limits (particular endpoints, HTTP methods, API itself)
- Whether there is a need for end user feedback to be taken via API endpoints
- Whether there will be other APIs provided by this app (admin area?, tagging auto evaluation data?)

## Global considerations

- It is expected that all requests are authenticated to a relevant API user account (e.g. GOV.UK App)
- It is required that all requests have an `end_user_id` value to distinguish who the conversation and messages belong to
- The API will only expose one branch of a conversation at a time, the default branch

## Endpoints

### GET /conversations

Returns [conversation entities](#conversation) for a user. Expected to return a limited number (50?) of conversations with the ability to paginate to return older (or newer) items to explore a user's full history.

Expected to be sorted by most recent activity, unclear if there's a need for any other ordering mechanisms.

**Expected functionality enabled by this:**

Allow a user to view/resume past conversations, like the left sidebar on ChatGPT/Claude.

### GET /conversations/{id}

Access a specific [conversation entity](#conversation), which may also return the recent [messages](#message) for round-trip convenience

**Expected functionality enabled by this:**

Ability to load a conversation for rendering by a client.

### POST /conversations

Creates a new [conversation entity](#conversation) by receiving a user [message](#message) and generating an assistant response message.

Input would be validated to ensure there is the appropriate data to create a message.

Would return a [streamed message response](#streamed-message-response) with some extra data about the newly created conversation.

Data would not be persisted to the database until the messages are finished streaming, at which point the conversation entity will be created as well as the messages (ideally in a transaction).

In order to create the conversation entity there would need to be an additional process (presumably via an LLM) which
uses the user message to generate a name for the conversation.

**Expected functionality enabled by this:**

Ability to start a new conversation by adding a pairing of a new message with an assistant message as a response

### PATCH /conversations/{id}

Would modify a [conversation](#conversation), at the time of writing the only end user modification expected is the ability to change the name of the conversation that a user uses to reference the conversation.

Would validate the input for validity.

_TODO:_ Should this return any data (conversation object) or just a success (204) status code

_TODO:_ Establish if we'd keep any past records of names (states) the conversation has had.

**Expected functionality enabled by this:**

Ability for a user to modify the labelling (name) of a conversation

### DELETE /conversations/{id}

The ability to delete a [conversation](#conversation).

Would validate that a conversation exists that a user can delete

_TODO:_ Establish if this would be a soft-delete and, if not, what that meant for associated messages.

**Expected functionality enabled by this:**

Ability for a user to hide the conversation from their sidebar and forbid future resumptions of it

### GET /conversations/{id}/messages

Returns [message entities](#message) for a given conversation identifier. Expected to return up to a limited number (50?) of messages with the ability to paginate to return older (or newer) items to explore a full conversation history.

Would only return a single [branch](#branch) of a conversation, the default branch, other branches would be unavailable.

Expected to be sorted by the message timestamp

**Expected functionality enabled by this:**

Ability for a user to see the messages in a conversation, allowing browsing of the history

### POST /conversations/{id}/messages

Creates [message entities](#message) by accepting a user message for a conversation and generating an assistant response. The messages are added to the conversation history.

Input would be validated to ensure there is the appropriate data to create a message.

Would return a [streamed message response](#streamed-message-response).

_TODO:_ Establish if there are any state constraints in order to accept a message (e.g. does an existing message being generated prevent other messages).

**Expected functionality enabled by this:**

Ability for a user to add a pairing of a new user message with an assistant message as response

### PATCH /conversations/{id}/messages/{id}

Allows a user [message entity](#message) to have it's contents updated and a new assistant response generated.

Updating a message would be a form of [branching](#branch) a conversation, where a new branch is created at the point of the updated message. Any messages that had followed the previous version of the message would not be considered part of the branch, effectively resetting the conversation to the point of this update.

Input would be validated to ensure valid message contents and that the message being updated is a user message.

Would return a [streamed message response](#streamed-message-response).

_TODO:_ Confirm which data records are mutable and immutable in the process of this action, we likely want to keep the past history.

**Expected functionality enabled by this:**

Ability for a user to edit a previous user message, which will branch the conversation at the point of the edit and have a new assistant message generated for it.

### POST /conversations/{id}/messages/{id}/regenerate

Allows a [message entity](#message) that is from an assistant to be reproduced based on the history that preceded it.

Regenerating a message would be a form of [branching](#branch) a conversation, where ea new branch is created at the point of the regenerated message and any messages that followed the previous assistant message would no longer be API accessible, effectively resetting the conversation to the point of this regeneration.

Input would be validated to ensure the message is an assistant message.

Would return a [streamed message response](#streamed-message-response) which differs to the other streamed response ones as it doesn't have to consider a user message (all others involve a user message being submitted).

**Expected functionality enabled by this:**

Ability for a user to instruct the assistant agent to produce a new message response for a user message. This would branch the conversation at the point of this response.

### DELETE /conversation-stream/{id}

A way to inform the server that a streamed response should be stopped at the earliest convience and stored as a partial response.

The expected way this would work is that a unique short lived ID would be created and stored in a shared datastore at the point of starting a stream. This HTTP endpoint can then be called to change the state of the database record. Periodically thorugh the streaming process this record could be looked up to check if streaming should stop.

**Expected functionality enabled by this:**

Ability for a user to terminate the generation of an assistant response mid-way through, leaving a partial response in the conversation history

## Shared concerns

### Streamed message response

There a number of API endpoints that are used to return an assistant message via a HTTP stream.

These would be expected to operate as follows:

- Their transport technology would be [HTTP SSE](https://en.wikipedia.org/wiki/Server-sent_events), streaming JSON objects that can be interpreted by a client.
- Efforts would be made to try interpret if any error conditions occurred before starting the stream - as once a stream has started we lose the ability to change HTTP status code.
- We would not persist a change in conversation state to persistent storage until streaming was complete, accepting a risk that an early termination of the server streaming data could lead to users being streamed content that that we have no record of server side.
- A start event would be streamed first with any metadata needed for the whole stream, this would contain an ID or URL that could be called in order to [stop the stream](#delete-conversation-streamid) and potentially if there was anything the client needed to know about any user message (for example if there was any server side formatting of it - ideally not).
- There would be a stream of JSON objects that have the appropriate information that a client can use to progressively render an assistant message, the most basic type of these would be a message delta of likely partial markdown but could also be aspects of informing about response progress steps or more complex types of rendering
- Should an unrecoverable error occur server side during the stream there would be an error event sent to the client for them to consider the requested message processing to be a failure and give the client the opportunity to try again
- Once streaming is complete the messages will be persisted to the conversation history, this would have to consider whether the state of the conversation had changed at all during the stream (for example what if a user had two clients open for the same conversation and both had a new message)
- There would be a stop event sent back to confirm that the stream has finished which would contain any extra metadata needed for the client from the data persistence (e.g. ids or timestamps)
- While streaming a response there would be periodic checks to see if the end user had stopped the stream, if this occurs the stream would stop and a partial assistant response would be stored

## Entities

### Conversation

A conversation represents an interaction between a user and an assistant and has a collection of messages associated with it.

The collection of messages is not a linear list but instead something of a branched tree structure where any message could have multiple iterations (such as through editing or regenerating a response) and then subsequent messages only belong to that branch. A conversation would have many branches and one would be the default branch which is served to a user.

A conversation would have properties such as:

- end user who owns it
- time it was created
- the default branch
- label - the user facing name of the conversation

_TODO:_ Understand whether there is a need to keep history of the label of the conversation.

### Branch

A branch of a conversation is a way to identify a linear list of messages in a conversation that has many branches.

If a branch has forked from an existing branch of a conversation, it will need to know about the branch that it forked from as way to establish the earlier entries in the conversation.

A branch would have properties such as:

- the conversation that owns it
- a parent branch - the branch of the tree it extends (if any)
- time it was created
- when it was last updated

_TODO:_ Understand whether a branch has any additional state aspects, such as whether they're used to present a user with alternative inputs following a particular message.

_TODO:_ Establish if there is a need for a branch to know about sibling branches at the same level (i.e. for an edited message, how many edits there have been) or whether another entity is needed for that.

### Message

A message is a representation of communication that appears in a conversation that is associated with a participant (initially user or assistant).

They would store the necessary information for them to be rendered by a client in an identical way to how they were streamed.

A message would have properties such as:

- the branch it belongs to
- the conversation participant
- the data of what is needed for a client to render it
- the timestamp of it
- any metadata needed to associate it with an agent interaction for tracing
- any metadata about any agent interactions (such as early termination)

_TODO:_ With streaming timestamp becomes an ambiguous concept, do we associate the assistant message timestamp with the time the streamed started or when the stream finished?

_TODO:_ There's probably many types of data structures messages could have in the future, how do we model for future flexibility?

_TODO:_ In many future concepts there are concepts of messages that can have degrees of interactivity (choices for a user for example), there's a consideration of whether a message is immutable or mutable, and - should it be mutable - what state information needs long term persistence.
