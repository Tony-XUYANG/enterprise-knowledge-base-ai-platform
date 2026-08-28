import { describe, expect, it } from 'vitest';
import { assessPassword } from '../src/security/password-policy.js';

describe('password policy', () => {
  it('accepts a strong password and rejects predictable alternatives', () => {
    expect(assessPassword('Orbit!Cedar9Vault').acceptable).toBe(true);
    expect(assessPassword('Password123!').checks.unpredictable).toBe(false);
    expect(assessPassword('Abcd!Secure2026').checks.unpredictable).toBe(false);
    expect(assessPassword('AAAA!Secure2026').checks.unpredictable).toBe(false);
  });

  it('requires three character categories and excludes identity fragments', () => {
    expect(assessPassword('OnlyLettersLong').checks.categories).toBe(false);
    expect(
      assessPassword('Alice!Secure2026', {
        email: 'alice@example.com',
        displayName: 'Alice',
      }).checks.excludesIdentity,
    ).toBe(false);
  });

  it('enforces the bcrypt UTF-8 byte limit', () => {
    const multibytePassword = `Aa1!${'密'.repeat(23)}`;
    const assessment = assessPassword(multibytePassword);
    expect(assessment.characterCount).toBe(27);
    expect(assessment.byteCount).toBe(73);
    expect(assessment.checks.byteLimit).toBe(false);
    expect(assessment.acceptable).toBe(false);
  });
});
