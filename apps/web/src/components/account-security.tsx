'use client';

import {
  Eye,
  EyeOff,
  AlertTriangle,
  CircleHelp,
  Clock3,
  ChevronDown,
  ChevronUp,
  KeyRound,
  Laptop,
  LoaderCircle,
  LogOut,
  LogIn,
  MapPin,
  MonitorSmartphone,
  Save,
  ShieldCheck,
  ShieldAlert,
  Smartphone,
  Tablet,
  History,
  UserRound,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ClientApiError, clientApi } from '@/lib/client-api';
import {
  assessPassword,
  PASSWORD_MAX_CHARACTERS,
  PASSWORD_MIN_CHARACTERS,
} from '@/lib/password-policy';
import type {
  AuthSession,
  SecurityEvent,
  SecurityEventList,
  SessionSummary,
  User,
} from '@/lib/types';
import { PasswordStrength } from './password-strength';
import { SessionRevokeDialog } from './session-revoke-dialog';
import { WorkspaceShell } from './workspace-shell';

export function AccountSecurity() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [profileName, setProfileName] = useState('');
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');
  const [profileSubmitting, setProfileSubmitting] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(null);
  const [sessionError, setSessionError] = useState('');
  const [sessionSuccess, setSessionSuccess] = useState('');
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [revokeAllDialogOpen, setRevokeAllDialogOpen] = useState(false);
  const [revokingSession, setRevokingSession] = useState<AuthSession | null>(null);
  const [securityEvents, setSecurityEvents] = useState<SecurityEventList | null>(null);
  const [securityEventError, setSecurityEventError] = useState('');
  const [showAllSecurityEvents, setShowAllSecurityEvents] = useState(false);

  const loadSecurityEvents = useCallback(async () => {
    setSecurityEventError('');
    try {
      setSecurityEvents(await clientApi<SecurityEventList>('/api/auth/security-events?limit=20'));
    } catch (requestError) {
      if (requestError instanceof ClientApiError && requestError.status === 401) {
        router.replace('/login');
        router.refresh();
        return;
      }
      setSecurityEventError('安全活动加载失败，请稍后重试');
    }
  }, [router]);

  useEffect(() => {
    let mounted = true;
    clientApi<User>('/api/auth/session')
      .then((currentUser) => {
        if (mounted) {
          setUser(currentUser);
          setProfileName(currentUser.displayName);
        }
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof ClientApiError && requestError.status === 401) {
          router.replace('/login');
          router.refresh();
          return;
        }
        if (mounted) setProfileError('账号信息加载失败，请稍后重试');
      });
    clientApi<SessionSummary>('/api/auth/sessions')
      .then((summary) => {
        if (mounted) setSessionSummary(summary);
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof ClientApiError && requestError.status === 401) {
          router.replace('/login');
          router.refresh();
          return;
        }
        if (mounted) setSessionError('会话状态加载失败，请稍后重试');
      });
    void loadSecurityEvents();
    return () => {
      mounted = false;
    };
  }, [loadSecurityEvents, router]);

  const passwordAssessment = useMemo(
    () => assessPassword(newPassword, {
      email: user?.email,
      displayName: user?.displayName,
    }),
    [newPassword, user],
  );
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const passwordChanged = newPassword.length > 0 && newPassword !== currentPassword;
  const formReady = Boolean(
    user && currentPassword && passwordAssessment.acceptable && passwordsMatch && passwordChanged,
  );
  const trimmedProfileName = profileName.trim();
  const profileReady = Boolean(
    user && trimmedProfileName && trimmedProfileName !== user.displayName,
  );
  const userInitial = user?.displayName.trim().slice(0, 1).toUpperCase() || 'U';
  const visibleSessions = sessionSummary?.items.slice(
    0,
    showAllSessions ? sessionSummary.items.length : 5,
  ) ?? [];
  const visibleSecurityEvents = securityEvents?.items.slice(
    0,
    showAllSecurityEvents ? securityEvents.items.length : 6,
  ) ?? [];

  async function handleProfileSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileError('');
    setProfileSuccess('');
    if (!profileReady) return;

    setProfileSubmitting(true);
    try {
      const updatedUser = await clientApi<User>('/api/auth/session', {
        method: 'PATCH',
        body: JSON.stringify({ displayName: trimmedProfileName }),
      });
      setUser(updatedUser);
      setProfileName(updatedUser.displayName);
      setProfileSuccess('个人资料已保存');
      await loadSecurityEvents();
      window.dispatchEvent(
        new CustomEvent<User>('knowledgehub:user-updated', { detail: updatedUser }),
      );
    } catch (requestError) {
      setProfileError(
        requestError instanceof ClientApiError
          ? requestError.message
          : '个人资料保存失败，请稍后重试',
      );
    } finally {
      setProfileSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (!passwordChanged) {
      setError('新密码不能与当前密码相同');
      return;
    }
    if (!passwordsMatch) {
      setError('两次输入的新密码不一致');
      return;
    }
    if (!passwordAssessment.acceptable) {
      setError('新密码安全等级未达到要求');
      return;
    }

    setSubmitting(true);
    try {
      await clientApi<void>('/api/auth/password', {
        method: 'PATCH',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      router.replace('/login?passwordChanged=1');
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof ClientApiError
          ? requestError.message
          : '密码更新失败，请稍后重试',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevokeAllSessions() {
    setSessionError('');
    setSessionSuccess('');
    try {
      await clientApi<{ revokedSessions: number }>('/api/auth/sessions', {
        method: 'DELETE',
      });
      router.replace('/login?sessionsRevoked=1');
      router.refresh();
    } catch (requestError) {
      setSessionError(
        requestError instanceof ClientApiError
          ? requestError.message
          : '无法退出全部设备，请稍后重试',
      );
      throw requestError;
    }
  }

  async function handleRevokeSession(session: AuthSession) {
    setSessionError('');
    setSessionSuccess('');
    try {
      const result = await clientApi<{ revokedSession: boolean; currentSession: boolean }>(
        `/api/auth/sessions/${session.id}`,
        { method: 'DELETE' },
      );
      if (result.currentSession) {
        router.replace('/login?sessionsRevoked=1');
        router.refresh();
        return;
      }
      setSessionSummary((current) => current ? {
        ...current,
        activeSessions: Math.max(0, current.activeSessions - 1),
        items: current.items.filter((item) => item.id !== session.id),
      } : current);
      setRevokingSession(null);
      setSessionSuccess('设备已退出');
      await loadSecurityEvents();
    } catch (requestError) {
      setSessionError(
        requestError instanceof ClientApiError
          ? requestError.message
          : '无法退出该设备，请稍后重试',
      );
      throw requestError;
    }
  }

  function formatLastLogin(value: string | null | undefined) {
    if (!value) return '暂无记录';
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  }

  function formatSessionDate(value: string) {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  }

  function describeSecurityEvent(event: SecurityEvent) {
    switch (event.eventType) {
      case 'account_registered':
        return { title: '账号已创建', detail: '企业账号注册完成' };
      case 'login_succeeded':
        return { title: '登录成功', detail: '已建立新的设备会话' };
      case 'login_failed':
        return {
          title: '登录失败',
          detail: event.metadata.reason === 'account_disabled'
            ? '已拦截停用账号的登录尝试'
            : event.metadata.reason === 'account_locked'
              ? '临时锁定期间拦截了新的登录尝试'
            : '已拦截凭据错误的登录尝试',
        };
      case 'account_locked':
        return { title: '账号已临时锁定', detail: '连续登录失败达到保护上限' };
      case 'account_unlocked':
        return { title: '账号锁定已解除', detail: '临时保护期结束，已恢复登录' };
      case 'profile_updated':
        return { title: '个人资料已更新', detail: '账号显示信息发生变更' };
      case 'password_changed':
        return { title: '密码已更新', detail: '所有设备会话已同步失效' };
      case 'refresh_token_reused':
        return { title: '检测到会话令牌重放', detail: '疑似会话凭据泄露，已自动撤销该设备' };
      case 'session_revoked':
        return { title: '设备会话已退出', detail: '已撤销指定设备的访问权限' };
      case 'all_sessions_revoked':
        return { title: '所有设备已退出', detail: '已撤销账号的全部活跃会话' };
      case 'logout':
        return { title: '已主动退出', detail: '当前设备会话已结束' };
    }
  }

  return (
    <WorkspaceShell active="settings" title="账户设置">
      <section className="workspaceHeader">
        <div className="pageTitle">
          <h1>账户设置</h1>
        </div>
      </section>

      <div className="settingsLayout">
        <aside className="settingsIdentity" aria-label="当前账号">
          <span className="settingsAvatar" aria-hidden="true">{userInitial}</span>
          <span className="settingsIdentityText">
            <strong>{user?.displayName ?? '加载中'}</strong>
            <small>{user?.email ?? ''}</small>
          </span>
          <span className="settingsRole">成员</span>
        </aside>

        <div className="settingsContent">
          <section className="settingsSection" aria-labelledby="profile-settings-title">
            <header className="settingsSectionHeader">
              <span className="settingsSectionIcon" aria-hidden="true"><UserRound size={19} /></span>
              <div>
                <h2 id="profile-settings-title">个人资料</h2>
                <span>成员账号</span>
              </div>
            </header>

            <form className="settingsForm profileSettingsForm" onSubmit={handleProfileSubmit}>
              <label className="field">
                <span>显示名称</span>
                <input
                  name="displayName"
                  value={profileName}
                  onChange={(event) => {
                    setProfileName(event.target.value);
                    setProfileError('');
                    setProfileSuccess('');
                  }}
                  autoComplete="name"
                  maxLength={80}
                  required
                />
              </label>

              <label className="field">
                <span>登录邮箱</span>
                <input value={user?.email ?? ''} readOnly aria-readonly="true" />
              </label>

              {profileError && <div className="formError" role="alert">{profileError}</div>}
              {profileSuccess && <div className="formSuccess" role="status">{profileSuccess}</div>}

              <div className="settingsFormActions">
                <button
                  className="primaryButton"
                  type="submit"
                  disabled={profileSubmitting || !profileReady}
                >
                  {profileSubmitting ? <LoaderCircle className="spin" size={18} /> : <Save size={18} />}
                  {profileSubmitting ? '正在保存' : '保存资料'}
                </button>
              </div>
            </form>
          </section>

          <section className="settingsSection" aria-labelledby="password-settings-title">
          <header className="settingsSectionHeader">
            <span className="settingsSectionIcon" aria-hidden="true"><KeyRound size={19} /></span>
            <div>
              <h2 id="password-settings-title">密码与登录</h2>
              <span>强密码保护已启用</span>
            </div>
          </header>

          <form className="settingsForm" onSubmit={handleSubmit}>
            <label className="field">
              <span>当前密码</span>
              <span className="passwordInput">
                <input
                  name="currentPassword"
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  autoComplete="current-password"
                  maxLength={PASSWORD_MAX_CHARACTERS}
                  required
                />
                <button
                  className="inputIconButton"
                  type="button"
                  onClick={() => setShowCurrentPassword((visible) => !visible)}
                  aria-label={showCurrentPassword ? '隐藏当前密码' : '显示当前密码'}
                  title={showCurrentPassword ? '隐藏当前密码' : '显示当前密码'}
                >
                  {showCurrentPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>

            <label className="field">
              <span>新密码</span>
              <span className="passwordInput">
                <input
                  name="newPassword"
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={PASSWORD_MIN_CHARACTERS}
                  maxLength={PASSWORD_MAX_CHARACTERS}
                  aria-describedby="settings-password-policy"
                  aria-invalid={newPassword.length > 0 && !passwordChanged}
                  required
                />
                <button
                  className="inputIconButton"
                  type="button"
                  onClick={() => setShowNewPassword((visible) => !visible)}
                  aria-label={showNewPassword ? '隐藏新密码' : '显示新密码'}
                  title={showNewPassword ? '隐藏新密码' : '显示新密码'}
                >
                  {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
              {newPassword.length > 0 && !passwordChanged && (
                <small className="fieldHintError">新密码不能与当前密码相同</small>
              )}
            </label>

            <PasswordStrength assessment={passwordAssessment} id="settings-password-policy" />

            <label className="field">
              <span>确认新密码</span>
              <input
                name="confirmPassword"
                type={showNewPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                minLength={PASSWORD_MIN_CHARACTERS}
                maxLength={PASSWORD_MAX_CHARACTERS}
                aria-invalid={confirmPassword.length > 0 && !passwordsMatch}
                required
              />
              {confirmPassword.length > 0 && (
                <small className={passwordsMatch ? 'fieldSuccess' : 'fieldHintError'}>
                  {passwordsMatch ? '两次密码一致' : '两次输入的新密码不一致'}
                </small>
              )}
            </label>

            <div className="securityNotice">
              <ShieldCheck size={18} aria-hidden="true" />
              <span>
                <strong>密码与会话保护</strong>
                <small>新密码不能使用近期密码。</small>
                <small>更新后，所有设备都需要使用新密码重新登录。</small>
              </span>
            </div>

            {error && <div className="formError" role="alert">{error}</div>}

            <div className="settingsFormActions">
              <button className="primaryButton" type="submit" disabled={submitting || !formReady}>
                {submitting ? <LoaderCircle className="spin" size={18} /> : <KeyRound size={18} />}
                {submitting ? '正在更新' : '更新密码'}
              </button>
            </div>
          </form>
          </section>

          <section className="settingsSection" aria-labelledby="session-settings-title">
            <header className="settingsSectionHeader">
              <span className="settingsSectionIcon" aria-hidden="true">
                <MonitorSmartphone size={19} />
              </span>
              <div>
                <h2 id="session-settings-title">登录会话</h2>
                <span>账号访问状态</span>
              </div>
            </header>

            <div className="sessionOverview">
              <span className="sessionMetric">
                <strong>{sessionSummary?.activeSessions ?? '—'}</strong>
                <small>活跃登录</small>
              </span>
              <span className="sessionMetric">
                <strong>{formatLastLogin(sessionSummary?.lastLoginAt)}</strong>
                <small>最近登录</small>
              </span>
            </div>

            <div
              className={`loginProtectionStatus${sessionSummary?.loginProtection.status === 'locked' ? ' locked' : ''}`}
              role="status"
            >
              {sessionSummary?.loginProtection.status === 'locked'
                ? <ShieldAlert size={18} aria-hidden="true" />
                : <ShieldCheck size={18} aria-hidden="true" />}
              <span>
                <strong>
                  {sessionSummary?.loginProtection.status === 'locked'
                    ? '账号已临时锁定'
                    : '异常登录保护已启用'}
                </strong>
                <small>
                  {sessionSummary?.loginProtection.status === 'locked'
                    && sessionSummary.loginProtection.lockedUntil
                    ? `已记录 ${sessionSummary.loginProtection.failedAttempts} 次失败，锁定至 ${formatSessionDate(sessionSummary.loginProtection.lockedUntil)}`
                    : sessionSummary
                      ? `${sessionSummary.loginProtection.failureWindowMinutes} 分钟内连续 ${sessionSummary.loginProtection.failureLimit} 次失败，将锁定 ${sessionSummary.loginProtection.lockoutMinutes} 分钟`
                      : '正在读取账号保护策略'}
                </small>
              </span>
            </div>

            <div className="sessionList" aria-label="活跃登录设备">
              {sessionSummary === null ? (
                <div className="sessionListLoading"><LoaderCircle className="spin" size={18} />正在加载设备</div>
              ) : sessionSummary.items.length === 0 ? (
                <div className="sessionListLoading">没有活跃设备</div>
              ) : visibleSessions.map((session) => {
                const DeviceIcon = session.deviceType === 'mobile'
                  ? Smartphone
                  : session.deviceType === 'tablet'
                    ? Tablet
                    : session.deviceType === 'desktop'
                      ? Laptop
                      : CircleHelp;
                return (
                  <article className="sessionRow" key={session.id}>
                    <span className="sessionDeviceIcon" aria-hidden="true"><DeviceIcon size={18} /></span>
                    <div className="sessionDeviceDetails">
                      <header>
                        <strong>{session.deviceName}</strong>
                        {session.current && <span className="sessionCurrentBadge">当前设备</span>}
                      </header>
                      <span><MapPin size={13} />{session.ipAddress || 'IP 未记录'}</span>
                      <span><Clock3 size={13} />最近活动 {formatSessionDate(session.lastUsedAt)}</span>
                      <small>登录于 {formatSessionDate(session.createdAt)} · 到期 {formatSessionDate(session.expiresAt)}</small>
                    </div>
                    <button
                      className="iconButton dangerHover"
                      type="button"
                      onClick={() => setRevokingSession(session)}
                      aria-label={session.current ? '退出当前设备' : `退出 ${session.deviceName}`}
                      title={session.current ? '退出当前设备' : '退出此设备'}
                    >
                      <LogOut size={17} />
                    </button>
                  </article>
                );
              })}
              {sessionSummary && sessionSummary.items.length > 5 && (
                <button
                  className="textButton sessionListToggle"
                  type="button"
                  onClick={() => setShowAllSessions((visible) => !visible)}
                  aria-expanded={showAllSessions}
                >
                  {showAllSessions ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  {showAllSessions
                    ? '收起设备'
                    : `展开其余 ${sessionSummary.items.length - 5} 个设备`}
                </button>
              )}
            </div>

            {sessionError && <div className="formError" role="alert">{sessionError}</div>}
            {sessionSuccess && <div className="formSuccess" role="status">{sessionSuccess}</div>}

            <div className="settingsFormActions sessionActions">
              <button
                className="dangerButton"
                type="button"
                onClick={() => setRevokeAllDialogOpen(true)}
                disabled={!sessionSummary || sessionSummary.activeSessions === 0}
              >
                <LogOut size={18} />
                退出所有设备
              </button>
            </div>
          </section>

          <section className="settingsSection" aria-labelledby="security-activity-title">
            <header className="settingsSectionHeader">
              <span className="settingsSectionIcon" aria-hidden="true"><History size={19} /></span>
              <div>
                <h2 id="security-activity-title">安全活动</h2>
                <span>{securityEvents ? `共 ${securityEvents.total} 条记录` : '账号安全记录'}</span>
              </div>
            </header>

            <div className="securityEventList" aria-label="近期安全活动">
              {securityEvents === null && !securityEventError ? (
                <div className="sessionListLoading">
                  <LoaderCircle className="spin" size={18} />正在加载安全活动
                </div>
              ) : securityEvents?.items.length === 0 ? (
                <div className="sessionListLoading">暂无安全活动</div>
              ) : visibleSecurityEvents.map((event) => {
                const description = describeSecurityEvent(event);
                const EventIcon = event.eventType === 'login_failed'
                  ? AlertTriangle
                  : event.eventType === 'account_locked'
                    || event.eventType === 'refresh_token_reused'
                    ? ShieldAlert
                    : event.eventType === 'account_unlocked'
                      ? ShieldCheck
                  : event.eventType === 'login_succeeded'
                    ? LogIn
                    : event.eventType === 'profile_updated'
                      ? UserRound
                      : event.eventType === 'password_changed'
                        ? KeyRound
                        : event.eventType === 'account_registered'
                          ? ShieldCheck
                          : LogOut;
                return (
                  <article className="securityEventRow" key={event.id}>
                    <span
                      className={`securityEventIcon${event.outcome === 'failure' ? ' failure' : ''}`}
                      aria-hidden="true"
                    >
                      <EventIcon size={17} />
                    </span>
                    <div className="securityEventDetails">
                      <header>
                        <strong>{description.title}</strong>
                        <span className={`securityEventOutcome ${event.outcome}`}>
                          {event.outcome === 'failure' ? '已拦截' : '成功'}
                        </span>
                      </header>
                      <small>{description.detail}</small>
                      <div>
                        <span><MonitorSmartphone size={13} />{event.deviceName}</span>
                        <span><MapPin size={13} />{event.ipAddress || 'IP 未记录'}</span>
                        <span><Clock3 size={13} />{formatSessionDate(event.createdAt)}</span>
                      </div>
                    </div>
                  </article>
                );
              })}
              {securityEvents && securityEvents.items.length > 6 && (
                <button
                  className="textButton sessionListToggle"
                  type="button"
                  onClick={() => setShowAllSecurityEvents((visible) => !visible)}
                  aria-expanded={showAllSecurityEvents}
                >
                  {showAllSecurityEvents ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  {showAllSecurityEvents
                    ? '收起安全活动'
                    : `展开其余 ${securityEvents.items.length - 6} 条记录`}
                </button>
              )}
            </div>

            {securityEventError && (
              <div className="formError securityEventError" role="alert">{securityEventError}</div>
            )}
            {securityEvents && securityEvents.total > securityEvents.items.length && (
              <p className="securityEventLimitNote">
                已显示最近 {securityEvents.items.length} 条，共 {securityEvents.total} 条
              </p>
            )}
          </section>
        </div>
      </div>

      <SessionRevokeDialog
        open={revokeAllDialogOpen || Boolean(revokingSession)}
        scope={revokeAllDialogOpen ? 'all' : 'single'}
        sessionName={revokingSession?.deviceName}
        currentSession={revokingSession?.current}
        onClose={() => {
          setRevokeAllDialogOpen(false);
          setRevokingSession(null);
        }}
        onConfirm={revokeAllDialogOpen
          ? handleRevokeAllSessions
          : () => revokingSession ? handleRevokeSession(revokingSession) : Promise.resolve()}
      />
    </WorkspaceShell>
  );
}
