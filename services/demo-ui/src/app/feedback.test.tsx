// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { FeedbackOutcome } from './send-feedback.ts';
import { ThreadIdContext } from './thread-id.ts';

const THREAD_ID = crypto.randomUUID();
const MESSAGE_ID = crypto.randomUUID();

interface MessageState {
  id: string;
  metadata: { submittedFeedback?: { type: 'positive' | 'negative' } };
}

const message: { current: MessageState } = {
  current: { id: MESSAGE_ID, metadata: {} },
};
const submitFeedback = vi.fn();
const sendFeedback = vi.fn<() => Promise<FeedbackOutcome>>();

const testEnv = {} as { Feedback: () => React.JSX.Element };

beforeAll(async () => {
  vi.doMock('@assistant-ui/react', () => ({
    useAui: () => ({ message: { submitFeedback } }),
    useAuiState: (selector: (state: { message: MessageState }) => unknown) =>
      selector({ message: message.current }),
  }));
  vi.doMock('./send-feedback.ts', () => ({ sendFeedback }));
  const feedbackModule = await import('./feedback.tsx');
  testEnv.Feedback = feedbackModule.Feedback;
});

beforeEach(() => {
  message.current = { id: MESSAGE_ID, metadata: {} };
});

afterEach(() => {
  cleanup();
});

function renderFeedback(): void {
  render(
    <ThreadIdContext value={THREAD_ID}>
      <testEnv.Feedback />
    </ThreadIdContext>,
  );
}

describe('Feedback', () => {
  it('sends the reaction and marks it given once it is recorded', async () => {
    sendFeedback.mockResolvedValueOnce('recorded');
    renderFeedback();

    fireEvent.click(screen.getByRole('button', { name: 'Not helpful' }));

    await vi.waitFor(() =>
      expect(submitFeedback).toHaveBeenCalledWith({ type: 'negative' }),
    );
    expect(sendFeedback).toHaveBeenCalledWith({
      threadId: THREAD_ID,
      messageId: MESSAGE_ID,
      reaction: 'negative',
    });
  });

  it('shows an error and leaves feedback ungiven when it is not recorded', async () => {
    sendFeedback.mockResolvedValueOnce('failed');
    renderFeedback();

    fireEvent.click(screen.getByRole('button', { name: 'Helpful' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(submitFeedback).not.toHaveBeenCalled();
  });

  it('shows the reaction given instead of the buttons', () => {
    message.current.metadata.submittedFeedback = { type: 'positive' };
    renderFeedback();

    expect(
      screen.getByRole('img', { name: 'You said this answer was helpful' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
