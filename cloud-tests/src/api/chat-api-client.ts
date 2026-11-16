import { randomUUID } from 'node:crypto';
import {
  CognitoIdentityProviderClient,
  DescribeUserPoolClientCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { EventSourceParserStream } from 'eventsource-parser/stream';
import { chatApiOutputs, type ChatApiOutputs } from '../environment.ts';

export interface StoredMessage {
  id: string;
  role: string;
  content: string;
}

async function fetchAppClientSecret({
  userPoolId,
  appClientId,
}: ChatApiOutputs): Promise<string> {
  const cognito = new CognitoIdentityProviderClient({});
  const { UserPoolClient } = await cognito.send(
    new DescribeUserPoolClientCommand({
      UserPoolId: userPoolId,
      ClientId: appClientId,
    }),
  );
  if (!UserPoolClient?.ClientSecret) {
    throw new Error(`App client ${appClientId} has no client secret`);
  }
  return UserPoolClient.ClientSecret;
}

async function fetchAccessToken(outputs: ChatApiOutputs): Promise<string> {
  const secret = await fetchAppClientSecret(outputs);
  const credentials = Buffer.from(`${outputs.appClientId}:${secret}`);

  const response = await fetch(outputs.tokenEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials.toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'chat-api/invoke',
    }),
  });
  if (!response.ok) {
    throw new Error(`Token request failed with status ${response.status}`);
  }

  const { access_token: accessToken } = (await response.json()) as {
    access_token: string;
  };
  return accessToken;
}

// Calls the Chat API as one end user, as a client app would.
export class ChatApiClient {
  static async connect(): Promise<ChatApiClient> {
    const outputs = await chatApiOutputs();
    const accessToken = await fetchAccessToken(outputs);
    return new ChatApiClient(
      outputs.gatewayUrl.replace(/\/$/, ''),
      accessToken,
    );
  }

  readonly endUserId = randomUUID();

  private constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
  ) {}

  private async request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${this.accessToken}`,
        'end-user-id': this.endUserId,
      },
    });
    if (!response.ok) {
      throw new Error(
        `${init.method ?? 'GET'} ${path} failed with status ${response.status}: ${await response.text()}`,
      );
    }
    return response;
  }

  // Returns the types of the events streamed back, in the order received.
  async invokeThread(threadId: string, prompt: string): Promise<string[]> {
    const response = await this.request('/v1/threads/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        threadId,
        runId: randomUUID(),
        messages: [{ id: randomUUID(), role: 'user', content: prompt }],
      }),
    });
    if (!response.body) {
      throw new Error('Invoking the thread returned no event stream');
    }

    const events = response.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new EventSourceParserStream());
    const eventTypes: string[] = [];
    for await (const event of events) {
      eventTypes.push((JSON.parse(event.data) as { type: string }).type);
    }
    return eventTypes;
  }

  async listMessages(threadId: string): Promise<StoredMessage[]> {
    const response = await this.request(`/v1/threads/${threadId}/messages`);
    const { messages } = (await response.json()) as {
      messages: StoredMessage[];
    };
    return messages;
  }
}
