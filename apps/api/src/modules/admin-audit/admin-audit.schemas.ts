import { z } from 'zod';

export const adminAuditEventTypeSchema = z.enum([
  'account_registered',
  'login_succeeded',
  'login_failed',
  'account_locked',
  'account_unlocked',
  'profile_updated',
  'password_changed',
  'password_reset_requested',
  'password_reset_completed',
  'refresh_token_reused',
  'session_revoked',
  'all_sessions_revoked',
  'logout',
  'mfa_setup_started',
  'mfa_enabled',
  'mfa_disabled',
  'mfa_recovery_codes_regenerated',
  'mfa_login_failed',
  'email_verification_requested',
  'email_verified',
  'user_role_changed',
  'user_status_changed',
  'member_invitation_sent',
  'member_invitation_revoked',
  'member_invitation_accepted',
]);

export const adminAuditOutcomeSchema = z.enum(['success', 'failure']);
export const adminAuditRangeSchema = z.enum(['24h', '7d', '30d', '90d', 'all']);

export const listAdminAuditEventsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  range: adminAuditRangeSchema.default('30d'),
  eventType: adminAuditEventTypeSchema.optional(),
  outcome: adminAuditOutcomeSchema.optional(),
  search: z.string().trim().max(100).optional(),
});

export const adminAuditStatsQuerySchema = z.object({
  range: adminAuditRangeSchema.default('30d'),
});

export type AdminAuditEventType = z.infer<typeof adminAuditEventTypeSchema>;
export type AdminAuditOutcome = z.infer<typeof adminAuditOutcomeSchema>;
export type AdminAuditRange = z.infer<typeof adminAuditRangeSchema>;
export type ListAdminAuditEventsQuery = z.infer<typeof listAdminAuditEventsQuerySchema>;
