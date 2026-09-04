'use client';

import {
  ArrowLeft,
  ArrowUpDown,
  Ban,
  Boxes,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CirclePlus,
  FileText,
  FileUp,
  Globe2,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  Type,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ClientApiError, clientApi } from '@/lib/client-api';
import type {
  BatchDocumentContentImportResult,
  KnowledgeBase,
  KnowledgeBaseInsights,
  KnowledgeDocument,
  KnowledgeDocumentList,
  KnowledgeDocumentSourceType,
  KnowledgeDocumentStats,
  KnowledgeDocumentStatus,
} from '@/lib/types';
import { ConfirmDialog } from './confirm-dialog';
import { KnowledgeBaseInsightsDialog } from './knowledge-base-insights-dialog';
import { KnowledgeBaseSearchDialog } from './knowledge-base-search-dialog';
import { KnowledgeDocumentsImportDialog } from './knowledge-documents-import-dialog';
import { KnowledgeDocumentChunksDialog } from './knowledge-document-chunks-dialog';
import {
  KnowledgeDocumentDialog,
  type KnowledgeDocumentFormInput,
} from './knowledge-document-dialog';
import { WorkspaceShell } from './workspace-shell';
import { WorkspaceStats } from './workspace-stats';

const pageSize = 8;

const statusOptions: Array<{ value: 'all' | KnowledgeDocumentStatus; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'ready', label: '就绪' },
  { value: 'processing', label: '处理中' },
  { value: 'pending', label: '待处理' },
  { value: 'failed', label: '失败' },
  { value: 'disabled', label: '已停用' },
];

const statusLabels: Record<KnowledgeDocumentStatus, string> = {
  ready: '就绪',
  processing: '处理中',
  pending: '待处理',
  failed: '失败',
  disabled: '已停用',
};

const sourceConfig: Record<KnowledgeDocumentSourceType, {
  label: string;
  icon: typeof FileText;
}> = {
  file: { label: '文件', icon: FileText },
  url: { label: '网页', icon: Globe2 },
  text: { label: '文本', icon: Type },
};

