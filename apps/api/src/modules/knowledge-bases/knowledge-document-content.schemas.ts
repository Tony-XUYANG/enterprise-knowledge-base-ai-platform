import { z } from 'zod';

export const supportedTextMimeTypes = [
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'application/json',
] as const;

export const importKnowledgeDocumentContentSchema = z
  .object({
    content: z
      .string()
      .min(1, '文档内容不能为空')
      .max(750_000, '文档内容不能超过 750000 个字符')
      .refine((content) => content.trim().length > 0, '文档内容不能为空'),
    chunkSize: z.number().int().min(200).max(4000).default(1000),
    chunkOverlap: z.number().int().min(0).max(1000).default(100),
    mimeType: z.enum(supportedTextMimeTypes).default('text/plain'),
  })
  .superRefine((input, context) => {
    if (input.chunkOverlap >= input.chunkSize) {
      context.addIssue({
        code: 'custom',
        path: ['chunkOverlap'],
        message: '重叠长度必须小于分块长度',
      });
    }
  });

export type ImportKnowledgeDocumentContentInput = z.infer<
  typeof importKnowledgeDocumentContentSchema
>;
