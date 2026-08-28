import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '../config/env.js';

export interface AccessTokenPayload {
  userId: string;
  roles: string[];
  sessionId?: string;
}

const secret = new TextEncoder().encode(env.JWT_SECRET);

export async function createAccessToken(payload: AccessTokenPayload): Promise<string> {
  return new SignJWT({ roles: payload.roles, sid: payload.sessionId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_MINUTES}m`)
    .setIssuer('knowledgehub-api')
    .setAudience('knowledgehub-web')
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, secret, {
    algorithms: ['HS256'],
    issuer: 'knowledgehub-api',
    audience: 'knowledgehub-web',
  });

  if (!payload.sub || !Array.isArray(payload.roles)) {
    throw new Error('Access token payload is incomplete');
  }

  return {
    userId: payload.sub,
    roles: payload.roles.filter((role): role is string => typeof role === 'string'),
    ...(typeof payload.sid === 'string' ? { sessionId: payload.sid } : {}),
  };
}

export function createRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function refreshTokenExpiresAt(): Date {
  const expiresAt = new Date();
  expiresAt.setUTCDate(expiresAt.getUTCDate() + env.REFRESH_TOKEN_TTL_DAYS);
  return expiresAt;
}
