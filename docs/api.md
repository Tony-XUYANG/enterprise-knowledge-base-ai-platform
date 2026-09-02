# KnowledgeHub API

Base URL: `http://localhost:3001`

All responses use either `{ "data": ... }` or `{ "error": { "code", "message" } }`.

## Endpoints

| Method | Path | Authentication | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | No | Check API and database health |
| POST | `/api/v1/auth/register` | No | Register and send an email-verification link |
| POST | `/api/v1/auth/email-verification/resend` | No | Request a generic verification-email response |
| POST | `/api/v1/auth/email-verification/confirm` | One-time verification token | Verify the login email |
| POST | `/api/v1/auth/login` | No | Verify password; issue tokens or an MFA challenge |
| POST | `/api/v1/auth/mfa/verify` | One-time MFA challenge | Verify TOTP/recovery code and issue tokens |
| POST | `/api/v1/auth/refresh` | Refresh token | Rotate the refresh token |
| POST | `/api/v1/auth/logout` | Refresh token | Revoke the refresh token |
| POST | `/api/v1/auth/password-reset/request` | No | Request a generic password-reset email response |
| POST | `/api/v1/auth/password-reset/confirm` | One-time reset token | Set a new password and revoke all sessions |
| GET | `/api/v1/auth/me` | Bearer token | Read the current user |
| PATCH | `/api/v1/auth/me` | Bearer token | Update the current user's display name |
| PATCH | `/api/v1/auth/password` | Bearer token + current password | Change password and revoke all refresh sessions |
| GET | `/api/v1/auth/mfa` | Bearer token | Read MFA state and remaining recovery-code count |
| POST | `/api/v1/auth/mfa/setup` | Bearer token + current password | Create an expiring authenticator setup |
| POST | `/api/v1/auth/mfa/enable` | Bearer token + TOTP | Enable MFA and return recovery codes once |
| POST | `/api/v1/auth/mfa/recovery-codes` | Bearer token + password + TOTP | Replace all recovery codes |
| POST | `/api/v1/auth/mfa/disable` | Bearer token + password + MFA code | Disable MFA and invalidate recovery codes |
| GET | `/api/v1/auth/sessions` | Bearer token | List active device sessions and mark the current session |
| DELETE | `/api/v1/auth/sessions/:sessionId` | Bearer token | Revoke one owned active device session |
| DELETE | `/api/v1/auth/sessions` | Bearer token | Revoke all active refresh sessions |
| GET | `/api/v1/auth/security-events` | Bearer token | List recent owner-scoped security activity |
| GET | `/api/v1/admin/users` | Admin bearer token | List and filter workspace members |
| GET | `/api/v1/admin/users/stats` | Admin bearer token | Read member, status, role, and verification totals |
| PATCH | `/api/v1/admin/users/:userId` | Admin bearer token | Change a member role or account status |
| GET | `/api/v1/admin/audit-events` | Admin bearer token | Filter and page platform-wide security events |
| GET | `/api/v1/admin/audit-events/stats` | Admin bearer token | Summarize audit activity for a time range |
| GET | `/api/v1/admin/audit-events/export` | Admin bearer token | Export filtered audit events as a bounded CSV file |
| GET | `/api/v1/admin/invitations` | Admin bearer token | List and filter member invitations |
| POST | `/api/v1/admin/invitations` | Admin bearer token | Create and email a member invitation |
| POST | `/api/v1/admin/invitations/:invitationId/resend` | Admin bearer token | Replace and resend an invitation link |
| DELETE | `/api/v1/admin/invitations/:invitationId` | Admin bearer token | Revoke an outstanding invitation |
| POST | `/api/v1/invitations/inspect` | Invitation token in body | Read an active invitation summary |
| POST | `/api/v1/invitations/accept` | Invitation token in body | Create an account from an invitation |
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
| POST | `/api/v1/conversations/:id/generate` | Bearer token | Send a user message to the configured FastGPT app and persist its reply |
| POST | `/api/v1/conversations/:id/messages/:messageId/retry` | Bearer token | Retry the latest failed assistant reply in place |

## Device sessions

`GET /api/v1/auth/sessions` returns `activeSessions`, `lastLoginAt`, `loginProtection`, and an ordered `items` list. Each active session includes its stable UUID, parsed device name and type, observed IP address, raw user agent, login time, recent authenticated activity, expiry time, and a `current` flag derived from the access token session claim.

Refresh-token rotation updates the existing session row with a new token hash instead of creating another device entry. Replaying the old refresh token still fails. `DELETE /api/v1/auth/sessions/:sessionId` only revokes an active session owned by the authenticated user and returns whether it was the current session; unknown, expired, revoked, and cross-user IDs all return `SESSION_NOT_FOUND`.

