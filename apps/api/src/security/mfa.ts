import { createHash, randomBytes } from 'node:crypto';
import { generateSecret, generateURI, verify } from 'otplib';

const recoveryCodePattern = /^[A-F0-9]{20}$/u;

export function createTotpSecret(): string {
  return generateSecret({ length: 20 });
}

export function createTotpUri(secret: string, accountLabel: string, issuer: string): string {
  return generateURI({ issuer, label: accountLabel, secret });
}

export async function verifyTotpCode(secret: string, code: string): Promise<boolean> {
  if (!/^\d{6}$/u.test(code)) return false;
  const result = await verify({ secret, token: code, epochTolerance: 30 });
  return result.valid;
}

export function createRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const value = randomBytes(10).toString('hex').toUpperCase();
    return value.match(/.{1,4}/gu)!.join('-');
  });
}

export function normalizeRecoveryCode(code: string): string | null {
  const normalized = code.replace(/[\s-]/gu, '').toUpperCase();
  return recoveryCodePattern.test(normalized) ? normalized : null;
}

export function hashMfaValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createMfaChallengeToken(): string {
  return randomBytes(32).toString('base64url');
}
