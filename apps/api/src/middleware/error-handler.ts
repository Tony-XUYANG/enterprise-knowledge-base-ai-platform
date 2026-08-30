import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors/app-error.js';

export const notFoundHandler: RequestHandler = (request, _response, next) => {
  next(new AppError(404, 'ROUTE_NOT_FOUND', `接口不存在：${request.method} ${request.path}`));
};

export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') {
    response.status(413).json({
      error: {
        code: 'REQUEST_BODY_TOO_LARGE',
        message: '请求体不能超过 4 MB',
      },
    });
    return;
  }

  if (error instanceof ZodError) {
    response.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: '请求参数不合法',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }

  if (error instanceof AppError) {
    if (
      error.code === 'ACCOUNT_TEMPORARILY_LOCKED'
      && error.details
      && typeof error.details === 'object'
      && 'retryAfterSeconds' in error.details
      && typeof error.details.retryAfterSeconds === 'number'
    ) {
      response.setHeader('Retry-After', Math.ceil(error.details.retryAfterSeconds));
    }
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    });
    return;
  }

  if (error instanceof SyntaxError && 'body' in error) {
    response.status(400).json({
      error: {
        code: 'INVALID_JSON',
        message: '请求体不是有效的 JSON',
      },
    });
    return;
  }

  request.log.error({ err: error }, 'Unhandled request error');
  response.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: '服务器内部错误',
    },
  });
};
