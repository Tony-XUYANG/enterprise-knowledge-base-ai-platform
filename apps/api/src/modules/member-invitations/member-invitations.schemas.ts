import { z } from 'zod';
import { PASSWORD_MAX_CHARACTERS } from '../../security/password-policy.js';

export const invitationIdSchema = z.string().uuid();
export const invitationTokenSchema = z.string().min(40).max(200);
export const invitationRoleSchema = z.enum(['admin', 'member']);
export const invitationStatusSchema = z.enum(['pending', 'expired', 'accepted', 'revoked']);

export const createInvitationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  role: invitationRoleSchema.default('member'),
});

export const listInvitationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: invitationStatusSchema.optional(),
  search: z.string().trim().max(100).optional(),
});

export const acceptInvitationSchema = z.object({
  token: invitationTokenSchema,
  displayName: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(PASSWORD_MAX_CHARACTERS),
});

export type InvitationRole = z.infer<typeof invitationRoleSchema>;
export type InvitationStatus = z.infer<typeof invitationStatusSchema>;
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type ListInvitationsQuery = z.infer<typeof listInvitationsQuerySchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
