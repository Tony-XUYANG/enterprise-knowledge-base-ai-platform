import { z } from 'zod';

export const knowledgeBaseStatusSchema = z.enum([
  'pending',
  'ready',
  'failed',
  'disabled',
]);

const metadataSchema = z.record(z.string(), z.unknown());

export const createKnowledgeBaseSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).nullable().optional(),
  fastgptDatasetId: z.string().trim().min(1).max(120).nullable().optional(),
  status: knowledgeBaseStatusSchema.default('pending'),
  metadata: metadataSchema.default({}),
});

export const updateKnowledgeBaseSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    fastgptDatasetId: z.string().trim().min(1).max(120).nullable().optional(),
    status: knowledgeBaseStatusSchema.optional(),
    metadata: metadataSchema.optional(),
  })
  .refine((input) => Object.keys(input).length > 0, '至少需要提供一个待更新字段');

export const listKnowledgeBasesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: knowledgeBaseStatusSchema.optional(),
  search: z.string().trim().max(100).optional(),
  sort: z.enum(['updated_desc', 'created_desc', 'name_asc']).default('updated_desc'),
});

export const knowledgeBaseIdSchema = z.string().uuid();

export type CreateKnowledgeBaseInput = z.infer<typeof createKnowledgeBaseSchema>;
export type UpdateKnowledgeBaseInput = z.infer<typeof updateKnowledgeBaseSchema>;
export type ListKnowledgeBasesQuery = z.infer<typeof listKnowledgeBasesQuerySchema>;
