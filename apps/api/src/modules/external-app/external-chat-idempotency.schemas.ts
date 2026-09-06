import { z } from 'zod';

export const externalIdempotencyKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[\x21-\x7e]+$/u, '幂等键只能包含可打印 ASCII 字符');

export type ExternalIdempotencyKey = z.infer<typeof externalIdempotencyKeySchema>;
