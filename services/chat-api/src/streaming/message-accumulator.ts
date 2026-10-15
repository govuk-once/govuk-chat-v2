import { EventType, type BaseEvent } from '@ag-ui/core';

export class MessageAccumulator {
  private parts: string[] = [];
  private messageCount = 0;

  process(event: BaseEvent): void {
    switch (event.type) {
      case EventType.TEXT_MESSAGE_START: {
        if (this.messageCount > 0) {
          this.parts.push('\n\n');
        }
        this.messageCount++;
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
}
