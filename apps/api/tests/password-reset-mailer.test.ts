import { describe, expect, it } from 'vitest';
import { buildPasswordResetEmail } from '../src/modules/auth/password-reset-mailer.js';

describe('password reset email', () => {
  it('builds a safe text and HTML message without losing the reset URL', () => {
    const resetUrl = 'http://localhost:3000/reset-password?token=test-token';
    const message = buildPasswordResetEmail({
      email: 'owner@example.com',
      displayName: '<Owner & Admin>',
      resetUrl,
      expiresInMinutes: 30,
    });

    expect(message.subject).toContain('KnowledgeHub');
    expect(message.text).toContain(resetUrl);
    expect(message.text).toContain('30 分钟');
    expect(message.html).toContain('&lt;Owner &amp; Admin&gt;');
    expect(message.html).not.toContain('<Owner & Admin>');
    expect(message.html).toContain('test-token');
  });
});
