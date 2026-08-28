import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

const algorithm = 'aes-256-gcm';
const version = 'v1';
const encryptionKey = Buffer.from(env.DATA_ENCRYPTION_KEY, 'hex');

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, encryptionKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [version, iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')]
    .join(':');
}

export function decryptSecret(value: string): string {
  const [storedVersion, ivValue, authTagValue, ciphertextValue, ...extra] = value.split(':');
  if (
    storedVersion !== version ||
    !ivValue ||
    !authTagValue ||
    !ciphertextValue ||
    extra.length > 0
  ) {
    throw new Error('Encrypted secret has an unsupported format');
  }

  try {
    const decipher = createDecipheriv(
      algorithm,
      encryptionKey,
      Buffer.from(ivValue, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(authTagValue, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Encrypted secret could not be authenticated');
  }
}
