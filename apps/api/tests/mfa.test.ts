import { generate } from 'otplib';
import { describe, expect, it } from 'vitest';
import {
  createMfaChallengeToken,
  createRecoveryCodes,
  createTotpSecret,
  createTotpUri,
  hashMfaValue,
  normalizeRecoveryCode,
  verifyTotpCode,
} from '../src/security/mfa.js';

describe('MFA security utilities', () => {
  it('creates authenticator-compatible secrets and verifies TOTP codes', async () => {
    const secret = createTotpSecret();
    const code = await generate({ secret });

    expect(secret).toMatch(/^[A-Z2-7]+$/u);
    expect(createTotpUri(secret, 'user@example.com', 'KnowledgeHub')).toContain(
      'otpauth://totp/KnowledgeHub:user%40example.com',
    );
    await expect(verifyTotpCode(secret, code)).resolves.toBe(true);
    await expect(verifyTotpCode(secret, code === '000000' ? '111111' : '000000')).resolves.toBe(false);
  });

  it('creates high-entropy recovery codes and opaque challenge tokens', () => {
    const codes = createRecoveryCodes();
    const normalized = codes.map((code) => normalizeRecoveryCode(code));
    const challenges = new Set(Array.from({ length: 20 }, () => createMfaChallengeToken()));

    expect(codes).toHaveLength(10);
    expect(new Set(codes)).toHaveLength(10);
    expect(normalized.every((code) => code?.match(/^[A-F0-9]{20}$/u))).toBe(true);
    expect(normalizeRecoveryCode(codes[0]!.toLowerCase().replaceAll('-', ' '))).toBe(normalized[0]);
    expect(hashMfaValue(normalized[0]!)).toMatch(/^[a-f0-9]{64}$/u);
    expect(challenges.size).toBe(20);
    expect([...challenges].every((token) => token.length >= 40)).toBe(true);
  });
});
