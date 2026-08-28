import { z } from 'zod';

export const conversationStatusSchema = z.enum(['active', 'archived']);
export const messageRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);
export const messageStatusSchema = z.enum(['pending', 'completed', 'failed']);

export const conversationIdSchema = z.string().uuid();

export const createConversationSchema = z.object({
  appId: z.string().uuid(),
  title: z.string().trim().min(1).max(200).default('新对话'),
});

export const updateConversationSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    status: conversationStatusSchema.optional(),
  })
  .refine((input) => Object.keys(input).length > 0, '至少需要提供一个待更新字段');

export const listConversationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: conversationStatusSchema.optional(),
  appId: z.string().uuid().optional(),
  search: z.string().trim().max(200).optional(),
  sort: z.enum(['updated_desc', 'created_desc', 'title_asc']).default('updated_desc'),
});

export const createMessageSchema = z.object({
  role: messageRoleSchema,
  content: z.string().trim().min(1).max(20_000),
  status: messageStatusSchema.default('completed'),
  externalMessageId: z.string().trim().min(1).max(160).nullable().optional(),
  model: z.string().trim().min(1).max(100).nullable().optional(),
  promptTokens: z.number().int().min(0).nullable().optional(),
  completionTokens: z.number().int().min(0).nullable().optional(),
  latencyMs: z.number().int().min(0).nullable().optional(),
  errorCode: z.string().trim().min(1).max(100).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const generateConversationReplySchema = z.object({
  message: z.string().trim().min(1, '消息内容不能为空').max(4000),
});

export type CreateConversationInput = z.infer<typeof createConversationSchema>;
export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;
export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;
export type CreateMessageInput = z.infer<typeof createMessageSchema>;
export type GenerateConversationReplyInput = z.infer<typeof generateConversationReplySchema>;
