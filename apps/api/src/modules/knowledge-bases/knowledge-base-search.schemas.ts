import { z } from 'zod';

export const searchKnowledgeBaseSchema = z.object({
  query: z.string().trim().min(1, '检索内容不能为空').max(200),
  limit: z.number().int().min(1).max(20).default(8),
  minScore: z.number().min(0).max(1).default(0.15),
});

export type SearchKnowledgeBaseInput = z.infer<typeof searchKnowledgeBaseSchema>;
