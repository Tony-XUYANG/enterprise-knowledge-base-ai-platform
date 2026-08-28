CREATE TABLE knowledge_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    knowledge_base_id UUID NOT NULL,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 255),
    source_type VARCHAR(20) NOT NULL DEFAULT 'file'
        CHECK (source_type IN ('file', 'url', 'text')),
    source_uri TEXT,
    mime_type VARCHAR(120),
    size_bytes BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
    checksum_sha256 CHAR(64)
        CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$'),
    fastgpt_collection_id VARCHAR(120),
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'ready', 'failed', 'disabled')),
    chunk_count INTEGER NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
    error_message TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(metadata) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT knowledge_documents_knowledge_base_owner_fk
        FOREIGN KEY (knowledge_base_id, owner_id)
        REFERENCES knowledge_bases(id, owner_id)
        ON DELETE CASCADE,
    CONSTRAINT knowledge_documents_url_source_check
        CHECK (source_type <> 'url' OR source_uri IS NOT NULL),
    UNIQUE (knowledge_base_id, name)
);

CREATE INDEX knowledge_documents_owner_status_idx
    ON knowledge_documents (owner_id, status, updated_at DESC);

CREATE INDEX knowledge_documents_knowledge_base_recent_idx
    ON knowledge_documents (knowledge_base_id, updated_at DESC);

CREATE INDEX knowledge_documents_checksum_idx
    ON knowledge_documents (checksum_sha256)
    WHERE checksum_sha256 IS NOT NULL;

CREATE TRIGGER knowledge_documents_set_updated_at
BEFORE UPDATE ON knowledge_documents
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
