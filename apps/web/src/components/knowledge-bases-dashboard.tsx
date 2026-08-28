'use client';

import {
  AppWindow,
  ArrowUpDown,
  Ban,
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  CircleCheck,
  Clock3,
  FileText,
  Link2,
  Pencil,
  RefreshCw,
  Search,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ClientApiError, clientApi } from '@/lib/client-api';
import type {
  AiApp,
  AppList,
  AppStatus,
  KnowledgeBase,
  KnowledgeBaseLinkedApp,
  KnowledgeBaseList,
  KnowledgeBaseStats,
  KnowledgeBaseStatus,
} from '@/lib/types';
import { ConfirmDialog } from './confirm-dialog';
import {
  KnowledgeBaseDialog,
  type KnowledgeBaseFormInput,
} from './knowledge-base-dialog';
import { KnowledgeBaseStatusBadge } from './knowledge-base-status-badge';
import {
  RelationManagerDialog,
  type RelationOption,
} from './relation-manager-dialog';
import { WorkspaceShell } from './workspace-shell';
import { WorkspaceStats } from './workspace-stats';

const pageSize = 8;

const statusOptions: Array<{ value: 'all' | KnowledgeBaseStatus; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'ready', label: '就绪' },
  { value: 'pending', label: '待处理' },
  { value: 'failed', label: '失败' },
  { value: 'disabled', label: '已停用' },
];

const appStatusLabels: Record<AppStatus, string> = {
  active: '已启用',
  draft: '草稿',
  disabled: '已停用',
};

