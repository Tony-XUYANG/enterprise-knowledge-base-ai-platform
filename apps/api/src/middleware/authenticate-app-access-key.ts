import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app-error.js';
import { resolveAppAccessKey } from '../modules/apps/app-access-keys.service.js';

export async function authenticateAppAccessKey(
  request: Request,
  _response: Response,
  next: NextFunction,
): Promise<void> {
  const authorization = request.header('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    next(new AppError(401, 'APP_ACCESS_KEY_REQUIRED', '请提供应用访问密钥'));
    return;
  }

  try {
    request.appAccess = await resolveAppAccessKey(authorization.slice(7).trim());
    next();
  } catch (error) {
    next(error);
  }
}
