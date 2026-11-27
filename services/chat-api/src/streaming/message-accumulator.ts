import { EventType, type BaseEvent } from '@ag-ui/core';

export class MessageAccumulator {
  private parts: string[] = [];
  private messageIds: string[] = [];

  process(event: BaseEvent): void {
    switch (event.type) {
      case EventType.TEXT_MESSAGE_START: {
        if (this.messageIds.length > 0) {
          this.parts.push('\n\n');
        }
        this.messageIds.push(
          (event as BaseEvent & { messageId: string }).messageId,
        );
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
    return this.messageIds.at(-1);
  }

  getMessageIds(): string[] {
    return [...this.messageIds];
  }
}
