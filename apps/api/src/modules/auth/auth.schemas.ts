import { z } from 'zod';
import {
  assessPassword,
  PASSWORD_MAX_CHARACTERS,
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_CHARACTERS,
  PASSWORD_REQUIRED_CATEGORIES,
} from '../../security/password-policy.js';

export const registerSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
    password: z.string().min(1).max(PASSWORD_MAX_CHARACTERS),
    displayName: z.string().trim().min(1).max(80),
  })
  .superRefine((input, context) => {
    const assessment = assessPassword(input.password, input);
    const addPasswordIssue = (message: string) => {
      context.addIssue({ code: 'custom', path: ['password'], message });
    };

    if (!assessment.checks.length) {
      addPasswordIssue(
        `密码需要 ${PASSWORD_MIN_CHARACTERS}-${PASSWORD_MAX_CHARACTERS} 个字符`,
      );
    }
    if (!assessment.checks.byteLimit) {
      addPasswordIssue(`密码 UTF-8 编码不能超过 ${PASSWORD_MAX_BYTES} 字节`);
    }
    if (!assessment.checks.categories) {
      addPasswordIssue(
        `密码需要在大写字母、小写字母、数字和符号中至少包含 ${PASSWORD_REQUIRED_CATEGORIES} 类`,
      );
    }
    if (!assessment.checks.unpredictable) {
      addPasswordIssue('密码不能使用常见密码、连续字符或大量重复字符');
    }
    if (!assessment.checks.excludesIdentity) {
      addPasswordIssue('密码不能包含姓名或邮箱前缀');
    }
  });

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(1).max(72),
});

export const mfaLoginVerifySchema = z.object({
  mfaToken: z.string().min(32).max(200),
  code: z.string().trim().min(6).max(40),
});

export const mfaSetupSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_CHARACTERS),
});

export const mfaCodeSchema = z.object({
  code: z.string().trim().min(6).max(40),
});

export const mfaProtectedActionSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_CHARACTERS),
  code: z.string().trim().min(6).max(40),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(40).max(200),
});

export const passwordResetRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
});

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(40).max(200),
  newPassword: z.string().min(1).max(PASSWORD_MAX_CHARACTERS),
});

export const sessionIdSchema = z.string().uuid();

export const securityEventQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_CHARACTERS),
  newPassword: z.string().min(1).max(PASSWORD_MAX_CHARACTERS),
});

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type MfaLoginVerifyInput = z.infer<typeof mfaLoginVerifySchema>;
export type MfaSetupInput = z.infer<typeof mfaSetupSchema>;
export type MfaCodeInput = z.infer<typeof mfaCodeSchema>;
export type MfaProtectedActionInput = z.infer<typeof mfaProtectedActionSchema>;
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;
export type PasswordResetConfirmInput = z.infer<typeof passwordResetConfirmSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
