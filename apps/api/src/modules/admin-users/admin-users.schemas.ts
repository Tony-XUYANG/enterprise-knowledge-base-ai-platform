import { z } from 'zod';

export const managedUserIdSchema = z.string().uuid();
export const managedUserRoleSchema = z.enum(['admin', 'member']);
export const managedUserStatusSchema = z.enum(['active', 'disabled']);

export const listManagedUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: managedUserStatusSchema.optional(),
  role: managedUserRoleSchema.optional(),
  search: z.string().trim().max(100).optional(),
  sort: z.enum(['created_desc', 'last_login_desc', 'name_asc']).default('created_desc'),
});

export const updateManagedUserSchema = z
  .object({
    role: managedUserRoleSchema.optional(),
    status: managedUserStatusSchema.optional(),
  })
  .refine((input) => Object.keys(input).length > 0, '至少需要提供一个待更新字段');

export type ListManagedUsersQuery = z.infer<typeof listManagedUsersQuerySchema>;
export type ManagedUserRole = z.infer<typeof managedUserRoleSchema>;
export type ManagedUserStatus = z.infer<typeof managedUserStatusSchema>;
export type UpdateManagedUserInput = z.infer<typeof updateManagedUserSchema>;