const initialStats: KnowledgeDocumentStats = {
  total: 0,
  ready: 0,
  processing: 0,
  pending: 0,
  failed: 0,
  disabled: 0,
  chunks: 0,
  totalBytes: 0,
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatBytes(value: number | null) {
  if (value === null) return '大小未知';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

interface KnowledgeBaseDocumentsDashboardProps {
  knowledgeBaseId: string;
}

export function KnowledgeBaseDocumentsDashboard({
  knowledgeBaseId,
}: KnowledgeBaseDocumentsDashboardProps) {
  const router = useRouter();
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeBase | null>(null);
  const [data, setData] = useState<KnowledgeDocumentList>({
    items: [],
    page: 1,
    pageSize,
    total: 0,
  });
  const [stats, setStats] = useState<KnowledgeDocumentStats>(initialStats);
  const [status, setStatus] = useState<'all' | KnowledgeDocumentStatus>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'updated_desc' | 'created_desc' | 'name_asc'>('updated_desc');
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingDocument, setEditingDocument] = useState<KnowledgeDocument | null>(null);
  const [disablingDocument, setDisablingDocument] = useState<KnowledgeDocument | null>(null);
  const [chunkDocument, setChunkDocument] = useState<KnowledgeDocument | null>(null);
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [batchImportOpen, setBatchImportOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [insights, setInsights] = useState<KnowledgeBaseInsights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState('');
  const [insightsReloadKey, setInsightsReloadKey] = useState(0);
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
        : '文档加载失败，请稍后重试',
    );
  }, [router]);

  const loadDocuments = useCallback(async () => {
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
      const [currentKnowledgeBase, documents, documentStats] = await Promise.all([
        clientApi<KnowledgeBase>(`/api/knowledge-bases/${knowledgeBaseId}`),
        clientApi<KnowledgeDocumentList>(
          `/api/knowledge-bases/${knowledgeBaseId}/documents?${parameters}`,
        ),
        clientApi<KnowledgeDocumentStats>(
          `/api/knowledge-bases/${knowledgeBaseId}/documents/stats`,
        ),
      ]);
      setKnowledgeBase(currentKnowledgeBase);
      setData(documents);
      setStats(documentStats);
    } catch (requestError) {
      handleApiError(requestError);
    } finally {
      setLoading(false);
    }
  }, [handleApiError, knowledgeBaseId, page, reloadKey, search, sort, status]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    if (!insightsOpen) return;
    const controller = new AbortController();
    setInsightsLoading(true);
    setInsightsError('');
    void clientApi<KnowledgeBaseInsights>(
      `/api/knowledge-bases/${knowledgeBaseId}/insights`,
      { signal: controller.signal },
    ).then((result) => {
      setInsights(result);
    }).catch((requestError: unknown) => {
      if (controller.signal.aborted) return;
      if (requestError instanceof ClientApiError && requestError.status === 401) {
        router.replace('/login');
        router.refresh();
        return;
      }
      setInsightsError(
        requestError instanceof ClientApiError
          ? requestError.message
          : '内容健康分析加载失败，请稍后重试',
      );
    }).finally(() => {
      if (!controller.signal.aborted) setInsightsLoading(false);
    });
    return () => controller.abort();
  }, [insightsOpen, insightsReloadKey, knowledgeBaseId, router]);

  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
  const hasFilters = status !== 'all' || search.length > 0;

  function openCreateDialog() {
    setEditingDocument(null);
    setDialogOpen(true);
  }

  function openEditDialog(document: KnowledgeDocument) {
    setEditingDocument(document);
    setDialogOpen(true);
  }

  async function saveDocument(input: KnowledgeDocumentFormInput) {
    if (editingDocument) {
      await clientApi<KnowledgeDocument>(
        `/api/knowledge-bases/${knowledgeBaseId}/documents/${editingDocument.id}`,
        { method: 'PATCH', body: JSON.stringify(input) },
      );
      setToast('文档已更新');
    } else {
      await clientApi<KnowledgeDocument>(
        `/api/knowledge-bases/${knowledgeBaseId}/documents`,
        { method: 'POST', body: JSON.stringify(input) },
      );
      setToast('文档已添加');
      setPage(1);
      setStatus('all');
      setSearchInput('');
      setSearch('');
    }
    setDialogOpen(false);
    setEditingDocument(null);
    setReloadKey((key) => key + 1);
  }

  async function disableSelectedDocument() {
    if (!disablingDocument) return;
    try {
      await clientApi<void>(
        `/api/knowledge-bases/${knowledgeBaseId}/documents/${disablingDocument.id}`,
        { method: 'DELETE' },
      );
      setDisablingDocument(null);
      setToast('文档已停用');
      setReloadKey((key) => key + 1);
    } catch (requestError) {
      handleApiError(requestError);
      throw requestError;
    }
  }

  function finishBatchImport(result: BatchDocumentContentImportResult) {
    setBatchImportOpen(false);
    setPage(1);
    setStatus('all');
    setSearchInput('');
    setSearch('');
    setToast(`已导入 ${result.totalFiles} 个文件，共 ${result.totalChunks} 个分块`);
    setReloadKey((key) => key + 1);
  }

  return (
    <WorkspaceShell active="knowledge-bases" title="知识库文档">
      <section className="workspaceHeader">
        <div className="pageTitle documentPageTitle">
          <Link className="iconButton" href="/knowledge-bases" aria-label="返回知识库" title="返回知识库">
            <ArrowLeft size={18} />
          </Link>
          <div className="detailHeading">
            <small>知识库文档</small>
            <h1>{knowledgeBase?.name ?? '加载中'}</h1>
          </div>
          <span>{data.total}</span>
        </div>
        <div className="workspaceHeaderActions">
          <button className="secondaryButton" type="button" onClick={() => { setInsights(null); setInsightsError(''); setInsightsOpen(true); }} disabled={!knowledgeBase}>
            <ShieldCheck size={18} />
            内容健康
          </button>
          <button className="secondaryButton" type="button" onClick={() => setSearchDialogOpen(true)} disabled={!knowledgeBase || stats.chunks === 0}>
            <Search size={18} />
            检索测试
          </button>
          <button className="secondaryButton" type="button" onClick={() => setBatchImportOpen(true)} disabled={!knowledgeBase || knowledgeBase.status === 'disabled'}>
            <FileUp size={18} />
            批量导入
          </button>
          <button className="primaryButton" type="button" onClick={openCreateDialog} disabled={!knowledgeBase || knowledgeBase.status === 'disabled'}>
            <CirclePlus size={18} />
            添加文档
          </button>
        </div>
      </section>

      <WorkspaceStats
        label="文档概况"
        items={[
          { label: '文档总数', value: stats.total, icon: FileText },
          { label: '就绪', value: stats.ready, icon: CircleCheck, tone: 'positive' },
          { label: '处理中', value: stats.processing, icon: LoaderCircle, tone: 'warning' },
          { label: '内容分块', value: stats.chunks, icon: Boxes },
        ]}
      />

      <section className="toolbar" aria-label="文档筛选">
        <label className="searchBox">
          <Search size={17} aria-hidden="true" />
          <input type="search" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="搜索文档、来源或 Collection ID" aria-label="搜索文档" />
        </label>
        <div className="documentToolbarControls">
          <div className="segmentedControl" aria-label="文档状态筛选">
            {statusOptions.map((option) => (
              <button key={option.value} className={status === option.value ? 'selected' : ''} type="button" onClick={() => { setStatus(option.value); setPage(1); }} aria-pressed={status === option.value}>
                {option.label}
              </button>
            ))}
          </div>
          <label className="sortSelect">
            <ArrowUpDown size={16} aria-hidden="true" />
            <select value={sort} onChange={(event) => { setSort(event.target.value as typeof sort); setPage(1); }} aria-label="文档排序">
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
          <button className="textButton" type="button" onClick={() => void loadDocuments()}><RefreshCw size={16} />重试</button>
        </div>
      )}

      <section className="dataSurface" aria-busy={loading}>
        <div className="documentTableHeader" role="row">
          <span>文档</span><span>来源</span><span>Collection ID</span><span>分块</span><span>状态</span><span className="srOnly">操作</span>
        </div>

        {loading ? (
          <div className="loadingRows" aria-label="正在加载文档">
            {Array.from({ length: 5 }, (_, index) => <div className="skeletonRow" key={index}><span /><span /><span /><span /></div>)}
          </div>
        ) : data.items.length === 0 ? (
          <div className="emptyState">
            <span className="emptyIcon" aria-hidden="true"><FileText size={23} /></span>
            <h2>{hasFilters ? '没有匹配结果' : '还没有文档'}</h2>
            {!hasFilters && knowledgeBase?.status !== 'disabled' && (
              <button className="secondaryButton" type="button" onClick={openCreateDialog}><CirclePlus size={17} />添加第一个文档</button>
            )}
          </div>
        ) : (
          <div className="tableBody">
            {data.items.map((item) => {
              const source = sourceConfig[item.sourceType];
              const SourceIcon = source.icon;
              return (
                <article className="documentRow" key={item.id}>
                  <div className="appIdentity">
                    <span className="appIcon documentIcon" aria-hidden="true"><FileText size={18} /></span>
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.errorMessage || item.mimeType || '未设置 MIME 类型'}</small>
                      <em className="rowTimestamp">更新于 {formatDate(item.updatedAt)}</em>
                    </span>
                  </div>
                  <span className="documentSource"><span><SourceIcon size={14} />{source.label}</span><small>{formatBytes(item.sizeBytes)}</small></span>
                  <code className={item.fastgptCollectionId ? '' : 'muted'}>{item.fastgptCollectionId || '未同步'}</code>
                  <strong className="chunkCount">{item.chunkCount}</strong>
                  <span className={`documentStatusBadge document-status-${item.status}`}>{statusLabels[item.status]}</span>
                  <div className="rowActions">
                    <button className="iconButton" type="button" onClick={() => setChunkDocument(item)} aria-label={`管理 ${item.name} 的分块`} title="分块"><Boxes size={17} /></button>
                    <button className="iconButton" type="button" onClick={() => openEditDialog(item)} aria-label={`编辑 ${item.name}`} title="编辑"><Pencil size={17} /></button>
                    {item.status !== 'disabled' && (
                      <button className="iconButton dangerHover" type="button" onClick={() => setDisablingDocument(item)} aria-label={`停用 ${item.name}`} title="停用"><Ban size={17} /></button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {!loading && data.total > 0 && (
          <footer className="pagination">
            <span>第 {page} / {totalPages} 页</span>
            <div>
              <button className="iconButton" type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1} aria-label="上一页" title="上一页"><ChevronLeft size={18} /></button>
              <button className="iconButton" type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages} aria-label="下一页" title="下一页"><ChevronRight size={18} /></button>
            </div>
          </footer>
        )}
      </section>

      <KnowledgeDocumentDialog open={dialogOpen} knowledgeDocument={editingDocument} onClose={() => setDialogOpen(false)} onSave={saveDocument} />
      <KnowledgeDocumentChunksDialog
        open={Boolean(chunkDocument)}
        knowledgeBaseId={knowledgeBaseId}
        knowledgeDocument={chunkDocument}
        onClose={() => setChunkDocument(null)}
        onChanged={() => setReloadKey((key) => key + 1)}
      />
      <KnowledgeBaseSearchDialog
        open={searchDialogOpen}
        knowledgeBaseId={knowledgeBaseId}
        knowledgeBaseName={knowledgeBase?.name ?? '知识库'}
        onClose={() => setSearchDialogOpen(false)}
      />
      <KnowledgeDocumentsImportDialog
        open={batchImportOpen}
        knowledgeBaseId={knowledgeBaseId}
        knowledgeBaseName={knowledgeBase?.name ?? '知识库'}
        onClose={() => setBatchImportOpen(false)}
        onImported={finishBatchImport}
      />
      <KnowledgeBaseInsightsDialog
        open={insightsOpen}
        knowledgeBase={knowledgeBase}
        insights={insights}
        loading={insightsLoading}
        error={insightsError}
        onRetry={() => setInsightsReloadKey((key) => key + 1)}
        onClose={() => {
          setInsightsOpen(false);
          setInsights(null);
          setInsightsError('');
        }}
      />
      <ConfirmDialog open={Boolean(disablingDocument)} appName={disablingDocument?.name ?? ''} subjectLabel="文档" onClose={() => setDisablingDocument(null)} onConfirm={disableSelectedDocument} />
      {toast && <div className="toast" role="status">{toast}</div>}
    </WorkspaceShell>
  );
}
