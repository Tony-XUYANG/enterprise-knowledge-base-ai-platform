import { z } from 'zod';

export const externalAppChatSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  conversationId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200).default('API 对话'),
});

export type ExternalAppChatInput = z.infer<typeof externalAppChatSchema>;
