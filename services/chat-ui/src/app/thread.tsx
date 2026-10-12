import {
  AuiIf,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from '@assistant-ui/react';
import { StreamdownTextPrimitive } from '@assistant-ui/react-streamdown';
import styles from './thread.module.css';

export function Thread({ isNewConversation }: { isNewConversation: boolean }) {
  return (
    <ThreadPrimitive.Root className={styles.root}>
      <header className={styles.header}>
        <form
          className={styles.newConversation}
          method="post"
          action="/api/chat/new"
        >
          <button type="submit" className={styles.newConversationButton}>
            New conversation
          </button>
        </form>
      </header>

      <ThreadPrimitive.Viewport className={styles.viewport}>
        <AuiIf condition={(state) => isNewConversation && state.thread.isEmpty}>
          <p className={styles.welcome}>
            Ask a question to start a conversation.
          </p>
        </AuiIf>

        <ThreadPrimitive.Messages
          components={{ UserMessage, AssistantMessage }}
        />

        <ThreadPrimitive.ViewportFooter className={styles.footer}>
          <Composer />
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className={styles.userMessage}>
      <div className={styles.userMessageText}>
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className={styles.assistantMessage}>
      <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
      <AuiIf
        condition={(state) =>
          state.thread.isRunning && state.message.content.length === 0
        }
      >
        <p className={styles.thinking}>Thinking…</p>
      </AuiIf>
      <MessagePrimitive.Error>
        <ErrorPrimitive.Root className={styles.error}>
          <ErrorPrimitive.Message />
        </ErrorPrimitive.Root>
      </MessagePrimitive.Error>
    </MessagePrimitive.Root>
  );
}

function MarkdownText() {
  return <StreamdownTextPrimitive mode="streaming" />;
}

function Composer() {
  return (
    <ComposerPrimitive.Root className={styles.composer}>
      <ComposerPrimitive.Input
        className={styles.composerInput}
        placeholder="Send a message"
        aria-label="Message"
        rows={1}
        autoFocus
      />
      <AuiIf condition={(state) => !state.thread.isRunning}>
        <ComposerPrimitive.Send className={styles.composerButton}>
          Send
        </ComposerPrimitive.Send>
      </AuiIf>
      <AuiIf condition={(state) => state.thread.isRunning}>
        <ComposerPrimitive.Cancel className={styles.composerButton}>
          Stop
        </ComposerPrimitive.Cancel>
      </AuiIf>
    </ComposerPrimitive.Root>
  );
}
