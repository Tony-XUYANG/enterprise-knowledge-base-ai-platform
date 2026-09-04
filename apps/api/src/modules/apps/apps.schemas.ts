import { z } from 'zod';

export const appStatusSchema = z.enum(['draft', 'active', 'disabled']);

const settingsSchema = z.record(z.string(), z.unknown());

export const createAppSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).nullable().optional(),
  fastgptAppId: z.string().trim().min(1).max(120).nullable().optional(),
  fastgptApiKey: z.string().trim().min(8).max(1000).optional(),
  settings: settingsSchema.default({}),
  status: appStatusSchema.default('draft'),
});

export const updateAppSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    fastgptAppId: z.string().trim().min(1).max(120).nullable().optional(),
    fastgptApiKey: z.string().trim().min(8).max(1000).optional(),
    clearFastgptApiKey: z.literal(true).optional(),
    settings: settingsSchema.optional(),
    status: appStatusSchema.optional(),
  })
  .refine(
    (input) => !(input.fastgptApiKey && input.clearFastgptApiKey),
    { message: '不能同时设置和移除 FastGPT API Key', path: ['fastgptApiKey'] },
  )
  .refine((input) => Object.keys(input).length > 0, '至少需要提供一个待更新字段');

export const listAppsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: appStatusSchema.optional(),
  search: z.string().trim().max(100).optional(),
  sort: z.enum(['updated_desc', 'created_desc', 'name_asc']).default('updated_desc'),
});

export const appMetricsQuerySchema = z.object({
  range: z.enum(['7d', '30d', '90d']).default('30d'),
});

export const appIdSchema = z.string().uuid();

export type CreateAppInput = z.infer<typeof createAppSchema>;
export type UpdateAppInput = z.infer<typeof updateAppSchema>;
export type ListAppsQuery = z.infer<typeof listAppsQuerySchema>;
export type AppMetricsQuery = z.infer<typeof appMetricsQuerySchema>;
