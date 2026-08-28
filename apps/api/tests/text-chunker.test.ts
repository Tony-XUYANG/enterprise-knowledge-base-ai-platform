import { describe, expect, it } from 'vitest';
import { importKnowledgeDocumentContentSchema } from '../src/modules/knowledge-bases/knowledge-document-content.schemas.js';
import { maxImportedChunkCount, splitDocumentText } from '../src/modules/knowledge-bases/text-chunker.js';

describe('document text chunking', () => {
  it('prefers meaningful boundaries and preserves non-whitespace content', () => {
    const content = [
      '第一段介绍退款申请的适用范围，并说明订单必须处于已签收状态。',
      '第二段列出审核所需的信息，包括订单号、付款凭证和退款原因。',
      '第三段说明审核通过后，款项会在三个工作日内原路退回。',
    ].join('\n\n');

    const chunks = splitDocumentText(content, 55, 0);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 55)).toBe(true);
    expect(chunks.join('').replace(/\s/gu, '')).toBe(content.replace(/\s/gu, ''));
    expect(chunks[0]).toMatch(/[。！？.!?]$/u);
  });

  it('creates deterministic character overlap without exceeding chunk size', () => {
    const content = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const chunks = splitDocumentText(content, 20, 5);

    expect(chunks).toHaveLength(4);
    expect(chunks.every((chunk) => chunk.length <= 20)).toBe(true);
    for (let index = 1; index < chunks.length; index += 1) {
      expect(chunks[index]!.slice(0, 5)).toBe(chunks[index - 1]!.slice(-5));
    }
    expect(splitDocumentText(content, 20, 5)).toEqual(chunks);
  });

  it('validates empty content and chunk settings', () => {
    expect(importKnowledgeDocumentContentSchema.safeParse({ content: '   ' }).success).toBe(false);
    expect(importKnowledgeDocumentContentSchema.safeParse({
      content: '有效内容',
      chunkSize: 199,
      chunkOverlap: 20,
    }).success).toBe(false);
    expect(importKnowledgeDocumentContentSchema.safeParse({
      content: '有效内容',
      chunkSize: 300,
      chunkOverlap: 300,
    }).success).toBe(false);
  });

  it('rejects imports that would create excessive chunks', () => {
    expect(() => splitDocumentText('x'.repeat(maxImportedChunkCount + 201), 200, 199))
      .toThrow(/不能超过 2000 个分块/);
  });
});
