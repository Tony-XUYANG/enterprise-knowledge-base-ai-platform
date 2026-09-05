import { z } from 'zod';

export const appAccessKeyIdSchema = z.string().uuid();

export const createAppAccessKeySchema = z.object({
  name: z.string().trim().min(1).max(80),
  expiresInDays: z.number().int().min(1).max(365).default(90),
});

export type CreateAppAccessKeyInput = z.infer<typeof createAppAccessKeySchema>;