const appStatusTones: Record<AppStatus, RelationOption['statusTone']> = {
  active: 'positive',
  draft: 'warning',
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

export function KnowledgeBasesDashboard() {
  const router = useRouter();
  const [data, setData] = useState<KnowledgeBaseList>({ items: [], page: 1, pageSize, total: 0 });
  const [stats, setStats] = useState<KnowledgeBaseStats>({
    total: 0,
    ready: 0,
    pending: 0,
    failed: 0,
    disabled: 0,
    appBindings: 0,
  });
  const [status, setStatus] = useState<'all' | KnowledgeBaseStatus>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<'updated_desc' | 'created_desc' | 'name_asc'>('updated_desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingKnowledgeBase, setEditingKnowledgeBase] = useState<KnowledgeBase | null>(null);
  const [disablingKnowledgeBase, setDisablingKnowledgeBase] = useState<KnowledgeBase | null>(null);
  const [bindingKnowledgeBase, setBindingKnowledgeBase] = useState<KnowledgeBase | null>(null);
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

  const loadKnowledgeBases = useCallback(async () => {
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
      const [knowledgeBases, knowledgeBaseStats] = await Promise.all([
        clientApi<KnowledgeBaseList>(`/api/knowledge-bases?${parameters}`),
        clientApi<KnowledgeBaseStats>('/api/knowledge-bases/stats'),
      ]);
      setData(knowledgeBases);
      setStats(knowledgeBaseStats);
    } catch (requestError) {
      handleApiError(requestError);
    } finally {
      setLoading(false);
    }
  }, [handleApiError, page, reloadKey, search, sort, status]);

  useEffect(() => {
    void loadKnowledgeBases();
  }, [loadKnowledgeBases]);

  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
  const hasFilters = status !== 'all' || search.length > 0;

  function openCreateDialog() {
    setEditingKnowledgeBase(null);
    setDialogOpen(true);
  }

  function openEditDialog(knowledgeBase: KnowledgeBase) {
    setEditingKnowledgeBase(knowledgeBase);
    setDialogOpen(true);
  }

  async function saveKnowledgeBase(input: KnowledgeBaseFormInput) {
    if (editingKnowledgeBase) {
      await clientApi<KnowledgeBase>(`/api/knowledge-bases/${editingKnowledgeBase.id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
      setToast('知识库已更新');
    } else {
      await clientApi<KnowledgeBase>('/api/knowledge-bases', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      setToast('知识库已创建');
      setPage(1);
      setStatus('all');
      setSearchInput('');
      setSearch('');
    }
    setDialogOpen(false);
    setEditingKnowledgeBase(null);
    setReloadKey((key) => key + 1);
  }

  async function disableSelectedKnowledgeBase() {
    if (!disablingKnowledgeBase) return;
    try {
      await clientApi<void>(`/api/knowledge-bases/${disablingKnowledgeBase.id}`, {
        method: 'DELETE',
      });
      setDisablingKnowledgeBase(null);
      setToast('知识库已停用');
      setReloadKey((key) => key + 1);
    } catch (requestError) {
      handleApiError(requestError);
      throw requestError;
    }
  }

  async function openAppRelations(knowledgeBase: KnowledgeBase) {
    setBindingKnowledgeBase(knowledgeBase);
    setRelationsLoading(true);
    setRelationOptions([]);
    try {
      const [allApps, linkedApps] = await Promise.all([
        clientApi<AppList>('/api/apps?pageSize=100&sort=name_asc'),
        clientApi<KnowledgeBaseLinkedApp[]>(`/api/knowledge-bases/${knowledgeBase.id}/apps`),
      ]);
      const linkedIds = new Set(linkedApps.map((item) => item.id));
      setRelationOptions(
        allApps.items.map((item: AiApp) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          code: item.fastgptAppId,
          statusLabel: appStatusLabels[item.status],
          statusTone: appStatusTones[item.status],
          bound: linkedIds.has(item.id),
        })),
      );
    } catch (requestError) {
      handleApiError(requestError);
    } finally {
      setRelationsLoading(false);
    }
  }

  async function toggleAppRelation(option: RelationOption, nextBound: boolean) {
    if (!bindingKnowledgeBase) return;
    setTogglingRelationId(option.id);
    try {
      await clientApi<void>(`/api/apps/${option.id}/knowledge-bases/${bindingKnowledgeBase.id}`, {
        method: nextBound ? 'PUT' : 'DELETE',
      });
      setRelationOptions((items) =>
        items.map((item) => (item.id === option.id ? { ...item, bound: nextBound } : item)),
      );
      setToast(nextBound ? '应用已关联' : '应用已解除关联');
      setReloadKey((key) => key + 1);
    } catch (requestError) {
      handleApiError(requestError);
    } finally {
      setTogglingRelationId(null);
    }
  }

  return (
    <WorkspaceShell active="knowledge-bases" title="知识库">
      <section className="workspaceHeader">
        <div className="pageTitle">
          <h1>知识库</h1>
          <span>{data.total}</span>
        </div>
        <button className="primaryButton" type="button" onClick={openCreateDialog}>
          <CirclePlus size={18} />
          创建知识库
        </button>
      </section>

      <WorkspaceStats
        label="知识库概况"
        items={[
          { label: '知识库总数', value: stats.total, icon: BookOpenText },
          { label: '就绪', value: stats.ready, icon: CircleCheck, tone: 'positive' },
          { label: '待处理', value: stats.pending, icon: Clock3, tone: 'warning' },
          { label: '应用关联', value: stats.appBindings, icon: Link2 },
        ]}
      />

      <section className="toolbar" aria-label="知识库筛选">
        <label className="searchBox">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="搜索知识库"
            aria-label="搜索知识库"
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
              aria-label="知识库排序"
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
          <button className="textButton" type="button" onClick={() => void loadKnowledgeBases()}>
            <RefreshCw size={16} />
            重试
          </button>
        </div>
      )}

      <section className="dataSurface" aria-busy={loading}>
        <div className="knowledgeTableHeader" role="row">
          <span>知识库</span>
          <span>FastGPT Dataset ID</span>
          <span>内容</span>
          <span>状态</span>
          <span className="srOnly">操作</span>
        </div>

        {loading ? (
          <div className="loadingRows" aria-label="正在加载知识库">
            {Array.from({ length: 5 }, (_, index) => (
              <div className="skeletonRow" key={index}>
                <span /><span /><span /><span />
              </div>
            ))}
          </div>
        ) : data.items.length === 0 ? (
          <div className="emptyState">
            <span className="emptyIcon" aria-hidden="true"><BookOpenText size={23} /></span>
            <h2>{hasFilters ? '没有匹配结果' : '还没有知识库'}</h2>
            {!hasFilters && (
              <button className="secondaryButton" type="button" onClick={openCreateDialog}>
                <CirclePlus size={17} />
                创建第一个知识库
              </button>
            )}
          </div>
        ) : (
          <div className="tableBody">
            {data.items.map((item) => (
              <article className="knowledgeRow" key={item.id}>
                <div className="appIdentity">
                  <span className="appIcon knowledgeIcon" aria-hidden="true"><BookOpenText size={18} /></span>
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.description || '暂无描述'}</small>
                    <em className="rowTimestamp">更新于 {formatDate(item.updatedAt)}</em>
                  </span>
                </div>
                <code className={item.fastgptDatasetId ? '' : 'muted'}>
                  {item.fastgptDatasetId || '未绑定'}
                </code>
                <div className="knowledgeState">
                  <span className="knowledgeCounts">
                    <span title={`${item.documentCount} 个文档`}><FileText size={14} />{item.documentCount}</span>
                    <span title={`${item.attachedAppCount} 个关联应用`}><Link2 size={14} />{item.attachedAppCount}</span>
                  </span>
                  <KnowledgeBaseStatusBadge status={item.status} />
                </div>
                <div className="rowActions">
                  <Link className="iconButton" href={`/knowledge-bases/${item.id}`} aria-label={`管理 ${item.name} 的文档`} title="文档">
                    <FileText size={17} />
                  </Link>
                  <button className="iconButton" type="button" onClick={() => void openAppRelations(item)} aria-label={`管理 ${item.name} 的应用`} title="关联应用">
                    <Link2 size={17} />
                  </button>
                  <button className="iconButton" type="button" onClick={() => openEditDialog(item)} aria-label={`编辑 ${item.name}`} title="编辑">
                    <Pencil size={17} />
                  </button>
                  {item.status !== 'disabled' && (
                    <button className="iconButton dangerHover" type="button" onClick={() => setDisablingKnowledgeBase(item)} aria-label={`停用 ${item.name}`} title="停用">
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

      <KnowledgeBaseDialog
        open={dialogOpen}
        knowledgeBase={editingKnowledgeBase}
        onClose={() => setDialogOpen(false)}
        onSave={saveKnowledgeBase}
      />
      <ConfirmDialog
        open={Boolean(disablingKnowledgeBase)}
        appName={disablingKnowledgeBase?.name ?? ''}
        subjectLabel="知识库"
        onClose={() => setDisablingKnowledgeBase(null)}
        onConfirm={disableSelectedKnowledgeBase}
      />
      <RelationManagerDialog
        open={Boolean(bindingKnowledgeBase)}
        title="关联应用"
        subjectName={bindingKnowledgeBase?.name ?? ''}
        optionLabel="可关联应用"
        options={relationOptions}
        loading={relationsLoading}
        togglingId={togglingRelationId}
        onClose={() => setBindingKnowledgeBase(null)}
        onToggle={toggleAppRelation}
      />
      {toast && <div className="toast" role="status">{toast}</div>}
    </WorkspaceShell>
  );
}
