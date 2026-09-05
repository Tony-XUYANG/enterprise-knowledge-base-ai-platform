import { createHash, randomBytes } from 'node:crypto';
import { isPostgreSqlError } from '../../db/pg-error.js';
import { query, withTransaction } from '../../db/pool.js';
import { AppError } from '../../errors/app-error.js';
import type { CreateAppAccessKeyInput } from './app-access-keys.schemas.js';

type AppAccessKeyStatus = 'active' | 'expired' | 'revoked';

interface AppAccessKeyRow {
  id: string;
  app_id: string;
  owner_id: string;
  name: string;
  key_prefix: string;
  last_used_at: Date | null;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

interface ResolvedAccessKeyRow {
  id: string;
  app_id: string;
  owner_id: string;
  name: string;
  key_prefix: string;
  app_status: 'draft' | 'active' | 'disabled';
  has_fastgpt_api_key: boolean;
  user_status: 'active' | 'disabled';
  email_verified_at: Date | null;
}

export interface AppAccessKey {
  id: string;
  appId: string;
  name: string;
  prefix: string;
  status: AppAccessKeyStatus;
  lastUsedAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface AppAccessContext {
  accessKeyId: string;
  accessKeyName: string;
  accessKeyPrefix: string;
  appId: string;
  ownerId: string;
}

const accessKeyPattern = /^kh_app_[A-Za-z0-9_-]{43}$/u;
const maximumUnrevokedKeys = 10;

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function createSecret(): string {
  return `kh_app_${randomBytes(32).toString('base64url')}`;
}

function statusOf(row: AppAccessKeyRow): AppAccessKeyStatus {
  if (row.revoked_at) return 'revoked';
  return row.expires_at.getTime() <= Date.now() ? 'expired' : 'active';
}

function mapAccessKey(row: AppAccessKeyRow): AppAccessKey {
  return {
    id: row.id,
    appId: row.app_id,
    name: row.name,
    prefix: row.key_prefix,
    status: statusOf(row),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    expiresAt: row.expires_at.toISOString(),
    revokedAt: row.revoked_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

function accessKeyWriteError(error: unknown): never {
  if (isPostgreSqlError(error) && error.code === '23505') {
    if (error.constraint === 'app_access_keys_active_name_unique_idx') {
      throw new AppError(409, 'APP_ACCESS_KEY_NAME_EXISTS', '应用中已存在同名的未撤销密钥');
    }
    throw new AppError(409, 'APP_ACCESS_KEY_CONFLICT', '访问密钥创建冲突，请重试');
  }
  throw error;
}

export async function listAppAccessKeys(
  ownerId: string,
  appId: string,
): Promise<AppAccessKey[]> {
  const appResult = await query(
    'SELECT 1 FROM ai_apps WHERE id = $1 AND owner_id = $2',
    [appId, ownerId],
  );
  if (!appResult.rows[0]) {
    throw new AppError(404, 'APP_NOT_FOUND', '应用不存在');
  }

  const result = await query<AppAccessKeyRow>(
    `SELECT id, app_id, owner_id, name, key_prefix, last_used_at,
            expires_at, revoked_at, created_at
       FROM app_access_keys
      WHERE app_id = $1 AND owner_id = $2
      ORDER BY (revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP) DESC,
               created_at DESC,
               id DESC
      LIMIT 50`,
    [appId, ownerId],
  );
  return result.rows.map(mapAccessKey);
}

export async function createAppAccessKey(
  ownerId: string,
  appId: string,
  input: CreateAppAccessKeyInput,
): Promise<{ accessKey: AppAccessKey; secret: string }> {
  try {
    return await withTransaction(async (client) => {
      const appResult = await client.query(
        `SELECT id FROM ai_apps
          WHERE id = $1 AND owner_id = $2
          FOR UPDATE`,
        [appId, ownerId],
      );
      if (!appResult.rows[0]) {
        throw new AppError(404, 'APP_NOT_FOUND', '应用不存在');
      }

      const countResult = await client.query<{ total: number }>(
        `SELECT count(*)::int AS total
           FROM app_access_keys
          WHERE app_id = $1
            AND owner_id = $2
            AND revoked_at IS NULL`,
        [appId, ownerId],
      );
      if ((countResult.rows[0]?.total ?? 0) >= maximumUnrevokedKeys) {
        throw new AppError(
          409,
          'APP_ACCESS_KEY_LIMIT_REACHED',
          `每个应用最多保留 ${maximumUnrevokedKeys} 个未撤销密钥`,
        );
      }

      const secret = createSecret();
      const result = await client.query<AppAccessKeyRow>(
        `INSERT INTO app_access_keys (
           app_id, owner_id, name, key_prefix, secret_hash, expires_at
         ) VALUES (
           $1, $2, $3, $4, $5,
           CURRENT_TIMESTAMP + ($6::int * INTERVAL '1 day')
         )
         RETURNING id, app_id, owner_id, name, key_prefix, last_used_at,
                   expires_at, revoked_at, created_at`,
        [appId, ownerId, input.name, secret.slice(0, 15), hashSecret(secret), input.expiresInDays],
      );
      return { accessKey: mapAccessKey(result.rows[0]!), secret };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    return accessKeyWriteError(error);
  }
}

export async function revokeAppAccessKey(
  ownerId: string,
  appId: string,
  accessKeyId: string,
): Promise<void> {
  const result = await query(
    `UPDATE app_access_keys access_key
        SET revoked_at = coalesce(access_key.revoked_at, CURRENT_TIMESTAMP)
      WHERE access_key.id = $1
        AND access_key.app_id = $2
        AND access_key.owner_id = $3
        AND EXISTS (
          SELECT 1 FROM ai_apps app
           WHERE app.id = $2 AND app.owner_id = $3
        )
      RETURNING access_key.id`,
    [accessKeyId, appId, ownerId],
  );
  if (!result.rows[0]) {
    throw new AppError(404, 'APP_ACCESS_KEY_NOT_FOUND', '访问密钥不存在');
  }
}

export async function resolveAppAccessKey(secret: string): Promise<AppAccessContext> {
  if (!accessKeyPattern.test(secret)) {
    throw new AppError(401, 'INVALID_APP_ACCESS_KEY', '应用访问密钥无效或已过期');
  }

  const result = await query<ResolvedAccessKeyRow>(
    `SELECT access_key.id, access_key.app_id, access_key.owner_id,
            access_key.name, access_key.key_prefix,
            app.status AS app_status,
            (app.fastgpt_api_key_ciphertext IS NOT NULL) AS has_fastgpt_api_key,
            owner.status AS user_status,
            owner.email_verified_at
       FROM app_access_keys access_key
       JOIN ai_apps app
         ON app.id = access_key.app_id AND app.owner_id = access_key.owner_id
       JOIN users owner ON owner.id = access_key.owner_id
      WHERE access_key.secret_hash = $1
        AND access_key.revoked_at IS NULL
        AND access_key.expires_at > CURRENT_TIMESTAMP`,
    [hashSecret(secret)],
  );
  const accessKey = result.rows[0];
  if (!accessKey || accessKey.user_status !== 'active' || !accessKey.email_verified_at) {
    throw new AppError(401, 'INVALID_APP_ACCESS_KEY', '应用访问密钥无效或已过期');
  }
  if (accessKey.app_status !== 'active') {
    throw new AppError(403, 'APP_NOT_ACTIVE', '应用尚未启用');
  }
  if (!accessKey.has_fastgpt_api_key) {
    throw new AppError(409, 'FASTGPT_NOT_CONFIGURED', '应用尚未配置 FastGPT API Key');
  }

  await query(
    `UPDATE app_access_keys
        SET last_used_at = CURRENT_TIMESTAMP
      WHERE id = $1
        AND (last_used_at IS NULL OR last_used_at < CURRENT_TIMESTAMP - INTERVAL '1 minute')`,
    [accessKey.id],
  );

  return {
    accessKeyId: accessKey.id,
    accessKeyName: accessKey.name,
    accessKeyPrefix: accessKey.key_prefix,
    appId: accessKey.app_id,
    ownerId: accessKey.owner_id,
  };
}
