import { z } from 'zod';

export const supportedTextMimeTypes = [
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'application/json',
] as const;

export const maxBatchImportFiles = 10;
export const maxBatchImportBytes = 3 * 1024 * 1024;

const documentContentSchema = z
  .string()
  .min(1, '文档内容不能为空')
  .max(750_000, '文档内容不能超过 750000 个字符')
  .refine((content) => content.trim().length > 0, '文档内容不能为空');

export const importKnowledgeDocumentContentSchema = z
  .object({
    content: documentContentSchema,
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

export const batchImportKnowledgeDocumentsSchema = z
  .object({
    files: z.array(z.object({
      name: z.string().trim().min(1).max(255),
      content: documentContentSchema,
      mimeType: z.enum(supportedTextMimeTypes),
    })).min(1, '请至少选择一个文件').max(
      maxBatchImportFiles,
      `一次最多导入 ${maxBatchImportFiles} 个文件`,
    ),
    chunkSize: z.number().int().min(200).max(4000).default(1000),
    chunkOverlap: z.number().int().min(0).max(1000).default(100),
  })
  .superRefine((input, context) => {
    if (input.chunkOverlap >= input.chunkSize) {
      context.addIssue({
        code: 'custom',
        path: ['chunkOverlap'],
        message: '重叠长度必须小于分块长度',
      });
    }

    const seenNames = new Set<string>();
    input.files.forEach((file, index) => {
      const normalizedName = file.name.toLocaleLowerCase();
      if (seenNames.has(normalizedName)) {
        context.addIssue({
          code: 'custom',
          path: ['files', index, 'name'],
          message: '同一批次不能包含重名文件',
        });
      }
      seenNames.add(normalizedName);
    });

    const totalBytes = input.files.reduce(
      (total, file) => total + Buffer.byteLength(file.content, 'utf8'),
      0,
    );
    if (totalBytes > maxBatchImportBytes) {
      context.addIssue({
        code: 'custom',
        path: ['files'],
        message: `批量导入正文总计不能超过 ${maxBatchImportBytes} 字节`,
      });
    }
  });

export type ImportKnowledgeDocumentContentInput = z.infer<
  typeof importKnowledgeDocumentContentSchema
>;
export type BatchImportKnowledgeDocumentsInput = z.infer<
  typeof batchImportKnowledgeDocumentsSchema
>;
