ALTER TABLE knowledge_documents
    ADD CONSTRAINT knowledge_documents_identity_owner_unique
    UNIQUE (id, knowledge_base_id, owner_id);

UPDATE knowledge_documents SET chunk_count = 0 WHERE chunk_count <> 0;

CREATE TABLE knowledge_document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL,
    knowledge_base_id UUID NOT NULL,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    position INTEGER NOT NULL CHECK (position > 0),
    content TEXT NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 100000),
    token_count INTEGER CHECK (token_count IS NULL OR token_count >= 0),
    fastgpt_data_id VARCHAR(160),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(metadata) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT knowledge_document_chunks_document_owner_fk
        FOREIGN KEY (document_id, knowledge_base_id, owner_id)
        REFERENCES knowledge_documents(id, knowledge_base_id, owner_id)
        ON DELETE CASCADE,
    CONSTRAINT knowledge_document_chunks_position_unique
        UNIQUE (document_id, position)
        DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX knowledge_document_chunks_owner_document_idx
    ON knowledge_document_chunks (owner_id, document_id, position);

CREATE INDEX knowledge_document_chunks_content_search_idx
    ON knowledge_document_chunks
    USING GIN (to_tsvector('simple', content));

CREATE TRIGGER knowledge_document_chunks_set_updated_at
BEFORE UPDATE ON knowledge_document_chunks
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION sync_knowledge_document_chunk_count()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    affected_document_id UUID;
BEGIN
    affected_document_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.document_id ELSE NEW.document_id END;

    UPDATE knowledge_documents
       SET chunk_count = (
           SELECT count(*)::integer
             FROM knowledge_document_chunks
            WHERE document_id = affected_document_id
       )
     WHERE id = affected_document_id;

    IF TG_OP = 'UPDATE' AND OLD.document_id <> NEW.document_id THEN
        UPDATE knowledge_documents
           SET chunk_count = (
               SELECT count(*)::integer
                 FROM knowledge_document_chunks
                WHERE document_id = OLD.document_id
           )
         WHERE id = OLD.document_id;
    END IF;

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER knowledge_document_chunks_sync_count
AFTER INSERT OR DELETE OR UPDATE OF document_id ON knowledge_document_chunks
FOR EACH ROW EXECUTE FUNCTION sync_knowledge_document_chunk_count();
