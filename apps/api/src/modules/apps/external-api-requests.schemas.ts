import { z } from 'zod';

export const externalApiRequestListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  range: z.enum(['24h', '7d', '30d', '90d']).default('7d'),
  outcome: z.enum(['success', 'failure']).optional(),
  accessKeyId: z.string().uuid().optional(),
});

export type ExternalApiRequestListQuery = z.infer<
  typeof externalApiRequestListQuerySchema
>;
