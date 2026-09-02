'use client';

import {
  ArrowUpDown,
  Ban,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock3,
  KeyRound,
  MailPlus,
  RefreshCw,
  RotateCw,
  Search,
  ShieldCheck,
  UserCog,
  UserRoundCheck,
  UsersRound,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ClientApiError, clientApi } from '@/lib/client-api';
import type {
  ManagedUser,
  MemberInvitation,
  MemberInvitationList,
  ManagedUserList,
  ManagedUserRole,
  ManagedUserStats,
  ManagedUserStatus,
} from '@/lib/types';
import { ConfirmDialog } from './confirm-dialog';
import {
  MemberInvitationDialog,
  type InvitationFormInput,
} from './member-invitation-dialog';
import { WorkspaceShell } from './workspace-shell';
import { WorkspaceStats } from './workspace-stats';

const pageSize = 10;

function formatDate(value: string | null) {
  if (!value) return '尚未登录';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function MembersDashboard() {
  const router = useRouter();
  const [data, setData] = useState<ManagedUserList>({
    items: [],
    page: 1,
    pageSize,
    total: 0,
  });
  const [stats, setStats] = useState<ManagedUserStats>({
    total: 0,
    active: 0,
    disabled: 0,
    admins: 0,
    pendingVerification: 0,
  });
  const [invitations, setInvitations] = useState<MemberInvitationList>({
    items: [],
    page: 1,
    pageSize: 20,
    total: 0,
  });
  const [status, setStatus] = useState<'all' | ManagedUserStatus>('all');
  const [role, setRole] = useState<'all' | ManagedUserRole>('all');
  const [sort, setSort] = useState<'created_desc' | 'last_login_desc' | 'name_asc'>('created_desc');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [disablingUser, setDisablingUser] = useState<ManagedUser | null>(null);
  const [revokingInvitation, setRevokingInvitation] = useState<MemberInvitation | null>(null);
  const [invitationDialogOpen, setInvitationDialogOpen] = useState(false);
  const [invitationActionId, setInvitationActionId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

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
        : '成员数据加载失败，请稍后重试',
    );
  }, [router]);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setError('');
    const parameters = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort,
    });
    if (status !== 'all') parameters.set('status', status);
    if (role !== 'all') parameters.set('role', role);
    if (search) parameters.set('search', search);
    try {
      const [members, memberStats, pendingInvitations] = await Promise.all([
        clientApi<ManagedUserList>(`/api/admin/users?${parameters}`),
        clientApi<ManagedUserStats>('/api/admin/users/stats'),
        clientApi<MemberInvitationList>('/api/admin/invitations?status=pending&pageSize=20'),
      ]);
      setData(members);
      setStats(memberStats);
      setInvitations(pendingInvitations);
    } catch (requestError) {
      handleApiError(requestError);
    } finally {
      setLoading(false);
    }
  }, [handleApiError, page, reloadKey, role, search, sort, status]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));
  const hasFilters = status !== 'all' || role !== 'all' || search.length > 0;

  async function updateMember(member: ManagedUser, input: { role?: ManagedUserRole; status?: ManagedUserStatus }) {
    setUpdatingId(member.id);
    setError('');
    try {
      await clientApi<ManagedUser>(`/api/admin/users/${member.id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
      setDisablingUser(null);
      setToast(input.role
        ? `已将 ${member.displayName} 设为${input.role === 'admin' ? '管理员' : '普通成员'}`
        : `${member.displayName} 已${input.status === 'active' ? '启用' : '停用'}`);
      setReloadKey((key) => key + 1);
    } catch (requestError) {
      handleApiError(requestError);
      throw requestError;
    } finally {
      setUpdatingId(null);
    }
  }

  async function inviteMember(input: InvitationFormInput) {
    try {
      await clientApi('/api/admin/invitations', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      setInvitationDialogOpen(false);
      setToast(`邀请已发送至 ${input.email}`);
      setReloadKey((key) => key + 1);
    } catch (requestError) {
      handleApiError(requestError);
      throw requestError;
    }
  }

  async function resendInvitation(invitation: MemberInvitation) {
    setInvitationActionId(invitation.id);
    setError('');
    try {
      await clientApi(`/api/admin/invitations/${invitation.id}/resend`, {
        method: 'POST',
      });
      setToast(`新邀请已发送至 ${invitation.email}`);
      setReloadKey((key) => key + 1);
    } catch (requestError) {
      handleApiError(requestError);
    } finally {
      setInvitationActionId(null);
    }
  }

  async function revokeInvitation() {
    if (!revokingInvitation) return;
    setInvitationActionId(revokingInvitation.id);
    try {
      await clientApi<void>(`/api/admin/invitations/${revokingInvitation.id}`, {
        method: 'DELETE',
      });
      setToast(`已撤销对 ${revokingInvitation.email} 的邀请`);
      setRevokingInvitation(null);
      setReloadKey((key) => key + 1);
    } catch (requestError) {
      handleApiError(requestError);
      throw requestError;
    } finally {
      setInvitationActionId(null);
    }
  }

  return (
    <WorkspaceShell active="members" title="成员管理">
      <section className="workspaceHeader">
        <div className="pageTitle">
          <h1>成员管理</h1>
          <span>{data.total}</span>
        </div>
        <button className="primaryButton" type="button" onClick={() => setInvitationDialogOpen(true)}>
          <MailPlus size={18} />
          邀请成员
        </button>
      </section>

      <WorkspaceStats
        label="成员概况"
        items={[
          { label: '成员总数', value: stats.total, icon: UsersRound },
          { label: '已启用', value: stats.active, icon: CircleCheck, tone: 'positive' },
          { label: '管理员', value: stats.admins, icon: ShieldCheck },
          { label: '待验证邮箱', value: stats.pendingVerification, icon: Clock3, tone: 'warning' },
        ]}
      />

      {invitations.total > 0 && (
        <section className="pendingInvitations" aria-labelledby="pending-invitations-title">
          <header>
            <div>
              <span className="pendingInvitationsIcon" aria-hidden="true"><MailPlus size={17} /></span>
              <span>
                <h2 id="pending-invitations-title">待接受邀请</h2>
                <small>{invitations.total} 封邀请等待成员响应</small>
              </span>
            </div>
          </header>
          <div className="pendingInvitationList">
            {invitations.items.map((invitation) => (
              <article className="pendingInvitationRow" key={invitation.id}>
                <span className="pendingInvitationEmail">
                  <strong>{invitation.email}</strong>
                  <small>
                    {invitation.role === 'admin' ? '管理员' : '普通成员'} · 到期 {formatDate(invitation.expiresAt)}
                  </small>
                </span>
                <span className="pendingInvitationSends">已发送 {invitation.sendCount} 次</span>
                <div className="rowActions">
                  <button
                    className="iconButton"
                    type="button"
                    onClick={() => void resendInvitation(invitation)}
                    disabled={invitationActionId === invitation.id}
                    aria-label={`重新发送给 ${invitation.email}`}
                    title="重新发送"
                  >
                    <RotateCw className={invitationActionId === invitation.id ? 'spin' : ''} size={16} />
                  </button>
                  <button
                    className="iconButton dangerHover"
                    type="button"
                    onClick={() => setRevokingInvitation(invitation)}
                    disabled={invitationActionId === invitation.id}
                    aria-label={`撤销对 ${invitation.email} 的邀请`}
                    title="撤销邀请"
                  >
                    <Ban size={16} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="toolbar memberToolbar" aria-label="成员筛选">
        <label className="searchBox">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="搜索姓名或邮箱"
            aria-label="搜索姓名或邮箱"
          />
        </label>
        <div className="toolbarControls memberToolbarControls">
          <div className="segmentedControl" aria-label="账号状态筛选">
            {([
              ['all', '全部'],
              ['active', '已启用'],
              ['disabled', '已停用'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                className={status === value ? 'selected' : ''}
                type="button"
                onClick={() => {
                  setStatus(value);
                  setPage(1);
                }}
                aria-pressed={status === value}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="sortSelect memberFilterSelect">
            <UserCog size={16} aria-hidden="true" />
            <select
              value={role}
              onChange={(event) => {
                setRole(event.target.value as typeof role);
                setPage(1);
              }}
              aria-label="角色筛选"
            >
              <option value="all">全部角色</option>
              <option value="admin">管理员</option>
              <option value="member">普通成员</option>
            </select>
          </label>
          <label className="sortSelect memberFilterSelect">
            <ArrowUpDown size={16} aria-hidden="true" />
            <select
              value={sort}
              onChange={(event) => {
                setSort(event.target.value as typeof sort);
                setPage(1);
              }}
              aria-label="成员排序"
            >
              <option value="created_desc">最近加入</option>
              <option value="last_login_desc">最近登录</option>
              <option value="name_asc">姓名排序</option>
            </select>
          </label>
        </div>
      </section>

      {error && (
        <div className="errorBanner" role="alert">
          <span>{error}</span>
          <button className="textButton" type="button" onClick={() => void loadMembers()}>
            <RefreshCw size={16} />
            重试
          </button>
        </div>
      )}

      <section className="dataSurface memberSurface" aria-busy={loading}>
        <div className="memberTableHeader" role="row">
          <span>成员</span>
          <span>角色</span>
          <span>邮箱安全</span>
          <span>会话</span>
          <span>状态</span>
          <span className="srOnly">操作</span>
        </div>

        {loading ? (
          <div className="loadingRows" aria-label="正在加载成员">
            {Array.from({ length: 6 }, (_, index) => (
              <div className="skeletonRow" key={index}>
                <span /><span /><span /><span />
              </div>
            ))}
          </div>
        ) : data.items.length === 0 ? (
          <div className="emptyState">
            <span className="emptyIcon" aria-hidden="true"><UsersRound size={23} /></span>
            <h2>{hasFilters ? '没有匹配的成员' : '还没有成员'}</h2>
          </div>
        ) : (
          <div className="tableBody">
            {data.items.map((member) => (
              <article className="memberRow" key={member.id}>
                <div className="memberIdentity">
                  <span className="memberAvatar" aria-hidden="true">
                    {member.displayName.trim().slice(0, 1).toUpperCase() || 'U'}
                  </span>
                  <span>
                    <strong>
                      {member.displayName}
                      {member.current && <em>当前账号</em>}
                    </strong>
                    <small>{member.email}</small>
                    <span className="memberMetaLine">最近登录：{formatDate(member.lastLoginAt)}</span>
                  </span>
                </div>

                <label className="memberRoleSelect">
                  <ShieldCheck size={15} aria-hidden="true" />
                  <select
                    value={member.role}
                    disabled={member.current || updatingId === member.id}
                    onChange={(event) => {
                      void updateMember(member, {
                        role: event.target.value as ManagedUserRole,
                      }).catch(() => undefined);
                    }}
                    aria-label={`设置 ${member.displayName} 的角色`}
                    title={member.current ? '不能修改自己的角色' : '设置角色'}
                  >
                    <option value="admin">管理员</option>
                    <option value="member">普通成员</option>
                  </select>
                </label>

                <div className="memberSecurityState">
                  <span className={`memberVerification ${member.emailVerifiedAt ? 'verified' : 'pending'}`}>
                    {member.emailVerifiedAt ? <CircleCheck size={14} /> : <Clock3 size={14} />}
                    {member.emailVerifiedAt ? '已验证' : '待验证'}
                  </span>
                  <small><KeyRound size={12} />{member.mfaEnabledAt ? 'MFA 已启用' : 'MFA 未启用'}</small>
                </div>

                <span className="memberSessions">{member.activeSessions}</span>
                <span className={`statusBadge status-${member.status}`}>
                  {member.status === 'active' ? '已启用' : '已停用'}
                </span>
                <div className="rowActions memberActions">
                  {!member.current && member.status === 'active' && (
                    <button
                      className="iconButton dangerHover"
                      type="button"
                      onClick={() => setDisablingUser(member)}
                      disabled={updatingId === member.id}
                      aria-label={`停用 ${member.displayName}`}
                      title="停用账号"
                    >
                      <Ban size={17} />
                    </button>
                  )}
                  {!member.current && member.status === 'disabled' && (
                    <button
                      className="iconButton"
                      type="button"
                      onClick={() => {
                        void updateMember(member, { status: 'active' }).catch(() => undefined);
                      }}
                      disabled={updatingId === member.id}
                      aria-label={`启用 ${member.displayName}`}
                      title="启用账号"
                    >
                      <UserRoundCheck size={17} />
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

      <ConfirmDialog
        open={Boolean(disablingUser)}
        appName={disablingUser?.displayName ?? ''}
        subjectLabel="账号"
        onClose={() => setDisablingUser(null)}
        onConfirm={() => updateMember(disablingUser!, { status: 'disabled' }).then(() => undefined)}
      />
      <ConfirmDialog
        open={Boolean(revokingInvitation)}
        appName={revokingInvitation?.email ?? ''}
        subjectLabel="邀请"
        variant="revoke"
        onClose={() => setRevokingInvitation(null)}
        onConfirm={revokeInvitation}
      />
      <MemberInvitationDialog
        open={invitationDialogOpen}
        onClose={() => setInvitationDialogOpen(false)}
        onInvite={inviteMember}
      />
      {toast && <div className="toast" role="status">{toast}</div>}
    </WorkspaceShell>
  );
}
