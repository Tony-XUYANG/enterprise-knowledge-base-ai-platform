import { describe, expect, it } from 'vitest';
import { buildEmailVerificationMessage } from '../src/modules/auth/email-verification-mailer.js';

describe('email verification message', () => {
  it('builds safe text and HTML while preserving the verification URL', () => {
    const verificationUrl = 'http://localhost:3000/verify-email?token=test-token';
    const message = buildEmailVerificationMessage({
      email: 'owner@example.com',
      displayName: '<Owner & Admin>',
      verificationUrl,
      expiresInHours: 24,
    });

    expect(message.subject).toContain('KnowledgeHub');
    expect(message.text).toContain(verificationUrl);
    expect(message.text).toContain('24 小时');
    expect(message.html).toContain('&lt;Owner &amp; Admin&gt;');
    expect(message.html).not.toContain('<Owner & Admin>');
    expect(message.html).toContain('test-token');
  });
});
