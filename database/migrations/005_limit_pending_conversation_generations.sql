CREATE UNIQUE INDEX messages_one_pending_assistant_per_conversation_idx
    ON messages (conversation_id)
    WHERE role = 'assistant' AND status = 'pending';
