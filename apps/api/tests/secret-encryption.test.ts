import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../src/security/secret-encryption.js';

describe('secret encryption', () => {
  it('round-trips secrets without deterministic ciphertext', () => {
    const plaintext = 'fastgpt-test-secret-2026';
    const first = encryptSecret(plaintext);
    const second = encryptSecret(plaintext);

    expect(first).toMatch(/^v1:/);
    expect(first).not.toContain(plaintext);
    expect(second).not.toBe(first);
    expect(decryptSecret(first)).toBe(plaintext);
    expect(decryptSecret(second)).toBe(plaintext);
  });

  it('rejects modified ciphertext', () => {
    const encrypted = encryptSecret('fastgpt-test-secret-2026');
    expect(() => decryptSecret(`${encrypted.slice(0, -2)}AA`)).toThrow(
      'could not be authenticated',
    );
  });
});
