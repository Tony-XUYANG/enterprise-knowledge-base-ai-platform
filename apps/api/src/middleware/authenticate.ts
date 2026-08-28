import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app-error.js';
import { verifyAccessToken } from '../security/tokens.js';

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

  try {
    request.auth = await verifyAccessToken(authorization.slice(7));
    next();
  } catch {
    next(new AppError(401, 'INVALID_ACCESS_TOKEN', '访问令牌无效或已过期'));
  }
}
