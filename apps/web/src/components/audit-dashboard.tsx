'use client';

import {
  Activity,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Filter,
  LogIn,
  LogOut,
  LoaderCircle,
  Mail,
  MapPin,
  MonitorSmartphone,
  RefreshCw,
  ScrollText,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  UserRound,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ClientApiError, clientApi } from '@/lib/client-api';
import {
  describeSecurityEvent,
  securityEventTypeLabels,
} from '@/lib/security-event-display';
import type {
  AdminAuditEvent,
  AdminAuditEventList,
  AdminAuditRange,
  AdminAuditStats,
  SecurityEvent,
} from '@/lib/types';
import { WorkspaceShell } from './workspace-shell';
import { WorkspaceStats } from './workspace-stats';

const pageSize = 12;

const rangeOptions: Array<{ value: AdminAuditRange; label: string }> = [
  { value: '24h', label: '最近 24 小时' },
  { value: '7d', label: '最近 7 天' },
  { value: '30d', label: '最近 30 天' },
  { value: '90d', label: '最近 90 天' },
  { value: 'all', label: '全部时间' },
];

const eventOptions = Object.entries(securityEventTypeLabels) as Array<
  [SecurityEvent['eventType'], string]
>;

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function iconForEvent(event: AdminAuditEvent): LucideIcon {
  if (event.outcome === 'failure') return ShieldAlert;
  if (event.eventType === 'admin_audit_exported') return Download;
  if (event.eventType === 'login_succeeded') return LogIn;
  if (
    event.eventType === 'logout'
    || event.eventType === 'session_revoked'
    || event.eventType === 'all_sessions_revoked'
  ) return LogOut;
  if (event.eventType === 'account_registered') return UserPlus;
  if (
    event.eventType === 'user_role_changed'
    || event.eventType === 'user_status_changed'
  ) return UsersRound;
  if (event.eventType.startsWith('member_invitation')) return Mail;
  if (
    event.eventType.startsWith('password_')
    || event.eventType.startsWith('mfa_')
    || event.eventType.startsWith('email_')
    || event.eventType === 'refresh_token_reused'
    || event.eventType === 'account_locked'
    || event.eventType === 'account_unlocked'
  ) return ShieldCheck;
  return Activity;
}

