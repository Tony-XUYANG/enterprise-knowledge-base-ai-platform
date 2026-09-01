import type { NextFunction, Request, Response } from 'express';
import { query } from '../db/pool.js';
import { AppError } from '../errors/app-error.js';

export async function authorizeAdmin(
  request: Request,
  _response: Response,
  next: NextFunction,
): Promise<void> {
  if (!request.auth) {
    next(new AppError(401, 'AUTHENTICATION_REQUIRED', '请先登录'));
    return;
  }

  try {
    const result = await query<{ allowed: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = $1
            AND r.code = 'admin'
       ) AS allowed`,
      [request.auth.userId],
    );
    if (!result.rows[0]?.allowed) {
      throw new AppError(403, 'ADMIN_REQUIRED', '需要管理员权限');
    }
    next();
  } catch (error) {
    next(error);
  }
}
