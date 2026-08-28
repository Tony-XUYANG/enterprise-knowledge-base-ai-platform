import { z } from 'zod';

const metadataSchema = z.record(z.string(), z.unknown());

export const createKnowledgeDocumentChunkSchema = z.object({
  content: z.string().trim().min(1).max(100_000),
  tokenCount: z.number().int().min(0).nullable().optional(),
  fastgptDataId: z.string().trim().min(1).max(160).nullable().optional(),
  metadata: metadataSchema.default({}),
});

export const updateKnowledgeDocumentChunkSchema = z
  .object({
    content: z.string().trim().min(1).max(100_000).optional(),
    tokenCount: z.number().int().min(0).nullable().optional(),
    fastgptDataId: z.string().trim().min(1).max(160).nullable().optional(),
    metadata: metadataSchema.optional(),
  })
  .refine((input) => Object.keys(input).length > 0, '至少需要提供一个待更新字段');

export const listKnowledgeDocumentChunksQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
});

export const knowledgeDocumentChunkIdSchema = z.string().uuid();

export type CreateKnowledgeDocumentChunkInput = z.infer<
  typeof createKnowledgeDocumentChunkSchema
>;
export type UpdateKnowledgeDocumentChunkInput = z.infer<
  typeof updateKnowledgeDocumentChunkSchema
>;
export type ListKnowledgeDocumentChunksQuery = z.infer<
  typeof listKnowledgeDocumentChunksQuerySchema
>;
