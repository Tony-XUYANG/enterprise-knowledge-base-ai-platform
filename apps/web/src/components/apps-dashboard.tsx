'use client';

import {
  AppWindow,
  ArrowUpDown,
  Ban,
  ChartNoAxesCombined,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  CircleCheck,
  Clock3,
  Link2,
  KeyRound,
  Pencil,
  RefreshCw,
  Search,
  ScrollText,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ClientApiError, clientApi } from '@/lib/client-api';
import type {
  AiApp,
  AppList,
  AppMetrics,
  AppMetricsRange,
  AppStats,
  AppStatus,
  KnowledgeBase,
  KnowledgeBaseList,
  KnowledgeBaseStatus,
} from '@/lib/types';
import { AppMetricsDialog } from './app-metrics-dialog';
import { AppAccessKeysDialog } from './app-access-keys-dialog';
import { AppExternalRequestsDialog } from './app-external-requests-dialog';
import { ApplicationDialog, type AppFormInput } from './application-dialog';
import { ConfirmDialog } from './confirm-dialog';
import {
  RelationManagerDialog,
  type RelationOption,
} from './relation-manager-dialog';
import { StatusBadge } from './status-badge';
import { WorkspaceShell } from './workspace-shell';
import { WorkspaceStats } from './workspace-stats';

const pageSize = 8;

const statusOptions: Array<{ value: 'all' | AppStatus; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'active', label: '已启用' },
  { value: 'draft', label: '草稿' },
  { value: 'disabled', label: '已停用' },
];

const knowledgeBaseStatusLabels: Record<KnowledgeBaseStatus, string> = {
  ready: '就绪',
  pending: '待处理',
  failed: '失败',
  disabled: '已停用',
};

const knowledgeBaseStatusTones: Record<
  KnowledgeBaseStatus,
  RelationOption['statusTone']
