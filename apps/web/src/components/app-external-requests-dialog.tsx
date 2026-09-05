'use client';

import {
  Activity,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  X,
  Zap,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClientApiError, clientApi } from '@/lib/client-api';
import type {
  AiApp,
  AppAccessKey,
  ExternalApiRequestList,
  ExternalApiRequestOutcome,
  ExternalApiRequestRange,
} from '@/lib/types';

const pageSize = 12;

const rangeOptions: Array<{ value: ExternalApiRequestRange; label: string }> = [
  { value: '24h', label: '24 小时' },
  { value: '7d', label: '7 天' },
  { value: '30d', label: '30 天' },
  { value: '90d', label: '90 天' },
];

function emptyData(range: ExternalApiRequestRange = '7d'): ExternalApiRequestList {
  return {
    items: [],
    page: 1,
    pageSize,
    total: 0,
    range,
    summary: {
      calls: 0,
      successes: 0,
      failures: 0,
      successRate: 0,
      averageLatencyMs: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    },
  };
}

const numberFormatter = new Intl.NumberFormat('zh-CN');

function formatLatency(value: number): string {
  if (value <= 0) return '--';
  if (value >= 1000) return `${(value / 1000).toFixed(1)} 秒`;
  return `${value} ms`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

export function AppExternalRequestsDialog({
  open,
  app,
  onClose,
}: {
  open: boolean;
  app: AiApp | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<ExternalApiRequestList>(emptyData());
  const [keys, setKeys] = useState<AppAccessKey[]>([]);
  const [range, setRange] = useState<ExternalApiRequestRange>('7d');
  const [outcome, setOutcome] = useState<'all' | ExternalApiRequestOutcome>('all');
  const [accessKeyId, setAccessKeyId] = useState('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const handleApiError = useCallback((requestError: unknown) => {
    if (requestError instanceof ClientApiError && requestError.status === 401) {
      router.replace('/login');
      router.refresh();
      return;
    }
    setError(
      requestError instanceof ClientApiError
        ? requestError.message
        : '调用日志加载失败，请稍后重试',
    );
  }, [router]);

  useEffect(() => {
    if (!open || !app) return;
    setRange('7d');
    setOutcome('all');
    setAccessKeyId('all');
    setPage(1);
    setData(emptyData());
    setKeys([]);
    setError('');
    const controller = new AbortController();
    void clientApi<AppAccessKey[]>(`/api/apps/${app.id}/access-keys`, {
      signal: controller.signal,
    }).then(setKeys).catch((requestError: unknown) => {
      if (!controller.signal.aborted) handleApiError(requestError);
    });
    return () => controller.abort();
  }, [app, handleApiError, open]);

  useEffect(() => {
    if (!open || !app) return;
    const controller = new AbortController();
    const parameters = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      range,
    });
    if (outcome !== 'all') parameters.set('outcome', outcome);
    if (accessKeyId !== 'all') parameters.set('accessKeyId', accessKeyId);

    setLoading(true);
    setError('');
    void clientApi<ExternalApiRequestList>(
      `/api/apps/${app.id}/external-requests?${parameters}`,
      { signal: controller.signal },
    ).then(setData).catch((requestError: unknown) => {
      if (!controller.signal.aborted) handleApiError(requestError);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [accessKeyId, app, handleApiError, open, outcome, page, range, reloadKey]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
  const visibleKeys = useMemo(
    () => keys.filter((key, index, items) => (
      items.findIndex((candidate) => candidate.id === key.id) === index
    )),
    [keys],
  );

  if (!open || !app) return null;

  const summaryItems = [
    {
      label: 'API 调用',
      value: numberFormatter.format(data.summary.calls),
      detail: `${data.summary.successes} 成功 / ${data.summary.failures} 失败`,
      icon: Activity,
    },
    {
      label: '成功率',
      value: `${data.summary.successRate}%`,
      detail: data.summary.failures > 0 ? '存在失败调用' : '当前范围运行正常',
      icon: CheckCircle2,
    },
    {
      label: '平均响应',
      value: formatLatency(data.summary.averageLatencyMs),
      detail: '认证后的请求处理耗时',
      icon: Clock3,
    },
    {
      label: 'Token 用量',
      value: numberFormatter.format(data.summary.totalTokens),
      detail: `${numberFormatter.format(data.summary.promptTokens)} 输入 / ${numberFormatter.format(data.summary.completionTokens)} 输出`,
      icon: Zap,
    },
  ];

  return (
    <div className="dialogBackdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="dialogPanel externalRequestsDialog" role="dialog" aria-modal="true" aria-labelledby="external-requests-title">
        <header className="dialogHeader externalRequestsHeader">
          <div className="dialogTitleWithIcon">
            <span className="externalRequestsTitleIcon" aria-hidden="true"><Activity size={18} /></span>
            <span>
              <h2 id="external-requests-title">调用日志</h2>
              <small>{app.name}</small>
            </span>
          </div>
          <button className="iconButton" type="button" onClick={onClose} aria-label="关闭" title="关闭">
            <X size={19} />
          </button>
        </header>

        <div className="externalRequestsBody">
          <section className="externalRequestSummary" aria-label="调用汇总">
            {summaryItems.map((item) => {
              const Icon = item.icon;
              return (
                <div className="externalRequestMetric" key={item.label}>
                  <span aria-hidden="true"><Icon size={16} /></span>
                  <small>{item.label}</small>
                  <strong>{item.value}</strong>
                  <em>{item.detail}</em>
                </div>
              );
            })}
          </section>

          <section className="externalRequestToolbar" aria-label="调用日志筛选">
            <div className="segmentedControl compactSegments" aria-label="时间范围">
              {rangeOptions.map((option) => (
                <button
                  className={range === option.value ? 'selected' : ''}
                  key={option.value}
                  type="button"
                  onClick={() => { setRange(option.value); setPage(1); }}
                  aria-pressed={range === option.value}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="externalRequestSelectors">
              <label>
                <span className="srOnly">调用结果</span>
                <select value={outcome} onChange={(event) => {
                  setOutcome(event.target.value as typeof outcome);
                  setPage(1);
                }}>
                  <option value="all">全部结果</option>
                  <option value="success">仅成功</option>
                  <option value="failure">仅失败</option>
                </select>
              </label>
              <label>
                <span className="srOnly">访问密钥</span>
                <select value={accessKeyId} onChange={(event) => {
                  setAccessKeyId(event.target.value);
                  setPage(1);
                }}>
                  <option value="all">全部密钥</option>
                  {visibleKeys.map((key) => (
                    <option value={key.id} key={key.id}>{key.name} · {key.prefix}</option>
                  ))}
                </select>
              </label>
              <button className="iconButton" type="button" onClick={() => setReloadKey((key) => key + 1)} disabled={loading} aria-label="刷新调用日志" title="刷新">
                <RefreshCw className={loading ? 'spin' : ''} size={17} />
              </button>
            </div>
          </section>

          {error && (
            <div className="errorBanner externalRequestError" role="alert">
              <span>{error}</span>
              <button className="textButton" type="button" onClick={() => setReloadKey((key) => key + 1)}><RefreshCw size={15} />重试</button>
            </div>
          )}

          <section className="externalRequestListSection" aria-busy={loading} aria-label="调用记录">
            <div className="externalRequestListHeader" role="row">
              <span>请求</span><span>访问密钥</span><span>结果</span><span>性能</span><span>来源</span>
            </div>
            {loading && data.items.length === 0 ? (
              <div className="externalRequestsEmpty"><LoaderCircle className="spin" size={18} />正在读取调用日志</div>
            ) : data.items.length === 0 ? (
              <div className="externalRequestsEmpty"><Activity size={18} />当前筛选范围内暂无调用</div>
            ) : (
              <div className="externalRequestList">
                {data.items.map((item) => (
                  <article className="externalRequestRow" key={item.id}>
                    <div className="externalRequestIdentity">
                      <strong>{item.endpoint}</strong>
                      <small>{formatDate(item.createdAt)}</small>
                      {item.conversationId && <code title={item.conversationId}>会话 {item.conversationId.slice(0, 8)}</code>}
                    </div>
                    <div className="externalRequestCredential">
                      <span><KeyRound size={12} />{item.accessKeyName}</span>
                      <code>{item.accessKeyPrefix}...</code>
                    </div>
                    <div className={`externalRequestOutcome externalRequestOutcome-${item.outcome}`}>
                      <span>{item.outcome === 'success' ? <CheckCircle2 size={13} /> : <CircleAlert size={13} />}{item.outcome === 'success' ? '成功' : '失败'}</span>
                      <small>HTTP {item.httpStatus}</small>
                      {item.errorCode && <code title={item.errorCode}>{item.errorCode}</code>}
                    </div>
                    <div className="externalRequestPerformance">
                      <span><Clock3 size={12} />{formatLatency(item.latencyMs)}</span>
                      <small>{numberFormatter.format(item.totalTokens)} Token</small>
                    </div>
                    <div className="externalRequestSource">
                      <code title={item.clientIp ?? ''}>{item.clientIp || '未知 IP'}</code>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {!loading && data.total > 0 && (
            <footer className="externalRequestPagination">
              <span>共 {data.total} 条 · 第 {page} / {totalPages} 页</span>
              <div>
                <button className="iconButton" type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1} aria-label="上一页" title="上一页"><ChevronLeft size={17} /></button>
                <button className="iconButton" type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages} aria-label="下一页" title="下一页"><ChevronRight size={17} /></button>
              </div>
            </footer>
          )}
        </div>
      </section>
    </div>
  );
}