export function AuditDashboard() {
  const router = useRouter();
  const [data, setData] = useState<AdminAuditEventList>({
    items: [],
    page: 1,
    pageSize,
    total: 0,
  });
  const [stats, setStats] = useState<AdminAuditStats>({
    total: 0,
    failures: 0,
    affectedMembers: 0,
    adminActions: 0,
  });
  const [range, setRange] = useState<AdminAuditRange>('30d');
  const [eventType, setEventType] = useState<'all' | SecurityEvent['eventType']>('all');
  const [outcome, setOutcome] = useState<'all' | SecurityEvent['outcome']>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
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
    const timeout = window.setTimeout(() => setToast(''), 4000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const handleApiError = useCallback((requestError: unknown) => {
    if (requestError instanceof ClientApiError && requestError.status === 401) {
      router.replace('/login');
      router.refresh();
      return;
    }
    if (requestError instanceof ClientApiError && requestError.status === 403) {
      router.replace('/overview');
      router.refresh();
      return;
    }
    setError(
      requestError instanceof ClientApiError
        ? requestError.message
        : '审计日志加载失败，请稍后重试',
    );
  }, [router]);

  const loadAuditEvents = useCallback(async () => {
    setLoading(true);
    setError('');
    const parameters = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      range,
    });
    if (eventType !== 'all') parameters.set('eventType', eventType);
    if (outcome !== 'all') parameters.set('outcome', outcome);
    if (search) parameters.set('search', search);

    try {
      const [events, auditStats] = await Promise.all([
        clientApi<AdminAuditEventList>(`/api/admin/audit-events?${parameters}`),
        clientApi<AdminAuditStats>(`/api/admin/audit-events/stats?range=${range}`),
      ]);
      setData(events);
      setStats(auditStats);
    } catch (requestError) {
      handleApiError(requestError);
    } finally {
      setLoading(false);
    }
  }, [eventType, handleApiError, outcome, page, range, search]);

  useEffect(() => {
    void loadAuditEvents();
  }, [loadAuditEvents]);

  async function exportAuditEvents() {
    setExporting(true);
    setError('');
    const parameters = new URLSearchParams({ range });
    if (eventType !== 'all') parameters.set('eventType', eventType);
    if (outcome !== 'all') parameters.set('outcome', outcome);
    const exportSearch = searchInput.trim();
    if (exportSearch) parameters.set('search', exportSearch);

    try {
      const response = await fetch(`/api/admin/audit-events/export?${parameters}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as {
          error?: { code?: string; message?: string };
        } | null;
        throw new ClientApiError(
          response.status,
          payload?.error?.code ?? 'AUDIT_EXPORT_FAILED',
          payload?.error?.message ?? '审计日志导出失败',
        );
      }

      const disposition = response.headers.get('Content-Disposition') ?? '';
      const filename = disposition.match(/filename="([^"]+)"/u)?.[1]
        ?? 'knowledgehub-audit.csv';
      const rowCount = Number(response.headers.get('X-Export-Row-Count') ?? 0);
      const truncated = response.headers.get('X-Export-Truncated') === 'true';
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setToast(
        truncated
          ? `已导出前 ${rowCount.toLocaleString('zh-CN')} 条，请缩小筛选范围获取其余记录`
          : `已导出 ${rowCount.toLocaleString('zh-CN')} 条审计记录`,
      );
      await loadAuditEvents();
    } catch (requestError) {
      handleApiError(requestError);
    } finally {
      setExporting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
  const hasFilters = eventType !== 'all' || outcome !== 'all' || search.length > 0;

  return (
    <WorkspaceShell active="audit" title="审计日志">
      <section className="workspaceHeader">
        <div className="pageTitle">
          <h1>审计日志</h1>
          <span>{data.total}</span>
        </div>
        <button
          className="secondaryButton"
          type="button"
          onClick={() => void exportAuditEvents()}
          disabled={exporting}
        >
          {exporting ? <LoaderCircle className="spin" size={18} /> : <Download size={18} />}
          {exporting ? '正在导出' : '导出 CSV'}
        </button>
      </section>

      <WorkspaceStats
        label="审计概况"
        items={[
          { label: '事件总数', value: stats.total, icon: ScrollText },
          { label: '失败与拦截', value: stats.failures, icon: ShieldAlert, tone: 'warning' },
          { label: '涉及成员', value: stats.affectedMembers, icon: UserRound },
          { label: '管理操作', value: stats.adminActions, icon: ShieldCheck, tone: 'positive' },
        ]}
      />

      <section className="toolbar auditToolbar" aria-label="审计日志筛选">
        <label className="searchBox">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="搜索成员、操作人、邀请邮箱或 IP"
            aria-label="搜索成员、操作人、邀请邮箱或 IP"
          />
        </label>
        <div className="toolbarControls auditToolbarControls">
          <div className="segmentedControl" aria-label="执行结果筛选">
            {([['all', '全部'], ['success', '成功'], ['failure', '已拦截']] as const).map(
              ([value, label]) => (
                <button
                  key={value}
                  className={outcome === value ? 'selected' : ''}
                  type="button"
                  onClick={() => {
                    setOutcome(value);
                    setPage(1);
                  }}
                  aria-pressed={outcome === value}
                >
                  {label}
                </button>
              ),
            )}
          </div>
          <label className="sortSelect auditFilterSelect">
            <Filter size={16} aria-hidden="true" />
            <select
              value={eventType}
              onChange={(event) => {
                setEventType(event.target.value as typeof eventType);
                setPage(1);
              }}
              aria-label="事件类型筛选"
            >
              <option value="all">全部事件</option>
              {eventOptions.map(([value, label]) => (
                <option value={value} key={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="sortSelect auditFilterSelect">
            <CalendarClock size={16} aria-hidden="true" />
            <select
              value={range}
              onChange={(event) => {
                setRange(event.target.value as AdminAuditRange);
                setPage(1);
              }}
              aria-label="时间范围"
            >
              {rangeOptions.map((option) => (
                <option value={option.value} key={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {error && (
        <div className="errorBanner" role="alert">
          <span>{error}</span>
          <button className="textButton" type="button" onClick={() => void loadAuditEvents()}>
            <RefreshCw size={16} />
            重试
          </button>
        </div>
      )}

      <section className="dataSurface auditSurface" aria-busy={loading}>
        <div className="auditTableHeader" role="row">
          <span>事件</span>
          <span>影响账号</span>
          <span>操作人</span>
          <span>来源与时间</span>
        </div>

        {loading ? (
          <div className="loadingRows" aria-label="正在加载审计日志">
            {Array.from({ length: 7 }, (_, index) => (
              <div className="skeletonRow" key={index}>
                <span /><span /><span /><span />
              </div>
            ))}
          </div>
        ) : data.items.length === 0 ? (
          <div className="emptyState">
            <span className="emptyIcon" aria-hidden="true"><ScrollText size={23} /></span>
            <h2>{hasFilters ? '没有匹配的审计记录' : '当前时间范围内暂无审计记录'}</h2>
          </div>
        ) : (
          <div className="auditTableBody">
            {data.items.map((event) => {
              const description = describeSecurityEvent(event);
              const EventIcon = iconForEvent(event);
              const sameActor = event.actor.id === event.subject.id;
              const targetEmail = typeof event.metadata.targetEmail === 'string'
                ? event.metadata.targetEmail
                : null;
              return (
                <article className="auditRow" key={event.id}>
                  <div className="auditEventIdentity">
                    <span
                      className={`auditEventIcon ${event.outcome}`}
                      aria-hidden="true"
                    >
                      <EventIcon size={17} />
                    </span>
                    <span>
                      <strong>
                        {description.title}
                        <em className={`auditOutcome ${event.outcome}`}>
                          {event.outcome === 'failure' ? '已拦截' : '成功'}
                        </em>
                      </strong>
                      <small>{description.detail}</small>
                      {targetEmail && <span className="auditTargetEmail">{targetEmail}</span>}
                    </span>
                  </div>
                  <div className="auditPerson">
                    <span className="auditAvatar" aria-hidden="true">
                      {event.subject.displayName.trim().slice(0, 1).toUpperCase() || 'U'}
                    </span>
                    <span>
                      <strong>{event.subject.displayName}</strong>
                      <small>{event.subject.email}</small>
                    </span>
                  </div>
                  <div className="auditPerson auditActor">
                    <span className="auditAvatar actor" aria-hidden="true">
                      {event.actor.displayName.trim().slice(0, 1).toUpperCase() || 'U'}
                    </span>
                    <span>
                      <strong>{event.actor.displayName}{sameActor && <em>本人</em>}</strong>
                      <small>{event.actor.email}</small>
                    </span>
                  </div>
                  <div className="auditSource">
                    <span><MonitorSmartphone size={13} />{event.deviceName}</span>
                    <span><MapPin size={13} />{event.ipAddress || 'IP 未记录'}</span>
                    <span><Clock3 size={13} />{formatDate(event.createdAt)}</span>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {!loading && data.total > 0 && (
          <footer className="pagination">
            <span>第 {page} / {totalPages} 页 · 共 {data.total} 条</span>
            <div>
              <button
                className="iconButton"
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page === 1}
                aria-label="上一页"
                title="上一页"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                className="iconButton"
                type="button"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page >= totalPages}
                aria-label="下一页"
                title="下一页"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </footer>
        )}
      </section>
      {toast && <div className="toast" role="status">{toast}</div>}
    </WorkspaceShell>
  );
}
