from .data_models import (
    ConversationMessageItem,
    ConversationMetadataItem,
    ConversationTableItem,
    MessageRole,
)


class ConversationRepository:
    def create_conversation(self, user_id: str, title: str) -> ConversationMetadataItem:
        item = ConversationMetadataItem.new_conversation(user_id, title)
        item.save()
        return item

    def add_message(
        self, conversation_id: str, role: MessageRole, content: str
    ) -> ConversationMessageItem:
        item = ConversationMessageItem.new_message(conversation_id, role, content)
        item.save()
        return item

    def get_conversation_with_messages(
        self, conversation_id: str
    ) -> tuple[ConversationMetadataItem, list[ConversationMessageItem]] | None:
        items = ConversationTableItem.list_for_conversation(conversation_id)
        metadata_item = next(
            (item for item in items if isinstance(item, ConversationMetadataItem)),
            None,
        )
        if metadata_item is None:
            return None
        messages = [item for item in items if isinstance(item, ConversationMessageItem)]
        return metadata_item, messages

    def list_conversations_for_user(
        self, user_id: str
    ) -> list[ConversationMetadataItem]:
        return ConversationMetadataItem.list_for_user(user_id)
