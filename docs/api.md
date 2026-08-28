# KnowledgeHub API

Base URL: `http://localhost:3001`

All responses use either `{ "data": ... }` or `{ "error": { "code", "message" } }`.

## Endpoints

| Method | Path | Authentication | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | No | Check API and database health |
| POST | `/api/v1/auth/register` | No | Register and issue tokens |
| POST | `/api/v1/auth/login` | No | Log in and issue tokens |
| POST | `/api/v1/auth/refresh` | Refresh token | Rotate the refresh token |
| POST | `/api/v1/auth/logout` | Refresh token | Revoke the refresh token |
| GET | `/api/v1/auth/me` | Bearer token | Read the current user |
| PATCH | `/api/v1/auth/me` | Bearer token | Update the current user's display name |
| PATCH | `/api/v1/auth/password` | Bearer token + current password | Change password and revoke all refresh sessions |
| GET | `/api/v1/auth/sessions` | Bearer token | Read active refresh-session count and last login time |
| DELETE | `/api/v1/auth/sessions` | Bearer token | Revoke all active refresh sessions |
| GET | `/api/v1/overview` | Bearer token | Read the owned resource summary, activity, and recent changes |
| POST | `/api/v1/apps` | Bearer token | Create an AI app |
| GET | `/api/v1/apps` | Bearer token | List the current user's apps |
| GET | `/api/v1/apps/stats` | Bearer token | Read app status and knowledge-base binding totals |
| GET | `/api/v1/apps/:appId` | Bearer token | Read one owned app |
| PATCH | `/api/v1/apps/:appId` | Bearer token | Update one owned app |
| DELETE | `/api/v1/apps/:appId` | Bearer token | Disable one owned app |
| GET | `/api/v1/knowledge-bases` | Bearer token | List owned knowledge bases |
| GET | `/api/v1/knowledge-bases/stats` | Bearer token | Read knowledge-base status and app binding totals |
| POST | `/api/v1/knowledge-bases` | Bearer token | Create a knowledge base |
| GET | `/api/v1/knowledge-bases/:id` | Bearer token | Read one owned knowledge base |
| PATCH | `/api/v1/knowledge-bases/:id` | Bearer token | Update one owned knowledge base |
| DELETE | `/api/v1/knowledge-bases/:id` | Bearer token | Disable one owned knowledge base |
| GET | `/api/v1/knowledge-bases/:id/apps` | Bearer token | List apps attached to a knowledge base |
| POST | `/api/v1/knowledge-bases/:id/search` | Bearer token | Rank matching chunks across ready documents |
| POST | `/api/v1/knowledge-bases/:id/documents` | Bearer token | Add a document record |
| GET | `/api/v1/knowledge-bases/:id/documents` | Bearer token | List and filter document records |
| GET | `/api/v1/knowledge-bases/:id/documents/stats` | Bearer token | Read document and chunk totals |
| PATCH | `/api/v1/knowledge-bases/:id/documents/:documentId` | Bearer token | Update document source or processing state |
| DELETE | `/api/v1/knowledge-bases/:id/documents/:documentId` | Bearer token | Disable a document record |
| POST | `/api/v1/knowledge-bases/:id/documents/:documentId/content/preview` | Bearer token | Preview deterministic text chunking without changing data |
| PUT | `/api/v1/knowledge-bases/:id/documents/:documentId/content` | Bearer token | Atomically replace all chunks with imported text |
| POST | `/api/v1/knowledge-bases/:id/documents/:documentId/chunks` | Bearer token | Append a document chunk |
| GET | `/api/v1/knowledge-bases/:id/documents/:documentId/chunks` | Bearer token | List and search ordered chunks |
| PATCH | `/api/v1/knowledge-bases/:id/documents/:documentId/chunks/:chunkId` | Bearer token | Update chunk content or FastGPT metadata |
| DELETE | `/api/v1/knowledge-bases/:id/documents/:documentId/chunks/:chunkId` | Bearer token | Permanently delete and resequence a chunk |
| GET | `/api/v1/apps/:appId/knowledge-bases` | Bearer token | List knowledge bases attached to an app |
| PUT | `/api/v1/apps/:appId/knowledge-bases/:id` | Bearer token | Attach a knowledge base idempotently |
| DELETE | `/api/v1/apps/:appId/knowledge-bases/:id` | Bearer token | Detach a knowledge base idempotently |
| POST | `/api/v1/conversations` | Bearer token | Create a conversation for an owned app |
| GET | `/api/v1/conversations` | Bearer token | List owned conversations |
| GET | `/api/v1/conversations/stats` | Bearer token | Read conversation and message totals |
| GET | `/api/v1/conversations/:id` | Bearer token | Read a conversation with its ordered messages |
| PATCH | `/api/v1/conversations/:id` | Bearer token | Rename, archive, or restore a conversation |
| DELETE | `/api/v1/conversations/:id` | Bearer token | Archive a conversation |
| POST | `/api/v1/conversations/:id/messages` | Bearer token | Append a message with the next sequence number |

## List queries and relation counts

