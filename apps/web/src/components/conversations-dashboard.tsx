'use client';

import {
  Archive,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CirclePlus,
  Clock3,
  Eye,
  ListFilter,
  MessageSquareText,
  MessagesSquare,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ClientApiError, clientApi } from '@/lib/client-api';
import type {
  AiApp,
  AppList,
  Conversation,
  ConversationDetail,
  ConversationGenerationResult,
  ConversationList,
  ConversationStats,
  ConversationStatus,
} from '@/lib/types';
import { ConfirmDialog } from './confirm-dialog';
import { ConversationDetailDialog } from './conversation-detail-dialog';
import {
  ConversationDialog,
  type ConversationFormInput,
} from './conversation-dialog';
import { ConversationStatusBadge } from './conversation-status-badge';
import { WorkspaceShell } from './workspace-shell';
import { WorkspaceStats } from './workspace-stats';

const pageSize = 8;

const statusOptions: Array<{ value: 'all' | ConversationStatus; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'active', label: '进行中' },
  { value: 'archived', label: '已归档' },
];

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function ConversationsDashboard() {
  const router = useRouter();
  const [data, setData] = useState<ConversationList>({ items: [], page: 1, pageSize, total: 0 });
  const [stats, setStats] = useState<ConversationStats>({ total: 0, active: 0, archived: 0, messages: 0 });
  const [apps, setApps] = useState<AiApp[]>([]);
  const [status, setStatus] = useState<'all' | ConversationStatus>('all');
  const [appId, setAppId] = useState('all');
  const [sort, setSort] = useState<'updated_desc' | 'created_desc' | 'title_asc'>('updated_desc');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingConversation, setEditingConversation] = useState<Conversation | null>(null);
  const [archivingConversation, setArchivingConversation] = useState<Conversation | null>(null);
  const [detailConversation, setDetailConversation] = useState<Conversation | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
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

  const loadConversations = useCallback(async () => {
    setLoading(true);
    setError('');
    const parameters = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort,
    });
    if (status !== 'all') parameters.set('status', status);
    if (appId !== 'all') parameters.set('appId', appId);
    if (search) parameters.set('search', search);

    try {
      const [conversations, conversationStats, appList] = await Promise.all([
        clientApi<ConversationList>(`/api/conversations?${parameters}`),
        clientApi<ConversationStats>('/api/conversations/stats'),
        clientApi<AppList>('/api/apps?pageSize=100&sort=name_asc'),
      ]);
      setData(conversations);
      setStats(conversationStats);
      setApps(appList.items);
    } catch (requestError) {
      handleApiError(requestError);
    } finally {
      setLoading(false);
    }
  }, [appId, handleApiError, page, reloadKey, search, sort, status]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
  const hasFilters = status !== 'all' || appId !== 'all' || search.length > 0;

  function openCreateDialog() {
    setEditingConversation(null);
    setDialogOpen(true);
  }

  function openEditDialog(conversation: Conversation) {
    setEditingConversation(conversation);
    setDialogOpen(true);
  }

  async function saveConversation(input: ConversationFormInput) {
    if (editingConversation) {
      await clientApi<Conversation>(`/api/conversations/${editingConversation.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: input.title }),
      });
      setToast('对话标题已更新');
    } else {
      await clientApi<Conversation>('/api/conversations', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      setToast('对话已创建');
      setPage(1);
      setStatus('all');
      setAppId('all');
      setSearchInput('');
      setSearch('');
    }
    setDialogOpen(false);
    setEditingConversation(null);
    setReloadKey((key) => key + 1);
  }

  async function openConversationDetail(conversation: Conversation) {
    setDetailConversation(conversation);
    setDetail(null);
    setDetailLoading(true);
    try {
      setDetail(await clientApi<ConversationDetail>(`/api/conversations/${conversation.id}`));
    } catch (requestError) {
      handleApiError(requestError);
      setDetailConversation(null);
    } finally {
      setDetailLoading(false);
    }
  }

  async function sendConversationMessage(message: string) {
    if (!detailConversation) return;
    try {
      await clientApi<ConversationGenerationResult>(
        `/api/conversations/${detailConversation.id}/generate`,
        { method: 'POST', body: JSON.stringify({ message }) },
      );
      const updatedDetail = await clientApi<ConversationDetail>(
        `/api/conversations/${detailConversation.id}`,
      );
      setDetail(updatedDetail);
      setDetailConversation(updatedDetail.conversation);
      setReloadKey((key) => key + 1);
    } catch (requestError) {
      if (requestError instanceof ClientApiError && requestError.status === 401) {
        handleApiError(requestError);
      } else {
        try {
          setDetail(await clientApi<ConversationDetail>(
            `/api/conversations/${detailConversation.id}`,
          ));
          setReloadKey((key) => key + 1);
        } catch {
          // Keep the existing timeline; the composer displays the original generation error.
        }
      }
      throw requestError;
    }
  }

  async function archiveSelectedConversation() {
    if (!archivingConversation) return;
    try {
      await clientApi<void>(`/api/conversations/${archivingConversation.id}`, { method: 'DELETE' });
      setArchivingConversation(null);
      setToast('对话已归档');
      setReloadKey((key) => key + 1);
    } catch (requestError) {
      handleApiError(requestError);
      throw requestError;
    }
  }

  async function restoreConversation(conversation: Conversation) {
    try {
      await clientApi<Conversation>(`/api/conversations/${conversation.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'active' }),
      });
      setToast('对话已恢复');
      setReloadKey((key) => key + 1);
    } catch (requestError) {
      handleApiError(requestError);
    }
  }

  return (
    <WorkspaceShell active="conversations" title="对话记录">
      <section className="workspaceHeader">
        <div className="pageTitle">
          <h1>对话记录</h1>
          <span>{data.total}</span>
        </div>
        <button className="primaryButton" type="button" onClick={openCreateDialog} disabled={!loading && apps.length === 0}>
          <CirclePlus size={18} />
          创建对话
        </button>
      </section>

      <WorkspaceStats
        label="对话概况"
        items={[
          { label: '对话总数', value: stats.total, icon: MessageSquareText },
          { label: '进行中', value: stats.active, icon: CircleCheck, tone: 'positive' },
          { label: '已归档', value: stats.archived, icon: Archive },
          { label: '消息总数', value: stats.messages, icon: MessagesSquare },
        ]}
      />

      <section className="toolbar" aria-label="对话筛选">
        <label className="searchBox">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="搜索标题、应用或消息"
            aria-label="搜索对话"
          />
        </label>
        <div className="toolbarControls conversationToolbarControls">
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
          <label className="sortSelect appFilterSelect">
            <ListFilter size={16} aria-hidden="true" />
            <select value={appId} onChange={(event) => { setAppId(event.target.value); setPage(1); }} aria-label="按应用筛选">
              <option value="all">全部应用</option>
              {apps.map((app) => <option value={app.id} key={app.id}>{app.name}</option>)}
            </select>
          </label>
          <label className="sortSelect">
            <ArrowUpDown size={16} aria-hidden="true" />
            <select value={sort} onChange={(event) => { setSort(event.target.value as typeof sort); setPage(1); }} aria-label="对话排序">
              <option value="updated_desc">最近更新</option>
              <option value="created_desc">最近创建</option>
              <option value="title_asc">标题排序</option>
            </select>
          </label>
        </div>
      </section>

      {error && (
        <div className="errorBanner" role="alert">
          <span>{error}</span>
          <button className="textButton" type="button" onClick={() => void loadConversations()}>
            <RefreshCw size={16} />重试
          </button>
        </div>
      )}

      <section className="dataSurface" aria-busy={loading}>
        <div className="conversationTableHeader" role="row">
          <span>对话</span>
          <span>所属应用</span>
          <span>消息</span>
          <span>状态</span>
          <span className="srOnly">操作</span>
        </div>

        {loading ? (
          <div className="loadingRows" aria-label="正在加载对话">
            {Array.from({ length: 5 }, (_, index) => (
              <div className="skeletonRow" key={index}><span /><span /><span /><span /></div>
            ))}
          </div>
        ) : data.items.length === 0 ? (
          <div className="emptyState">
            <span className="emptyIcon" aria-hidden="true"><MessageSquareText size={23} /></span>
            <h2>{hasFilters ? '没有匹配结果' : '还没有对话记录'}</h2>
            {!hasFilters && apps.length > 0 && (
              <button className="secondaryButton" type="button" onClick={openCreateDialog}>
                <CirclePlus size={17} />创建第一段对话
              </button>
            )}
          </div>
        ) : (
          <div className="tableBody">
            {data.items.map((item) => (
              <article className="conversationRow" key={item.id}>
                <div className="appIdentity">
                  <span className="appIcon conversationIcon" aria-hidden="true"><MessageSquareText size={18} /></span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.lastMessagePreview || '暂无消息'}</small>
                    <em className="rowTimestamp">活动于 {formatDate(item.lastMessageAt || item.updatedAt)}</em>
                  </span>
                </div>
                <span className="conversationApp">{item.appName}</span>
                <div className="conversationState">
                  <span className="attachmentCount"><MessagesSquare size={14} />{item.messageCount}</span>
                  <ConversationStatusBadge status={item.status} />
                </div>
                <div className="rowActions">
                  <button className="iconButton" type="button" onClick={() => void openConversationDetail(item)} aria-label={`查看 ${item.title}`} title="查看消息">
                    <Eye size={17} />
                  </button>
                  <button className="iconButton" type="button" onClick={() => openEditDialog(item)} aria-label={`重命名 ${item.title}`} title="重命名">
                    <Pencil size={17} />
                  </button>
                  {item.status === 'active' ? (
                    <button className="iconButton dangerHover" type="button" onClick={() => setArchivingConversation(item)} aria-label={`归档 ${item.title}`} title="归档">
                      <Archive size={17} />
                    </button>
                  ) : (
                    <button className="iconButton" type="button" onClick={() => void restoreConversation(item)} aria-label={`恢复 ${item.title}`} title="恢复">
                      <RotateCcw size={17} />
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

      <ConversationDialog
        open={dialogOpen}
        conversation={editingConversation}
        apps={apps}
        onClose={() => setDialogOpen(false)}
        onSave={saveConversation}
      />
      <ConversationDetailDialog
        open={Boolean(detailConversation)}
        detail={detail}
        loading={detailLoading}
        onSend={sendConversationMessage}
        onClose={() => { setDetailConversation(null); setDetail(null); }}
      />
      <ConfirmDialog
        open={Boolean(archivingConversation)}
        appName={archivingConversation?.title ?? ''}
        subjectLabel="对话"
        variant="archive"
        onClose={() => setArchivingConversation(null)}
        onConfirm={archiveSelectedConversation}
      />
      {toast && <div className="toast" role="status">{toast}</div>}
    </WorkspaceShell>
  );
}
