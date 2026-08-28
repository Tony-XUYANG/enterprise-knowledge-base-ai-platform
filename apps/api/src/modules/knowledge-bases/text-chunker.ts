import { AppError } from '../../errors/app-error.js';

export const maxImportedChunkCount = 2000;

function normalizeText(content: string): string {
  return content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
}

function lastSentenceBoundary(text: string, start: number, end: number): number {
  for (let index = end - 1; index >= start; index -= 1) {
    const character = text[index];
    if (character && '。！？.!?；;'.includes(character)) return index + 1;
  }
  return -1;
}

function chooseChunkEnd(text: string, start: number, maximumEnd: number): number {
  if (maximumEnd >= text.length) return text.length;

  const minimumPreferredEnd = start + Math.floor((maximumEnd - start) * 0.5);
  const paragraphBoundary = text.lastIndexOf('\n\n', maximumEnd - 1);
  if (paragraphBoundary >= minimumPreferredEnd) return paragraphBoundary + 2;

  const lineBoundary = text.lastIndexOf('\n', maximumEnd - 1);
  if (lineBoundary >= minimumPreferredEnd) return lineBoundary + 1;

  const sentenceBoundary = lastSentenceBoundary(text, minimumPreferredEnd, maximumEnd);
  if (sentenceBoundary >= minimumPreferredEnd) return sentenceBoundary;

  const whitespaceBoundary = Math.max(
    text.lastIndexOf(' ', maximumEnd - 1),
    text.lastIndexOf('\t', maximumEnd - 1),
  );
  return whitespaceBoundary >= minimumPreferredEnd ? whitespaceBoundary + 1 : maximumEnd;
}

export function splitDocumentText(
  content: string,
  chunkSize: number,
  chunkOverlap: number,
): string[] {
  const normalized = normalizeText(content);
  if (!normalized) return [];

  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    const maximumEnd = Math.min(start + chunkSize, normalized.length);
    const end = chooseChunkEnd(normalized, start, maximumEnd);
    const chunk = normalized.slice(start, end).trim();
    if (chunk) chunks.push(chunk);

    if (chunks.length > maxImportedChunkCount) {
      throw new AppError(
        400,
        'DOCUMENT_CHUNK_LIMIT_EXCEEDED',
        `导入结果不能超过 ${maxImportedChunkCount} 个分块，请增大分块长度或减小重叠长度`,
      );
    }
    if (end >= normalized.length) break;

    start = Math.max(end - chunkOverlap, start + 1);
    while (start < end && /\s/u.test(normalized[start] ?? '')) start += 1;
  }

  return chunks;
}
