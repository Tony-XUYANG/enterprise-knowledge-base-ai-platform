CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX knowledge_document_chunks_content_trigram_idx
    ON knowledge_document_chunks
    USING GIN (content gin_trgm_ops);