Each successful rotation stores only the previous token's SHA-256 hash until that token's original expiry. Replaying a retained token returns `REFRESH_TOKEN_REUSED`, revokes the session's newest refresh token in the same transaction, and immediately invalidates access tokens issued for that device. The first active-session detection also records a `refresh_token_reused` security event; repeated attempts cannot create unbounded duplicate events after the session is already revoked. Random, expired, and otherwise unknown tokens continue to return `INVALID_REFRESH_TOKEN`.

Every bearer-authenticated request validates the access token's session ID against the database. The session must belong to the token subject, remain unrevoked and unexpired, and belong to an active user. Logout, password changes, single-device revocation, and all-device revocation therefore invalidate existing access tokens immediately instead of waiting for their JWT expiry. Revoked sessions return `SESSION_REVOKED`; access tokens without a session claim return `INVALID_ACCESS_TOKEN`.

Authenticated requests also advance `last_used_at`, with writes limited to at most once per minute per session. This keeps the device list useful without writing the refresh-token row on every API call. The validation adds one indexed database lookup to protected requests, which is an intentional consistency tradeoff for immediate revocation.

Registration and login share a 30-request-per-minute credential limiter. Refresh and logout use a separate 60-request-per-minute session-credential limiter, so routine rotation cannot consume the login budget and login attempts cannot prevent an active user from ending a session. Authenticated profile, password, and session-management endpoints remain outside both credential budgets.

## Email verification

`POST /api/v1/auth/register` creates the account without a session and returns `{ "verificationRequired": true, "email", "expiresIn" }`. It sends a 48-byte random token only through email and stores only its SHA-256 hash. The default 24-hour lifetime is configurable from 1-168 hours with `EMAIL_VERIFICATION_TOKEN_TTL_HOURS`. Existing accounts are marked verified when migration `013_add_email_verification.sql` is first applied.

`POST /api/v1/auth/email-verification/confirm` accepts `{ "token": "..." }`. Confirmation locks the user and token rows, sets `email_verified_at`, consumes every outstanding link, and records `email_verified` in one transaction. Invalid, expired, consumed, and concurrent losing requests return `INVALID_EMAIL_VERIFICATION_TOKEN` without disclosing the reason.

`POST /api/v1/auth/email-verification/resend` accepts an email and always returns HTTP `202` with the same body for unknown, verified, disabled, and unverified accounts. Eligible accounts receive a new link and all older links become unusable. Requests are limited to five per 15 minutes per observed client. Correct-password login for an unverified account returns `EMAIL_VERIFICATION_REQUIRED` and creates no access token, refresh token, MFA challenge, or device session.

## Multi-factor authentication

MFA uses RFC 6238 TOTP with the standard 6-digit, 30-second authenticator profile. `POST /api/v1/auth/mfa/setup` requires the current password and returns an expiring QR data URL plus manual Base32 key. The pending secret and enabled secret are AES-256-GCM encrypted at rest. Setup expires after 10 minutes by default; only a valid current TOTP can enable it.

An MFA-enabled account receives `{ "mfaRequired": true, "mfaToken", "expiresIn" }` after valid password authentication. No access token, refresh token, or database session is created at that stage. `POST /api/v1/auth/mfa/verify` accepts the opaque challenge and either a current TOTP or unused recovery code. The challenge stores only a SHA-256 hash, expires after five minutes, permits five failed attempts, and is atomically consumed once. A successful recovery-code login atomically marks that code used.

Enabling MFA returns 10 high-entropy recovery codes exactly once; only their normalized SHA-256 hashes are stored. Regeneration invalidates every old code before returning a new set. Disabling accepts either a current TOTP or an unused recovery code. Setup, enable, disable, recovery-code replacement, failed MFA login, and successful MFA method are recorded without secret values. Enabling, disabling, and recovery-code replacement retain the authenticated current session but revoke every other active device session.

## Login protection

Login protection is account-scoped in addition to the request rate limiter. Within the default 15-minute failure window, five consecutive invalid-password attempts lock the account for 15 minutes. The threshold, window, and lockout duration are configurable through `LOGIN_FAILURE_LIMIT`, `LOGIN_FAILURE_WINDOW_MINUTES`, and `LOGIN_LOCKOUT_MINUTES`.

Attempts are serialized with a row lock so concurrent requests cannot bypass the threshold. Successful login and password changes clear the failure state. Unknown email addresses still receive the generic `INVALID_CREDENTIALS` response and execute a dummy bcrypt comparison to reduce account-enumeration timing differences.

