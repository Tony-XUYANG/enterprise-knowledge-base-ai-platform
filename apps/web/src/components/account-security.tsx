'use client';

import {
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LogOut,
  MonitorSmartphone,
  Save,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { ClientApiError, clientApi } from '@/lib/client-api';
import {
  assessPassword,
  PASSWORD_MAX_CHARACTERS,
  PASSWORD_MIN_CHARACTERS,
} from '@/lib/password-policy';
import type { SessionSummary, User } from '@/lib/types';
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
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);

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
    return () => {
      mounted = false;
    };
  }, [router]);

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

  function formatLastLogin(value: string | null | undefined) {
    if (!value) return '暂无记录';
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
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
              <span><strong>会话保护</strong><small>更新后，所有设备都需要使用新密码重新登录。</small></span>
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

            {sessionError && <div className="formError" role="alert">{sessionError}</div>}

            <div className="settingsFormActions sessionActions">
              <button
                className="dangerButton"
                type="button"
                onClick={() => setSessionDialogOpen(true)}
                disabled={!sessionSummary || sessionSummary.activeSessions === 0}
              >
                <LogOut size={18} />
                退出所有设备
              </button>
            </div>
          </section>
        </div>
      </div>

      <SessionRevokeDialog
        open={sessionDialogOpen}
        onClose={() => setSessionDialogOpen(false)}
        onConfirm={handleRevokeAllSessions}
      />
    </WorkspaceShell>
  );
}
