import { EventType, type BaseEvent } from '@ag-ui/core';

export class MessageAccumulator {
  private parts: string[] = [];
  private messageCount = 0;
  private lastMessageId: string | undefined;
  private firstOutputAt: string | undefined;

  process(event: BaseEvent): void {
    switch (event.type) {
      case EventType.TEXT_MESSAGE_START: {
        if (this.messageCount > 0) {
          this.parts.push('\n\n');
        }
        this.messageCount++;
        this.firstOutputAt ??= new Date().toISOString();
        this.lastMessageId = (
          event as BaseEvent & { messageId: string }
        ).messageId;
        break;
      }
      case EventType.TEXT_MESSAGE_CONTENT: {
        const { delta } = event as BaseEvent & { delta: string };
        this.parts.push(delta);
        break;
      }
    }
  }

  getContent(): string {
    return this.parts.join('');
  }

  getLastMessageId(): string | undefined {
    return this.lastMessageId;
  }

  getFirstOutputAt(): string | undefined {
    return this.firstOutputAt;
  }
}