The request that reaches the threshold and every request during the lockout return HTTP `423`, error code `ACCOUNT_TEMPORARILY_LOCKED`, a `Retry-After` header, and safe `lockedUntil` / `retryAfterSeconds` details. `GET /api/v1/auth/sessions` includes `loginProtection`, which reports the effective policy and current protected or locked state.

## Password history

`PATCH /api/v1/auth/password` rejects the current password with `PASSWORD_UNCHANGED` and rejects any other retained password with `PASSWORD_RECENTLY_USED`. The default `PASSWORD_HISTORY_LIMIT=5` covers the new password candidate against the current password plus the four preceding passwords; the limit accepts values from 2-10.

The user row is locked while the current password, strength policy, and retained bcrypt hashes are checked. A successful change writes the new hash, prunes older history, clears login-failure state, records the security event, and revokes every device session in the same transaction. A rejected change leaves the password, history, and sessions untouched. Only bcrypt hashes are retained; plaintext passwords are never stored or returned.

## Password reset

`POST /api/v1/auth/password-reset/request` accepts `{ "email": "..." }` and always returns HTTP `202` with the same body for active, disabled, and unknown accounts. Requests are limited to five per 15 minutes per observed client. For an active account, the API invalidates previous links, creates a 48-byte random token, stores only its SHA-256 hash, and sends the plaintext token only inside an SMTP-delivered link. The default expiry is 30 minutes and is configurable from 5-120 minutes with `PASSWORD_RESET_TOKEN_TTL_MINUTES`.

`POST /api/v1/auth/password-reset/confirm` accepts `{ "token": "...", "newPassword": "..." }`. Valid tokens are consumed once under row locks. The new password must pass the normal identity-aware strength policy and recent-password history check. Success updates the password, consumes all outstanding reset links, clears login lockout state, revokes every device session, and records `password_reset_completed` in one transaction. Invalid, expired, consumed, and concurrent losing requests all return `INVALID_PASSWORD_RESET_TOKEN` without disclosing the reason.

Local development sends mail to Mailpit at `localhost:1025`; its UI is available at `http://localhost:8025`. Production deployments configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, optional `SMTP_USER` / `SMTP_PASSWORD`, `MAIL_FROM`, and the public `WEB_BASE_URL` used in links. Password reset tokens and request bodies are redacted from API logs.

## Security activity

`GET /api/v1/auth/security-events?limit=20` returns the authenticated user's newest security events and the total retained count. `limit` defaults to 20 and accepts 1-50. Results include the event type, outcome, source device, observed API IP, actor and target session identifiers, safe metadata, and timestamp.

The audit trail covers account registration and email verification, successful login, failed login for an existing account, account lock and automatic unlock, profile updates, password changes, password-reset requests and completions, MFA setup/enable/disable/recovery-code changes and failed challenges, administrator role and status changes, refresh-token reuse detection, single-session revocation, all-session revocation, and explicit logout. Events for state-changing operations are written in the same database transaction as the protected change. Passwords, email-verification tokens, MFA secrets and codes, reset tokens, refresh tokens, access tokens, API keys, and request bodies are never stored in event metadata. Unknown-email login, email-verification resend, and password-reset requests are intentionally not persisted because no owner account exists for them.

## Administrator audit log

`GET /api/v1/admin/audit-events` exposes the platform-wide security timeline only after live administrator authorization. It accepts `page`, `pageSize`, `range=24h|7d|30d|90d|all`, optional exact `eventType`, optional `outcome=success|failure`, and `search`. Search covers affected members, resolved operators, invitation target emails, and observed IP addresses. Results are ordered by `(created_at, id)` descending and identify both the affected account and the operator resolved from the actor session or recorded administrator ID.

`GET /api/v1/admin/audit-events/stats` accepts the same `range` and returns total events, failed or blocked events, distinct affected members, and administrator actions. Migration `016_add_admin_audit_indexes.sql` adds global recent, event-type, and failed-event indexes without changing the append-only event payload. Audit responses contain only the existing allowlisted primitive metadata; passwords, access/refresh/invitation/reset/verification tokens, API keys, MFA secrets and codes, and request bodies are never recorded or returned.

`GET /api/v1/admin/audit-events/export` accepts the list filters except pagination and returns a UTF-8 BOM CSV attachment. Exports contain at most 10,000 newest matching rows and report the row count and truncation state in `X-Export-Row-Count` and `X-Export-Truncated`. Every cell is quoted, embedded quotes are escaped, and values beginning with spreadsheet formula prefixes (`=`, `+`, `-`, `@`, tab, or carriage return) receive a leading apostrophe. Export requests are limited to five per 15 minutes and record `admin_audit_exported` with filter presence, row count, and truncation state but never the search text or file contents.