> = {
  ready: 'positive',
  pending: 'warning',
  failed: 'danger',
  disabled: 'muted',
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function AppsDashboard() {
  const router = useRouter();
  const [data, setData] = useState<AppList>({ items: [], page: 1, pageSize, total: 0 });
  const [stats, setStats] = useState<AppStats>({
    total: 0,
    active: 0,
    draft: 0,
    disabled: 0,
    knowledgeBaseBindings: 0,
  });
  const [status, setStatus] = useState<'all' | AppStatus>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<'updated_desc' | 'created_desc' | 'name_asc'>('updated_desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingApp, setEditingApp] = useState<AiApp | null>(null);
  const [disablingApp, setDisablingApp] = useState<AiApp | null>(null);
  const [bindingApp, setBindingApp] = useState<AiApp | null>(null);
  const [metricsApp, setMetricsApp] = useState<AiApp | null>(null);
  const [metricsRange, setMetricsRange] = useState<AppMetricsRange>('30d');
  const [metrics, setMetrics] = useState<AppMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState('');
  const [metricsReloadKey, setMetricsReloadKey] = useState(0);
  const [accessKeysApp, setAccessKeysApp] = useState<AiApp | null>(null);
  const [externalRequestsApp, setExternalRequestsApp] = useState<AiApp | null>(null);
  const [relationOptions, setRelationOptions] = useState<RelationOption[]>([]);
  const [relationsLoading, setRelationsLoading] = useState(false);
  const [togglingRelationId, setTogglingRelationId] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(''), 3000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const handleApiError = useCallback((requestError: unknown) => {
    if (requestError instanceof ClientApiError && requestError.status === 401) {
      router.replace('/login');
      router.refresh();
      return;
    }
    setError(
      requestError instanceof ClientApiError
        ? requestError.message
        : '加载失败，请稍后重试',
    );
  }, [router]);

  const loadApps = useCallback(async () => {
    setLoading(true);
    setError('');
    const parameters = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort,
    });
    if (status !== 'all') parameters.set('status', status);
    if (search) parameters.set('search', search);

    try {
      const [apps, appStats] = await Promise.all([
        clientApi<AppList>(`/api/apps?${parameters}`),
        clientApi<AppStats>('/api/apps/stats'),
      ]);
      setData(apps);
      setStats(appStats);
    } catch (requestError) {
      handleApiError(requestError);
    } finally {
      setLoading(false);
    }
  }, [handleApiError, page, reloadKey, search, sort, status]);

  useEffect(() => {
    void loadApps();
  }, [loadApps]);

  useEffect(() => {
    if (!metricsApp) return;
    const controller = new AbortController();
    setMetricsLoading(true);
    setMetricsError('');
    void clientApi<AppMetrics>(
      `/api/apps/${metricsApp.id}/metrics?range=${metricsRange}`,
      { signal: controller.signal },
    ).then((result) => {
      setMetrics(result);
    }).catch((requestError: unknown) => {
      if (controller.signal.aborted) return;
      if (requestError instanceof ClientApiError && requestError.status === 401) {
        router.replace('/login');
        router.refresh();
        return;
      }
      setMetricsError(
        requestError instanceof ClientApiError
          ? requestError.message
          : '应用分析加载失败，请稍后重试',
      );
    }).finally(() => {
      if (!controller.signal.aborted) setMetricsLoading(false);
    });
    return () => controller.abort();
  }, [metricsApp, metricsRange, metricsReloadKey, router]);

  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
  const hasFilters = status !== 'all' || search.length > 0;

  function openCreateDialog() {
    setEditingApp(null);
    setDialogOpen(true);
  }

  function openEditDialog(app: AiApp) {
    setEditingApp(app);
    setDialogOpen(true);
  }

  function openMetricsDialog(app: AiApp) {
    setMetrics(null);
    setMetricsError('');
    setMetricsRange('30d');
    setMetricsApp(app);
  }

  async function saveApp(input: AppFormInput) {
    if (editingApp) {
      await clientApi<AiApp>(`/api/apps/${editingApp.id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
      setToast('应用已更新');
    } else {
      await clientApi<AiApp>('/api/apps', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      setToast('应用已创建');
      setPage(1);
      setStatus('all');
      setSearchInput('');
      setSearch('');
    }
    setDialogOpen(false);
    setEditingApp(null);
    setReloadKey((key) => key + 1);
  }

  async function disableSelectedApp() {
    if (!disablingApp) return;
    try {
      await clientApi<void>(`/api/apps/${disablingApp.id}`, { method: 'DELETE' });
      setDisablingApp(null);
      setToast('应用已停用');
      setReloadKey((key) => key + 1);
    } catch (requestError) {
      handleApiError(requestError);
      throw requestError;
    }
  }

  async function openKnowledgeBaseRelations(app: AiApp) {
    setBindingApp(app);
    setRelationsLoading(true);
    setRelationOptions([]);
    try {
      const [allKnowledgeBases, linkedKnowledgeBases] = await Promise.all([
        clientApi<KnowledgeBaseList>('/api/knowledge-bases?pageSize=100&sort=name_asc'),
        clientApi<KnowledgeBase[]>(`/api/apps/${app.id}/knowledge-bases`),
      ]);
      const linkedIds = new Set(linkedKnowledgeBases.map((item) => item.id));
      setRelationOptions(
        allKnowledgeBases.items.map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          code: item.fastgptDatasetId,
          statusLabel: knowledgeBaseStatusLabels[item.status],
          statusTone: knowledgeBaseStatusTones[item.status],
          bound: linkedIds.has(item.id),
        })),
      );
    } catch (requestError) {
      handleApiError(requestError);
    } finally {
      setRelationsLoading(false);
    }
  }

  async function toggleKnowledgeBaseRelation(option: RelationOption, nextBound: boolean) {
    if (!bindingApp) return;
    setTogglingRelationId(option.id);
    try {
      await clientApi<void>(`/api/apps/${bindingApp.id}/knowledge-bases/${option.id}`, {
        method: nextBound ? 'PUT' : 'DELETE',
      });
      setRelationOptions((items) =>
        items.map((item) => (item.id === option.id ? { ...item, bound: nextBound } : item)),
      );
      setToast(nextBound ? '知识库已关联' : '知识库已解除关联');
      setReloadKey((key) => key + 1);
    } catch (requestError) {
      handleApiError(requestError);
    } finally {
      setTogglingRelationId(null);
    }
  }

  return (
    <WorkspaceShell active="apps" title="AI 应用">
        <section className="workspaceHeader">
          <div className="pageTitle">
            <h1>AI 应用</h1>
            <span>{data.total}</span>
          </div>
          <button className="primaryButton" type="button" onClick={openCreateDialog}>
            <CirclePlus size={18} />
            创建应用
          </button>
        </section>

        <WorkspaceStats
          label="应用概况"
          items={[
            { label: '应用总数', value: stats.total, icon: AppWindow },
            { label: '已启用', value: stats.active, icon: CircleCheck, tone: 'positive' },
            { label: '草稿', value: stats.draft, icon: Clock3, tone: 'warning' },
            { label: '知识库关联', value: stats.knowledgeBaseBindings, icon: Link2 },
          ]}
        />

        <section className="toolbar" aria-label="应用筛选">
          <label className="searchBox">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="搜索应用"
              aria-label="搜索应用"
            />
          </label>
          <div className="toolbarControls">
            <div className="segmentedControl" aria-label="状态筛选">
              {statusOptions.map((option) => (
                <button
                  key={option.value}
                  className={status === option.value ? 'selected' : ''}
                  type="button"
                  onClick={() => {
                    setStatus(option.value);
                    setPage(1);
                  }}
                  aria-pressed={status === option.value}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <label className="sortSelect">
              <ArrowUpDown size={16} aria-hidden="true" />
              <select
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value as typeof sort);
                  setPage(1);
                }}
                aria-label="应用排序"
              >
                <option value="updated_desc">最近更新</option>
                <option value="created_desc">最近创建</option>
                <option value="name_asc">名称排序</option>
              </select>
            </label>
          </div>
        </section>

        {error && (
          <div className="errorBanner" role="alert">
            <span>{error}</span>
            <button className="textButton" type="button" onClick={() => void loadApps()}>
              <RefreshCw size={16} />
              重试
            </button>
          </div>
        )}

        <section className="dataSurface" aria-busy={loading}>
          <div className="tableHeader" role="row">
            <span>应用</span>
            <span>FastGPT App ID</span>
            <span>知识库</span>
            <span>状态</span>
            <span className="srOnly">操作</span>
          </div>

          {loading ? (
            <div className="loadingRows" aria-label="正在加载应用">
              {Array.from({ length: 5 }, (_, index) => (
                <div className="skeletonRow" key={index}>
                  <span /><span /><span /><span />
                </div>
              ))}
            </div>
          ) : data.items.length === 0 ? (
            <div className="emptyState">
              <span className="emptyIcon" aria-hidden="true"><AppWindow size={23} /></span>
              <h2>{hasFilters ? '没有匹配结果' : '还没有应用'}</h2>
              {!hasFilters && (
                <button className="secondaryButton" type="button" onClick={openCreateDialog}>
                  <CirclePlus size={17} />
                  创建第一个应用
                </button>
              )}
            </div>
          ) : (
            <div className="tableBody">
              {data.items.map((item) => (
                <article className="appRow" key={item.id}>
                  <div className="appIdentity">
                    <span className="appIcon" aria-hidden="true"><AppWindow size={18} /></span>
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.description || '暂无描述'}</small>
                      <span className="appMetaLine">
                        <em className="rowTimestamp">更新于 {formatDate(item.updatedAt)}</em>
                        <span className={item.hasFastgptApiKey ? 'credentialFlag configured' : 'credentialFlag'}>
                          <KeyRound size={12} />
                          {item.hasFastgptApiKey ? '密钥已配置' : '密钥未配置'}
                        </span>
                      </span>
                    </span>
                  </div>
                  <code className={item.fastgptAppId ? '' : 'muted'}>{item.fastgptAppId || '未绑定'}</code>
                  <div className="appState">
                    <span className="attachmentCount">
                      <Link2 size={14} />
                      {item.attachedKnowledgeBaseCount}
                    </span>
                    <StatusBadge status={item.status} />
                  </div>
                  <div className="rowActions">
                    <button className="iconButton" type="button" onClick={() => setAccessKeysApp(item)} aria-label={`管理 ${item.name} 的访问密钥`} title="访问密钥">
                      <KeyRound size={17} />
                    </button>
                    <button className="iconButton" type="button" onClick={() => setExternalRequestsApp(item)} aria-label={`查看 ${item.name} 的调用日志`} title="调用日志">
                      <ScrollText size={17} />
                    </button>
                    <button className="iconButton" type="button" onClick={() => openMetricsDialog(item)} aria-label={`查看 ${item.name} 的应用分析`} title="应用分析">
                      <ChartNoAxesCombined size={17} />
                    </button>
                    <button className="iconButton" type="button" onClick={() => void openKnowledgeBaseRelations(item)} aria-label={`管理 ${item.name} 的知识库`} title="关联知识库">
                      <Link2 size={17} />
                    </button>
                    <button className="iconButton" type="button" onClick={() => openEditDialog(item)} aria-label={`编辑 ${item.name}`} title="编辑">
                      <Pencil size={17} />
                    </button>
                    {item.status !== 'disabled' && (
                      <button className="iconButton dangerHover" type="button" onClick={() => setDisablingApp(item)} aria-label={`停用 ${item.name}`} title="停用">
                        <Ban size={17} />
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}

          {!loading && data.total > 0 && (
            <footer className="pagination">
              <span>第 {page} / {totalPages} 页</span>
              <div>
                <button className="iconButton" type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1} aria-label="上一页" title="上一页">
                  <ChevronLeft size={18} />
                </button>
                <button className="iconButton" type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages} aria-label="下一页" title="下一页">
                  <ChevronRight size={18} />
                </button>
              </div>
            </footer>
          )}
        </section>
      <ApplicationDialog
        open={dialogOpen}
        app={editingApp}
        onClose={() => setDialogOpen(false)}
        onSave={saveApp}
      />
      <ConfirmDialog
        open={Boolean(disablingApp)}
        appName={disablingApp?.name ?? ''}
        onClose={() => setDisablingApp(null)}
        onConfirm={disableSelectedApp}
      />
      <RelationManagerDialog
        open={Boolean(bindingApp)}
        title="关联知识库"
        subjectName={bindingApp?.name ?? ''}
        optionLabel="可关联知识库"
        options={relationOptions}
        loading={relationsLoading}
        togglingId={togglingRelationId}
        onClose={() => setBindingApp(null)}
        onToggle={toggleKnowledgeBaseRelation}
      />
      <AppMetricsDialog
        open={Boolean(metricsApp)}
        app={metricsApp}
        range={metricsRange}
        metrics={metrics}
        loading={metricsLoading}
        error={metricsError}
        onRangeChange={setMetricsRange}
        onRetry={() => setMetricsReloadKey((key) => key + 1)}
        onClose={() => {
          setMetricsApp(null);
          setMetrics(null);
          setMetricsError('');
        }}
      />
      <AppAccessKeysDialog
        open={Boolean(accessKeysApp)}
        app={accessKeysApp}
        onClose={() => setAccessKeysApp(null)}
        onChanged={setToast}
      />
      <AppExternalRequestsDialog
        open={Boolean(externalRequestsApp)}
        app={externalRequestsApp}
        onClose={() => setExternalRequestsApp(null)}
      />
      {toast && <div className="toast" role="status">{toast}</div>}
    </WorkspaceShell>
  );
}
