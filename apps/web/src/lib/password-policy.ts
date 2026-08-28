export const PASSWORD_MIN_CHARACTERS = 12;
export const PASSWORD_MAX_CHARACTERS = 72;
export const PASSWORD_MAX_BYTES = 72;
export const PASSWORD_REQUIRED_CATEGORIES = 3;

const commonPasswords = new Set([
  '12345678',
  '123456789',
  'abc123',
  'admin123',
  'iloveyou',
  'letmein',
  'password',
  'password1',
  'password123',
  'qwerty',
  'qwerty123',
  'welcome',
  'welcome123',
]);

const predictableSequences = [
  '0123',
  '1234',
  '2345',
  '3456',
  '4321',
  'abcd',
  'asdf',
  'qwerty',
  'zxcv',
];

const weakTerms = ['admin', 'iloveyou', 'letmein', 'password', 'qwerty', 'welcome'];

export type PasswordStrength = 'empty' | 'weak' | 'medium' | 'strong' | 'very-strong';

export interface PasswordAssessment {
  acceptable: boolean;
  strength: PasswordStrength;
  checks: {
    length: boolean;
    byteLimit: boolean;
    categories: boolean;
    unpredictable: boolean;
    excludesIdentity: boolean;
  };
}

function characterCount(value: string): number {
  return Array.from(value).length;
}

export function assessPassword(
  password: string,
  context: { email?: string; displayName?: string } = {},
): PasswordAssessment {
  const length = characterCount(password);
  const byteCount = new TextEncoder().encode(password).length;
  const categoryCount = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9\s]/.test(password),
  ].filter(Boolean).length;
  const normalized = password.toLowerCase();
  const alphanumeric = normalized.replace(/[^a-z0-9]/g, '');
  const identityFragments = [context.email?.split('@')[0] ?? '', context.displayName ?? '']
    .map((value) => value.toLowerCase().replace(/\s+/g, ''))
    .filter((value) => characterCount(value) >= 2);
  const hasPassword = length > 0;
  const checks = {
    length: length >= PASSWORD_MIN_CHARACTERS && length <= PASSWORD_MAX_CHARACTERS,
    byteLimit: byteCount <= PASSWORD_MAX_BYTES,
    categories: categoryCount >= PASSWORD_REQUIRED_CATEGORIES,
    unpredictable:
      hasPassword &&
      !commonPasswords.has(alphanumeric) &&
      !weakTerms.some((term) => normalized.includes(term)) &&
      !predictableSequences.some((sequence) => normalized.includes(sequence)) &&
      !/([a-z0-9])\1{3,}/i.test(password),
    excludesIdentity: hasPassword && !identityFragments.some((fragment) =>
      normalized.replace(/\s+/g, '').includes(fragment),
    ),
  };
  const acceptable = Object.values(checks).every(Boolean);

  let score = 0;
  if (length >= 8) score += 1;
  if (length >= PASSWORD_MIN_CHARACTERS) score += 1;
  if (length >= 16) score += 1;
  if (categoryCount >= 3) score += 1;
  if (categoryCount === 4) score += 1;
  if (!checks.unpredictable || !checks.excludesIdentity || !checks.byteLimit) score = Math.min(score, 1);

  const strength: PasswordStrength = password.length === 0
    ? 'empty'
    : acceptable && length >= 16 && categoryCount === 4
      ? 'very-strong'
      : acceptable
        ? 'strong'
        : score >= 2 && checks.unpredictable && checks.excludesIdentity
          ? 'medium'
          : 'weak';

  return { acceptable, strength, checks };
}
