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

export interface PasswordPolicyContext {
  email?: string;
  displayName?: string;
}

export interface PasswordAssessment {
  acceptable: boolean;
  characterCount: number;
  byteCount: number;
  categoryCount: number;
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

function identityFragments(context: PasswordPolicyContext): string[] {
  const emailPrefix = context.email?.split('@')[0] ?? '';
  return [emailPrefix, context.displayName ?? '']
    .map((value) => value.toLowerCase().replace(/\s+/g, ''))
    .filter((value) => characterCount(value) >= 2);
}

export function assessPassword(
  password: string,
  context: PasswordPolicyContext = {},
): PasswordAssessment {
  const length = characterCount(password);
  const byteCount = new TextEncoder().encode(password).length;
  const categories = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9\s]/.test(password),
  ].filter(Boolean).length;
  const normalized = password.toLowerCase();
  const alphanumeric = normalized.replace(/[^a-z0-9]/g, '');
  const isCommon =
    commonPasswords.has(alphanumeric) ||
    weakTerms.some((term) => normalized.includes(term));
  const hasSequence = predictableSequences.some((sequence) => normalized.includes(sequence));
  const hasRepetition = /([a-z0-9])\1{3,}/i.test(password);
  const comparablePassword = normalized.replace(/\s+/g, '');
  const containsIdentity = identityFragments(context).some((fragment) =>
    comparablePassword.includes(fragment),
  );

  const hasPassword = length > 0;
  const checks = {
    length: length >= PASSWORD_MIN_CHARACTERS && length <= PASSWORD_MAX_CHARACTERS,
    byteLimit: byteCount <= PASSWORD_MAX_BYTES,
    categories: categories >= PASSWORD_REQUIRED_CATEGORIES,
    unpredictable: hasPassword && !isCommon && !hasSequence && !hasRepetition,
    excludesIdentity: hasPassword && !containsIdentity,
  };

  return {
    acceptable: Object.values(checks).every(Boolean),
    characterCount: length,
    byteCount,
    categoryCount: categories,
    checks,
  };
}