## Member administration

The first active account in an empty workspace receives the `admin` role; migration `014_add_user_administration.sql` promotes the oldest active account when upgrading a workspace that has no active administrator. Later registrations receive `member`. Registration serializes this bootstrap decision with a PostgreSQL advisory transaction lock so concurrent first registrations cannot create multiple bootstrap administrators.

Admin endpoints verify the current `user_roles` rows on every request instead of trusting only the role claim embedded in an older access token. `GET /api/v1/admin/users` accepts `page`, `pageSize`, `search`, optional `status=active|disabled`, optional `role=admin|member`, and `sort=created_desc|last_login_desc|name_asc`. Each item includes verification and MFA state, current active-session count, last login, and a `current` marker. `GET /stats` returns `total`, `active`, `disabled`, `admins`, and `pendingVerification`.

`PATCH /api/v1/admin/users/:userId` accepts `role` and/or `status`. Administrators cannot change their own role or status, and the service preserves at least one active administrator under a serialized transaction. Every real role or status change revokes all target-device sessions immediately and records a target-scoped security event with the actor user/session identifiers. Repeating the current values is idempotent and does not manufacture audit events.

## Member invitations

Administrators can invite an unregistered normalized email as `member` or `admin`. Each create or resend operation generates a new 48-byte random token and stores only its SHA-256 hash. The default 72-hour lifetime is configurable from 1-168 hours with `MEMBER_INVITATION_TTL_HOURS`. A new invitation for the same email atomically revokes older outstanding invitations, while resend replaces the current hash and expiry in place. The API response never includes the plaintext token.

Invitation email is sent before `delivered_at` is recorded; public inspection and acceptance require that delivery marker. SMTP failures revoke the invite and return `INVITATION_DELIVERY_FAILED`, so a token from an uncertain delivery attempt cannot be used. Administrator invitation mutations are limited to 30 requests per 15 minutes. Creating an invitation for an existing account returns `USER_ALREADY_EXISTS`.

The browser submits invitation tokens only in redacted JSON request bodies to `/inspect` and `/accept`; API URLs and logs do not contain them. Invitation creation, resend, acceptance, and ordinary registration serialize on the normalized email with a transaction-scoped advisory lock. Ordinary registration revokes outstanding invitations for that email. Acceptance then locks the invitation row, validates the normal identity-aware strong-password policy, creates an already email-verified account with the invited role and first password-history record, consumes the invitation, and records both registration and invitation-acceptance events in one transaction. It does not create a login session. Invalid, expired, revoked, consumed, and concurrent losing tokens all return the generic `INVITATION_INVALID` response.

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

`POST /api/v1/conversations/:id/generate` accepts `{ "message": "..." }`. The owned conversation must be active, its app must not be disabled, and the app must have an encrypted FastGPT API Key. The API persists the user message and a pending assistant message before contacting FastGPT, sends up to the latest 30 completed system/user/assistant messages as context, then updates the assistant row with content, model, token usage, external message ID, latency, and provider metadata.

Message preparation locks the owned conversation and writes the user message plus pending assistant message in one transaction. A partial unique index permits only one pending assistant reply per conversation; overlapping requests return `GENERATION_IN_PROGRESS` without writing another user message.

`POST /api/v1/conversations/:id/messages/:messageId/retry` accepts no body. It only retries the latest message when that message is a failed assistant reply immediately preceded by a completed user message. The same assistant row and sequence number are reused, while `metadata.retryCount` and `metadata.previousErrors` retain the retry audit trail. Other messages return `MESSAGE_NOT_RETRYABLE`.

The FastGPT key is decrypted only inside the API process and is sent in the upstream `Authorization` header. It is never included in the browser response or stored message metadata. Upstream authentication, rate limiting, invalid responses, network failures, and timeouts use stable `FASTGPT_*` error codes; failed generations remain visible as failed assistant messages for auditability.

FastGPT calls use `FASTGPT_API_BASE_URL` (default `https://api.fastgpt.in/api/v1`) and `FASTGPT_TIMEOUT_MS` (default 30000). The endpoint currently uses non-streaming chat completions.

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

Registration passwords must contain 12-72 characters, fit within bcrypt's 72-byte UTF-8 limit, use at least three of uppercase letters, lowercase letters, numbers, and symbols, avoid common or predictable patterns, and exclude the submitted name and email prefix. Login remains compatible with accounts created before this policy. Password changes apply the same strength policy and also reject retained recent passwords.

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
