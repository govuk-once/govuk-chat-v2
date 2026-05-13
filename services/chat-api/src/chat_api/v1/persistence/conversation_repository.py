from datetime import datetime, timezone

from pynamodb.exceptions import DoesNotExist
from pynamodb.transactions import TransactWrite

from chat_api.v1.persistence.data_models import (
    ConversationBranchItem,
    ConversationMessageItem,
    ConversationMetadataItem,
    ConversationTableItem,
    DEFAULT_CONVERSATION_LABEL,
    MessageParticipant,
    MessageStatus,
)


class ConversationNotFoundError(Exception):
    pass


class ConversationRepository:
    def create_conversation_with_user_message(
        self,
        end_user_id: str,
        message: str,
        session_id: str | None = None,
    ) -> tuple[ConversationMetadataItem, ConversationMessageItem]:
        created_at = datetime.now(timezone.utc)
        conversation = ConversationMetadataItem.new_conversation(
            end_user_id=end_user_id,
            label=DEFAULT_CONVERSATION_LABEL,
            created_at=created_at,
        )
        branch = ConversationBranchItem.new_default_branch(
            conversation_id=conversation.conversation_id,
            branch_id=conversation.default_branch_id,
            created_at=created_at,
        )
        user_message = ConversationMessageItem.new_text_message(
            conversation_id=conversation.conversation_id,
            branch_id=branch.branch_id,
            sequence=1,
            participant="user",
            text=message,
            created_at=created_at,
            session_id=session_id,
        )

        branch.record_message(user_message.message_id, 1, created_at)

        with _conversation_transaction() as transaction:
            transaction.save(conversation)
            transaction.save(branch)
            transaction.save(user_message)

        return conversation, user_message

    def append_user_message(
        self,
        conversation_id: str,
        end_user_id: str,
        message: str,
        session_id: str | None = None,
    ) -> ConversationMessageItem:
        return self._append_text_message(
            conversation_id=conversation_id,
            participant="user",
            text=message,
            end_user_id=end_user_id,
            session_id=session_id,
        )

    def append_assistant_message(
        self,
        conversation_id: str,
        message: str,
        session_id: str,
        end_user_id: str,
        status: MessageStatus,
        stop_reason: str,
        message_id: str | None = None,
        error_type: str | None = None,
        error_message: str | None = None,
    ) -> ConversationMessageItem:
        return self._append_text_message(
            conversation_id=conversation_id,
            participant="assistant",
            text=message,
            session_id=session_id,
            end_user_id=end_user_id,
            status=status,
            stop_reason=stop_reason,
            message_id=message_id,
            error_type=error_type,
            error_message=error_message,
        )

    def update_conversation_label(
        self, conversation_id: str, label: str, end_user_id: str
    ) -> ConversationMetadataItem:
        conversation = self._get_conversation(conversation_id, end_user_id)
        conversation.label = label
        conversation.record_activity(datetime.now(timezone.utc))
        conversation.save()
        return conversation

    def get_conversation_with_messages(
        self, conversation_id: str, end_user_id: str, message_count: int | None = None
    ) -> tuple[ConversationMetadataItem, list[ConversationMessageItem]]:
        conversation = self._get_conversation(conversation_id, end_user_id)
        messages = self._get_messages_for_conversation(conversation_id, message_count)
        return conversation, messages

    def _append_text_message(
        self,
        conversation_id: str,
        participant: MessageParticipant,
        text: str,
        end_user_id: str,
        session_id: str | None = None,
        status: MessageStatus | None = None,
        stop_reason: str | None = None,
        message_id: str | None = None,
        error_type: str | None = None,
        error_message: str | None = None,
    ) -> ConversationMessageItem:
        created_at = datetime.now(timezone.utc)
        conversation = self._get_conversation(conversation_id, end_user_id)
        branch = self._get_default_branch(conversation)
        sequence = int(branch.tip_sequence) + 1

        message = ConversationMessageItem.new_text_message(
            conversation_id=conversation.conversation_id,
            branch_id=branch.branch_id,
            sequence=sequence,
            participant=participant,
            text=text,
            message_id=message_id,
            created_at=created_at,
            session_id=session_id,
            status=status,
            stop_reason=stop_reason,
            error_type=error_type,
            error_message=error_message,
        )

        branch.record_message(message.message_id, sequence, created_at)
        conversation.record_activity(created_at)

        with _conversation_transaction() as transaction:
            transaction.save(message)
            transaction.save(branch)
            transaction.save(conversation)

        return message

    def _get_conversation(
        self, conversation_id: str, end_user_id: str
    ) -> ConversationMetadataItem:
        try:
            conversation = ConversationMetadataItem.get(
                ConversationTableItem.conversation_pk(conversation_id),
                "METADATA",
            )

            if conversation.end_user_id != end_user_id:
                raise ConversationNotFoundError(
                    f"Conversation not found: {conversation_id}"
                )

            return conversation
        except DoesNotExist as e:
            raise ConversationNotFoundError(
                f"Conversation not found: {conversation_id}"
            ) from e

    def _get_messages_for_conversation(
        self, conversation_id: str, count: int | None = None
    ) -> list[ConversationMessageItem]:
        return list(
            ConversationMessageItem.query(
                ConversationTableItem.conversation_pk(conversation_id), limit=count
            )
        )

    def _get_default_branch(
        self, conversation: ConversationMetadataItem
    ) -> ConversationBranchItem:
        try:
            return ConversationBranchItem.get(
                conversation.PK,
                ConversationBranchItem.branch_sk(conversation.default_branch_id),
            )
        except DoesNotExist as e:
            raise ConversationNotFoundError(
                f"Default branch not found for conversation: {conversation.conversation_id}"
            ) from e


def _conversation_transaction() -> TransactWrite:
    return TransactWrite(connection=ConversationTableItem._get_connection().connection)
