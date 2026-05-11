class UnknownAgentEventTypeError(ValueError):
    """Raised when an unknown event type is received from the agent."""

    pass


class ErrorEventReceivedFromAgentError(ValueError):
    """Raised when an error event is received from the agent."""

    pass
