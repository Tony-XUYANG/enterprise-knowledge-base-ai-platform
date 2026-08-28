export interface PostgreSqlError extends Error {
  code?: string;
  constraint?: string;
}

export function isPostgreSqlError(error: unknown): error is PostgreSqlError {
  return error instanceof Error && 'code' in error;
}
