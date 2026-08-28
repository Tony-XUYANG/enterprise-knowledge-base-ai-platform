import { z } from 'zod';

export const documentStatusSchema = z.enum([
  'pending',
  'processing',
  'ready',
  'failed',
  'disabled',
]);

export const documentSourceTypeSchema = z.enum(['file', 'url', 'text']);

const metadataSchema = z.record(z.string(), z.unknown());
const nullableUriSchema = z.string().trim().url().max(2000).nullable().optional();

export const createKnowledgeDocumentSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    sourceType: documentSourceTypeSchema.default('file'),
    sourceUri: nullableUriSchema,
    mimeType: z.string().trim().min(1).max(120).nullable().optional(),
    sizeBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
    checksumSha256: z.string().trim().toLowerCase().regex(/^[0-9a-f]{64}$/).nullable().optional(),
    fastgptCollectionId: z.string().trim().min(1).max(120).nullable().optional(),
    status: documentStatusSchema.default('pending'),
    errorMessage: z.string().trim().max(2000).nullable().optional(),
    metadata: metadataSchema.default({}),
  })
  .superRefine((input, context) => {
    if (input.sourceType === 'url' && !input.sourceUri) {
      context.addIssue({
        code: 'custom',
        path: ['sourceUri'],
        message: 'URL 来源必须提供来源地址',
      });
    }
  });

export const updateKnowledgeDocumentSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    sourceType: documentSourceTypeSchema.optional(),
    sourceUri: nullableUriSchema,
    mimeType: z.string().trim().min(1).max(120).nullable().optional(),
    sizeBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
    checksumSha256: z.string().trim().toLowerCase().regex(/^[0-9a-f]{64}$/).nullable().optional(),
    fastgptCollectionId: z.string().trim().min(1).max(120).nullable().optional(),
    status: documentStatusSchema.optional(),
    errorMessage: z.string().trim().max(2000).nullable().optional(),
    metadata: metadataSchema.optional(),
  })
  .superRefine((input, context) => {
    if (Object.keys(input).length === 0) {
      context.addIssue({ code: 'custom', message: '至少需要提供一个待更新字段' });
    }
    if (input.sourceType === 'url' && !input.sourceUri) {
      context.addIssue({
        code: 'custom',
        path: ['sourceUri'],
        message: 'URL 来源必须提供来源地址',
      });
    }
  });

export const listKnowledgeDocumentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: documentStatusSchema.optional(),
  search: z.string().trim().max(100).optional(),
  sort: z.enum(['updated_desc', 'created_desc', 'name_asc']).default('updated_desc'),
});

export const knowledgeDocumentIdSchema = z.string().uuid();

export type CreateKnowledgeDocumentInput = z.infer<typeof createKnowledgeDocumentSchema>;
export type UpdateKnowledgeDocumentInput = z.infer<typeof updateKnowledgeDocumentSchema>;
export type ListKnowledgeDocumentsQuery = z.infer<typeof listKnowledgeDocumentsQuerySchema>;
