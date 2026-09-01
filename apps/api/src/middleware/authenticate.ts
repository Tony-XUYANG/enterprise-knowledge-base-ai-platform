import type { NextFunction, Request, Response } from 'express';
import { query } from '../db/pool.js';
import { AppError } from '../errors/app-error.js';
import { verifyAccessToken, type AccessTokenPayload } from '../security/tokens.js';

interface AccessSessionRow {
  status: 'active' | 'disabled';
  email_verified_at: Date | null;
  last_used_at: Date;
}

const sessionActivityWriteIntervalMs = 60_000;

async function validateAccessSession(auth: AccessTokenPayload): Promise<void> {
  if (!auth.sessionId) {
    throw new AppError(401, 'INVALID_ACCESS_TOKEN', '访问令牌缺少会话信息');
  }

  const result = await query<AccessSessionRow>(
    `SELECT u.status, u.email_verified_at, rt.last_used_at
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
      WHERE rt.id = $1
        AND rt.user_id = $2
        AND rt.revoked_at IS NULL
        AND rt.expires_at > CURRENT_TIMESTAMP`,
    [auth.sessionId, auth.userId],
  );
  const session = result.rows[0];

  if (!session) {
    throw new AppError(401, 'SESSION_REVOKED', '登录会话已失效，请重新登录');
  }
  if (session.status !== 'active') {
    throw new AppError(403, 'USER_DISABLED', '账号已被停用');
  }
  if (!session.email_verified_at) {
    throw new AppError(403, 'EMAIL_VERIFICATION_REQUIRED', '请先完成邮箱验证');
  }

  if (Date.now() - session.last_used_at.getTime() < sessionActivityWriteIntervalMs) return;

  const touchResult = await query<{ id: string }>(
    `UPDATE refresh_tokens
        SET last_used_at = CURRENT_TIMESTAMP
      WHERE id = $1
        AND user_id = $2
        AND revoked_at IS NULL
        AND expires_at > CURRENT_TIMESTAMP
      RETURNING id`,
    [auth.sessionId, auth.userId],
  );
  if (touchResult.rowCount === 0) {
    throw new AppError(401, 'SESSION_REVOKED', '登录会话已失效，请重新登录');
  }
}

export async function authenticate(
  request: Request,
  _response: Response,
  next: NextFunction,
): Promise<void> {
  const authorization = request.header('authorization');

  if (!authorization?.startsWith('Bearer ')) {
    next(new AppError(401, 'AUTHENTICATION_REQUIRED', '请先登录'));
    return;
  }

  let auth: AccessTokenPayload;
  try {
    auth = await verifyAccessToken(authorization.slice(7));
  } catch {
    next(new AppError(401, 'INVALID_ACCESS_TOKEN', '访问令牌无效或已过期'));
    return;
  }

  try {
    await validateAccessSession(auth);
    request.auth = auth;
    next();
  } catch (error) {
    next(error);
  }
}