Both list endpoints accept `page`, `pageSize`, `search`, `status`, and `sort`. Supported sort values are:

- `updated_desc` (default): most recently updated first
- `created_desc`: most recently created first
- `name_asc`: name in ascending order

Each app item includes `attachedKnowledgeBaseCount`. Each knowledge-base item includes `attachedAppCount`. These counts only include relations owned by the authenticated user.

The app stats response contains `total`, `active`, `draft`, `disabled`, and `knowledgeBaseBindings`. The knowledge-base stats response contains `total`, `ready`, `pending`, `failed`, `disabled`, and `appBindings`.

## Conversation queries and messages

The conversation list accepts `page`, `pageSize`, `search`, `status`, `appId`, and `sort`. Supported sort values are `updated_desc`, `created_desc`, and `title_asc`. Search matches conversation titles, app names, and message content.

Message sequence numbers are assigned inside a transaction after locking the owned conversation. This keeps `(conversation_id, sequence_no)` unique under concurrent writes. Archived conversations remain readable but reject new messages with `CONVERSATION_ARCHIVED`.

## Knowledge-base documents

Document records track file, URL, or text sources, MIME type, byte size, checksum, FastGPT Collection ID, processing status, chunk count, and failure details. Lists support `page`, `pageSize`, `search`, `status`, and the standard sort values. URL sources require a valid `sourceUri`.

Chunks store ordered searchable content, optional token counts, and FastGPT Data IDs. Positions are allocated while locking the owning document, and `(document_id, position)` is unique. A database trigger derives each document's `chunk_count`; clients cannot set that count directly. Deleting a chunk closes the position gap inside the same transaction.

Text content can be previewed and imported with the same deterministic paragraph-, line-, and sentence-aware chunker. Import requests accept 1-750,000 characters, a `chunkSize` from 200-4,000, a `chunkOverlap` from 0-1,000 that must remain smaller than the chunk size, and one of the supported text MIME types. Imports that would create more than 2,000 chunks are rejected.

`PUT .../content` locks the owned document and replaces all old chunks in one transaction. It computes byte size and SHA-256 on the server, marks the document as `ready`, clears its previous processing error, and returns both the updated document and the same chunk summary used by preview. A rejected or failed import leaves the previous chunks unchanged.

```json
{
  "content": "# 退款政策\n\n签收后七天内可以申请退款。",
  "chunkSize": 1000,
  "chunkOverlap": 100,
  "mimeType": "text/markdown"
}
```

Ownership is inherited through the composite `(knowledge_base_id, owner_id)` foreign key. Requests for another user's knowledge base return `KNOWLEDGE_BASE_NOT_FOUND` rather than exposing whether that resource exists.

## Knowledge-base retrieval test

`POST /api/v1/knowledge-bases/:id/search` searches chunks from ready documents owned by the authenticated user. It combines exact substring matching with PostgreSQL trigram word and whole-text similarity, then returns a stable descending score from 0 to 1. Results include document identity, source type, MIME type, chunk position, content, token count, and whether the match was exact or fuzzy.

The request accepts a 1-200 character `query`, `limit` from 1-20 (default 8), and `minScore` from 0-1 (default 0.15). The response also reports how many eligible chunks were scanned and server-side duration.

```json
{
  "query": "退款原路返回",
  "limit": 8,
  "minScore": 0.15
}
```

## Overview aggregation

`GET /api/v1/overview` returns three sections in one owner-scoped query workflow:

- `summary`: app, knowledge-base, conversation, message, and binding totals plus active, ready, and bound resource counts
- `activity`: exactly seven ordered calendar days with new-conversation and message counts
- `recent`: up to eight recently updated apps, knowledge bases, and conversations

The overview endpoint is intended to back the default workspace entry page without requiring the browser to combine multiple stats endpoints.

## Register example

Registration passwords must contain 12-72 characters, fit within bcrypt's 72-byte UTF-8 limit, use at least three of uppercase letters, lowercase letters, numbers, and symbols, avoid common or predictable patterns, and exclude the submitted name and email prefix. Login remains compatible with accounts created before this policy.

```powershell
$body = @{
  email = 'student@example.com'
  password = 'Orbit!Cedar9Vault'
  displayName = '训练用户'
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3001/api/v1/auth/register `
  -ContentType 'application/json' `
  -Body $body
```

## Create app example

```powershell
$headers = @{ Authorization = "Bearer $accessToken" }
$body = @{
  name = '企业知识助手'
  description = '面向产品文档的智能问答应用'
  fastgptAppId = 'fastgpt-app-id'
  fastgptApiKey = 'fastgpt-api-key'
  status = 'draft'
  settings = @{ temperature = 0.2 }
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3001/api/v1/apps `
  -Headers $headers `
  -ContentType 'application/json' `
  -Body $body
```

`fastgptApiKey` is write-only. It is encrypted with AES-256-GCM before storage and is never returned by list or detail endpoints. Responses expose only `hasFastgptApiKey`. Send a new `fastgptApiKey` to replace the stored value, or `{ "clearFastgptApiKey": true }` to remove it.
