'use client';

import {
  Check,
  CircleAlert,
  Clock3,
  Copy,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { ClientApiError, clientApi } from '@/lib/client-api';
import type { AiApp, AppAccessKey, CreatedAppAccessKey } from '@/lib/types';

const statusLabels: Record<AppAccessKey['status'], string> = {
  active: '有效',
  expired: '已过期',
  revoked: '已撤销',
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function AppAccessKeysDialog({
  open,
  app,
  onClose,
  onChanged,
}: {
  open: boolean;
  app: AiApp | null;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const router = useRouter();
  const [items, setItems] = useState<AppAccessKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [expiresInDays, setExpiresInDays] = useState(90);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedAppAccessKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmingRevokeId, setConfirmingRevokeId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const handleApiError = useCallback((requestError: unknown, fallback: string) => {
    if (requestError instanceof ClientApiError && requestError.status === 401) {
      router.replace('/login');
      router.refresh();
      return;
    }
    setError(requestError instanceof ClientApiError ? requestError.message : fallback);
  }, [router]);

  const loadKeys = useCallback(async (signal?: AbortSignal) => {
    if (!open || !app) return;
    setLoading(true);
    setError('');
    try {
      setItems(await clientApi<AppAccessKey[]>(
        `/api/apps/${app.id}/access-keys`,
        { signal },
      ));
    } catch (requestError) {
      if (signal?.aborted) return;
      handleApiError(requestError, '访问密钥加载失败，请稍后重试');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [app, handleApiError, open]);

  useEffect(() => {
    if (!open) return;
    setItems([]);
    setName('');
    setExpiresInDays(90);
    setCreated(null);
    setCopied(false);
    setConfirmingRevokeId(null);
    setError('');
    const controller = new AbortController();
    void loadKeys(controller.signal);
    return () => controller.abort();
  }, [loadKeys, open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !creating && !revokingId) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [creating, onClose, open, revokingId]);

  if (!open || !app) return null;
  const appId = app.id;

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError('');
    try {
      const result = await clientApi<CreatedAppAccessKey>(
        `/api/apps/${appId}/access-keys`,
        {
          method: 'POST',
          body: JSON.stringify({ name, expiresInDays }),
        },
      );
      setCreated(result);
      setCopied(false);
      setItems((current) => [result.accessKey, ...current]);
      setName('');
      onChanged('访问密钥已创建');
    } catch (requestError) {
      handleApiError(requestError, '访问密钥创建失败，请稍后重试');
    } finally {
      setCreating(false);
    }
  }

  async function copySecret() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.secret);
      setCopied(true);
    } catch {
      setError('复制失败，请手动选择并复制密钥');
    }
  }

  async function revokeKey(accessKeyId: string) {
    setRevokingId(accessKeyId);
    setError('');
    try {
      await clientApi<void>(`/api/apps/${appId}/access-keys/${accessKeyId}`, {
        method: 'DELETE',
      });
      setItems((current) => current.map((item) => (
        item.id === accessKeyId
          ? { ...item, status: 'revoked', revokedAt: new Date().toISOString() }
          : item
      )));
      setConfirmingRevokeId(null);
      onChanged('访问密钥已撤销');
    } catch (requestError) {
      handleApiError(requestError, '访问密钥撤销失败，请稍后重试');
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="dialogBackdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !creating && !revokingId) onClose();
    }}>
      <section className="dialogPanel appAccessKeysDialog" role="dialog" aria-modal="true" aria-labelledby="app-access-keys-title">
        <header className="dialogHeader appAccessKeysHeader">
          <div className="dialogTitleWithIcon">
            <span className="appAccessKeysTitleIcon" aria-hidden="true"><KeyRound size={18} /></span>
            <span>
              <h2 id="app-access-keys-title">访问密钥</h2>
              <small>{app.name}</small>
            </span>
          </div>
          <button className="iconButton" type="button" onClick={onClose} disabled={creating || Boolean(revokingId)} aria-label="关闭" title="关闭">
            <X size={19} />
          </button>
        </header>

        <div className="appAccessKeysBody">
          <form className="appAccessKeyCreate" onSubmit={createKey}>
            <label className="field">
              <span>密钥名称</span>
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="例如：生产客服门户" required />
            </label>
            <label className="field">
              <span>有效期</span>
              <select value={expiresInDays} onChange={(event) => setExpiresInDays(Number(event.target.value))}>
                <option value={30}>30 天</option>
                <option value={90}>90 天</option>
                <option value={180}>180 天</option>
                <option value={365}>365 天</option>
              </select>
            </label>
            <button className="primaryButton" type="submit" disabled={creating || !name.trim()}>
              {creating ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}
              {creating ? '创建中' : '创建密钥'}
            </button>
          </form>

          {created && (
            <section className="createdAccessKey" aria-label="新访问密钥">
              <header>
                <span><ShieldCheck size={17} />密钥已创建</span>
                <small>关闭后无法再次查看</small>
              </header>
              <div>
                <code>{created.secret}</code>
                <button className="iconButton" type="button" onClick={() => void copySecret()} aria-label="复制访问密钥" title="复制访问密钥">
                  {copied ? <Check size={17} /> : <Copy size={17} />}
                </button>
              </div>
            </section>
          )}

          {error && (
            <div className="errorBanner appAccessKeyError" role="alert">
              <span>{error}</span>
              <button className="textButton" type="button" onClick={() => void loadKeys()}><RefreshCw size={15} />刷新</button>
            </div>
          )}

          <section className="appAccessKeyListSection" aria-labelledby="app-access-key-list-title">
            <header>
              <div>
                <h3 id="app-access-key-list-title">密钥记录</h3>
                <span>最多保留 10 个未撤销密钥</span>
              </div>
              <b>{items.filter((item) => item.status === 'active').length} 个有效</b>
            </header>

            {loading && items.length === 0 ? (
              <div className="appAccessKeysLoading"><LoaderCircle className="spin" size={20} />正在加载密钥</div>
            ) : items.length === 0 ? (
              <div className="appAccessKeysEmpty"><KeyRound size={21} />暂无访问密钥</div>
            ) : (
              <div className="appAccessKeyList">
                {items.map((item) => (
                  <article className="appAccessKeyRow" key={item.id}>
                    <span className="appAccessKeyIcon" aria-hidden="true"><KeyRound size={16} /></span>
                    <span className="appAccessKeyIdentity">
                      <strong>{item.name}</strong>
                      <code>{item.prefix}••••••••</code>
                    </span>
                    <span className="appAccessKeyDates">
                      <span><Clock3 size={12} />到期 {formatDate(item.expiresAt)}</span>
                      <small>{item.lastUsedAt ? `最近使用 ${formatDate(item.lastUsedAt)}` : '尚未使用'}</small>
                    </span>
                    <span className={`appAccessKeyStatus appAccessKeyStatus-${item.status}`}>{statusLabels[item.status]}</span>
                    {item.status === 'revoked' ? (
                      <span className="appAccessKeyRevokedAt">{item.revokedAt ? formatDate(item.revokedAt) : ''}</span>
                    ) : confirmingRevokeId === item.id ? (
                      <span className="appAccessKeyRevokeConfirm">
                        <button className="dangerButton compactAction" type="button" onClick={() => void revokeKey(item.id)} disabled={revokingId === item.id}>
                          {revokingId === item.id ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />}确认
                        </button>
                        <button className="textButton" type="button" onClick={() => setConfirmingRevokeId(null)} disabled={Boolean(revokingId)}>取消</button>
                      </span>
                    ) : (
                      <button className="iconButton dangerHover" type="button" onClick={() => setConfirmingRevokeId(item.id)} aria-label={`撤销 ${item.name}`} title="撤销密钥">
                        <Trash2 size={16} />
                      </button>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>

          <div className="appAccessKeySecurityNote">
            <CircleAlert size={15} />撤销或过期后，使用该密钥的外部请求将立即失效。
          </div>
        </div>
      </section>
    </div>
  );
}
