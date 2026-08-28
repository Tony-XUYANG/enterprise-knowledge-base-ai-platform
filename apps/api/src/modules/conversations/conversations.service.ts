import { isPostgreSqlError } from '../../db/pg-error.js';
import { query, withTransaction } from '../../db/pool.js';
import { AppError } from '../../errors/app-error.js';
import type {
  CreateConversationInput,
  CreateMessageInput,
  ListConversationsQuery,
  UpdateConversationInput,
} from './conversations.schemas.js';

type ConversationStatus = 'active' | 'archived';
type MessageRole = 'system' | 'user' | 'assistant' | 'tool';
type MessageStatus = 'pending' | 'completed' | 'failed';

interface ConversationRow {
  id: string;
  app_id: string;
  app_name: string;
  user_id: string;
  title: string;
  status: ConversationStatus;
  message_count: number;
  last_message_preview: string | null;
  last_message_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sequence_no: number;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  external_message_id: string | null;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  latency_ms: number | null;
  error_code: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface Conversation {
  id: string;
  appId: string;
  appName: string;
  userId: string;
  title: string;
  status: ConversationStatus;
  messageCount: number;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  sequenceNo: number;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  externalMessageId: string | null;
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number | null;
  errorCode: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

const conversationColumns = `
  conversation.id, conversation.app_id, app.name AS app_name,
  conversation.user_id, conversation.title, conversation.status,
  count(message.id)::int AS message_count,
  latest_message.content AS last_message_preview,
  conversation.last_message_at, conversation.created_at, conversation.updated_at
`;

const conversationSortExpressions: Record<ListConversationsQuery['sort'], string> = {
  updated_desc: 'conversation.updated_at DESC, conversation.id DESC',
  created_desc: 'conversation.created_at DESC, conversation.id DESC',
  title_asc: 'conversation.title ASC, conversation.id ASC',
};

function mapConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    appId: row.app_id,
    appName: row.app_name,
    userId: row.user_id,
    title: row.title,
    status: row.status,
    messageCount: row.message_count,
    lastMessagePreview: row.last_message_preview,
    lastMessageAt: row.last_message_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapMessage(row: MessageRow): ConversationMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    sequenceNo: row.sequence_no,
    role: row.role,
    content: row.content,
    status: row.status,
    externalMessageId: row.external_message_id,
    model: row.model,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    latencyMs: row.latency_ms,
    errorCode: row.error_code,
    metadata: row.metadata,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listConversations(
  ownerId: string,
  input: ListConversationsQuery,
): Promise<{ items: Conversation[]; page: number; pageSize: number; total: number }> {
  const offset = (input.page - 1) * input.pageSize;
  const values = [
    ownerId,
    input.status ?? null,
    input.appId ?? null,
    input.search || null,
  ];
  const filters = `
    conversation.user_id = $1
    AND ($2::varchar IS NULL OR conversation.status = $2)
    AND ($3::uuid IS NULL OR conversation.app_id = $3)
    AND (
      $4::varchar IS NULL
      OR conversation.title ILIKE '%' || $4 || '%'
      OR app.name ILIKE '%' || $4 || '%'
      OR EXISTS (
        SELECT 1 FROM messages searchable_message
         WHERE searchable_message.conversation_id = conversation.id
           AND searchable_message.content ILIKE '%' || $4 || '%'
      )
    )`;

  const [itemsResult, countResult] = await Promise.all([
    query<ConversationRow>(
      `SELECT ${conversationColumns}
         FROM conversations conversation
         JOIN ai_apps app ON app.id = conversation.app_id
         LEFT JOIN messages message ON message.conversation_id = conversation.id
         LEFT JOIN LATERAL (
           SELECT content
             FROM messages recent_message
            WHERE recent_message.conversation_id = conversation.id
            ORDER BY recent_message.sequence_no DESC
            LIMIT 1
         ) latest_message ON true
        WHERE ${filters}
        GROUP BY conversation.id, app.name, latest_message.content
        ORDER BY ${conversationSortExpressions[input.sort]}
        LIMIT $5 OFFSET $6`,
      [...values, input.pageSize, offset],
    ),
    query<{ total: number }>(
      `SELECT count(*)::int AS total
         FROM conversations conversation
         JOIN ai_apps app ON app.id = conversation.app_id
        WHERE ${filters}`,
      values,
    ),
  ]);

  return {
    items: itemsResult.rows.map(mapConversation),
    page: input.page,
    pageSize: input.pageSize,
    total: countResult.rows[0]?.total ?? 0,
  };
}

export interface ConversationStats {
  total: number;
  active: number;
  archived: number;
  messages: number;
}

export async function getConversationStats(ownerId: string): Promise<ConversationStats> {
  const result = await query<ConversationStats>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE conversation.status = 'active')::int AS active,
            count(*) FILTER (WHERE conversation.status = 'archived')::int AS archived,
            (
              SELECT count(*)::int
                FROM messages message
                JOIN conversations owned_conversation
                  ON owned_conversation.id = message.conversation_id
               WHERE owned_conversation.user_id = $1
            ) AS messages
       FROM conversations conversation
      WHERE conversation.user_id = $1`,
    [ownerId],
  );
  return result.rows[0] ?? { total: 0, active: 0, archived: 0, messages: 0 };
}

export async function createConversation(
  ownerId: string,
  input: CreateConversationInput,
): Promise<Conversation> {
  const result = await query<{ id: string }>(
    `INSERT INTO conversations (app_id, user_id, title)
     SELECT app.id, $1, $3
       FROM ai_apps app
      WHERE app.id = $2 AND app.owner_id = $1
     RETURNING id`,
    [ownerId, input.appId, input.title],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new AppError(404, 'APP_NOT_FOUND', '应用不存在');
  return (await getConversation(ownerId, id)).conversation;
}

export async function getConversation(ownerId: string, conversationId: string) {
  const conversationResult = await query<ConversationRow>(
    `SELECT ${conversationColumns}
       FROM conversations conversation
       JOIN ai_apps app ON app.id = conversation.app_id
       LEFT JOIN messages message ON message.conversation_id = conversation.id
       LEFT JOIN LATERAL (
         SELECT content
           FROM messages recent_message
          WHERE recent_message.conversation_id = conversation.id
          ORDER BY recent_message.sequence_no DESC
          LIMIT 1
       ) latest_message ON true
      WHERE conversation.id = $1 AND conversation.user_id = $2
      GROUP BY conversation.id, app.name, latest_message.content`,
    [conversationId, ownerId],
  );
  const row = conversationResult.rows[0];
  if (!row) throw new AppError(404, 'CONVERSATION_NOT_FOUND', '对话不存在');

  const messagesResult = await query<MessageRow>(
    `SELECT message.*
       FROM messages message
       JOIN conversations conversation ON conversation.id = message.conversation_id
      WHERE conversation.id = $1 AND conversation.user_id = $2
      ORDER BY message.sequence_no ASC`,
    [conversationId, ownerId],
  );

  return {
    conversation: mapConversation(row),
    messages: messagesResult.rows.map(mapMessage),
  };
}

export async function updateConversation(
  ownerId: string,
  conversationId: string,
  input: UpdateConversationInput,
): Promise<Conversation> {
  const assignments: string[] = [];
  const values: unknown[] = [];
  if (input.title !== undefined) {
    values.push(input.title);
    assignments.push(`title = $${values.length}`);
  }
  if (input.status !== undefined) {
    values.push(input.status);
    assignments.push(`status = $${values.length}`);
  }
  values.push(conversationId, ownerId);
  const result = await query<{ id: string }>(
    `UPDATE conversations
        SET ${assignments.join(', ')}
      WHERE id = $${values.length - 1} AND user_id = $${values.length}
    RETURNING id`,
    values,
  );
  if (!result.rows[0]) {
    throw new AppError(404, 'CONVERSATION_NOT_FOUND', '对话不存在');
  }
  return (await getConversation(ownerId, conversationId)).conversation;
}

export async function archiveConversation(
  ownerId: string,
  conversationId: string,
): Promise<void> {
  const result = await query(
    `UPDATE conversations SET status = 'archived'
      WHERE id = $1 AND user_id = $2`,
    [conversationId, ownerId],
  );
  if (result.rowCount === 0) {
    throw new AppError(404, 'CONVERSATION_NOT_FOUND', '对话不存在');
  }
}

export async function createMessage(
  ownerId: string,
  conversationId: string,
  input: CreateMessageInput,
): Promise<ConversationMessage> {
  try {
    return await withTransaction(async (client) => {
      const conversationResult = await client.query<{ id: string; status: ConversationStatus }>(
        `SELECT id, status FROM conversations
          WHERE id = $1 AND user_id = $2
          FOR UPDATE`,
        [conversationId, ownerId],
      );
      const conversation = conversationResult.rows[0];
      if (!conversation) {
        throw new AppError(404, 'CONVERSATION_NOT_FOUND', '对话不存在');
      }
      if (conversation.status === 'archived') {
        throw new AppError(409, 'CONVERSATION_ARCHIVED', '已归档对话不能新增消息');
      }

      const messageResult = await client.query<MessageRow>(
        `INSERT INTO messages (
           conversation_id, sequence_no, role, content, status,
           external_message_id, model, prompt_tokens, completion_tokens,
           latency_ms, error_code, metadata
         )
         SELECT $1, coalesce(max(sequence_no), 0) + 1, $2, $3, $4,
                $5, $6, $7, $8, $9, $10, $11::jsonb
           FROM messages
          WHERE conversation_id = $1
         RETURNING *`,
        [
          conversationId,
          input.role,
          input.content,
          input.status,
          input.externalMessageId ?? null,
          input.model ?? null,
          input.promptTokens ?? null,
          input.completionTokens ?? null,
          input.latencyMs ?? null,
          input.errorCode ?? null,
          JSON.stringify(input.metadata),
        ],
      );
      const message = messageResult.rows[0]!;
      await client.query(
        `UPDATE conversations
            SET last_message_at = $1
          WHERE id = $2`,
        [message.created_at, conversationId],
      );
      return mapMessage(message);
    });
  } catch (error) {
    if (isPostgreSqlError(error) && error.code === '23505') {
      throw new AppError(409, 'MESSAGE_ALREADY_EXISTS', '外部消息 ID 已存在');
    }
    throw error;
  }
}
