'use client';

import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  LoaderCircle,
  Mail,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { ClientApiError, clientApi } from '@/lib/client-api';
import {
  assessPassword,
  PASSWORD_MAX_CHARACTERS,
  PASSWORD_MIN_CHARACTERS,
} from '@/lib/password-policy';
import type { InvitationAcceptance, InvitationPreview } from '@/lib/types';
import { Brand } from './brand';
import { PasswordStrength } from './password-strength';

export function InvitationAcceptanceForm({ token }: { token: string }) {
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [invalidMessage, setInvalidMessage] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState<InvitationAcceptance | null>(null);

  useEffect(() => {
    window.history.replaceState(null, '', '/accept-invitation');
    if (!token) {
      setInvalidMessage('邀请链接不完整，请使用邮件中的完整链接');
      setLoading(false);
      return;
    }
    let mounted = true;
    clientApi<InvitationPreview>('/api/invitations/inspect', {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
      .then((result) => {
        if (mounted) setPreview(result);
      })
      .catch((requestError: unknown) => {
        if (!mounted) return;
        setInvalidMessage(
          requestError instanceof ClientApiError
            ? requestError.message
            : '邀请链接无法验证，请稍后重试',
        );
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [token]);

  const assessment = useMemo(
    () => assessPassword(password, {
      email: preview?.email,
      displayName,
    }),
    [displayName, password, preview?.email],
  );
  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const ready = Boolean(preview && displayName.trim() && assessment.acceptable && passwordsMatch);

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await clientApi<InvitationAcceptance>('/api/invitations/accept', {
        method: 'POST',
        body: JSON.stringify({ token, displayName, password }),
      });
      setAccepted(result);
      setPassword('');
      setConfirmPassword('');
    } catch (requestError) {
      setError(
        requestError instanceof ClientApiError
          ? requestError.message
          : '接受邀请失败，请稍后重试',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="authPage invitationAcceptancePage">
      <div className="authHeader"><Brand /></div>
      <section className="authPanel invitationAcceptancePanel" aria-labelledby="invitation-title">
        {loading ? (
          <div className="invitationState">
            <LoaderCircle className="spin" size={28} />
            <h1 id="invitation-title">正在验证邀请</h1>
          </div>
        ) : invalidMessage ? (
          <div className="invitationState invalid">
            <span className="mfaLoginMark" aria-hidden="true"><Mail size={24} /></span>
            <h1 id="invitation-title">邀请不可用</h1>
            <p>{invalidMessage}</p>
            <Link className="secondaryButton" href="/login">返回登录</Link>
          </div>
        ) : accepted ? (
          <div className="invitationState success">
            <span className="invitationSuccessIcon" aria-hidden="true"><CheckCircle2 size={28} /></span>
            <h1 id="invitation-title">账号创建完成</h1>
            <p>{accepted.email}</p>
            <span className="invitationRoleSummary">
              <ShieldCheck size={16} />
              {accepted.role === 'admin' ? '管理员' : '普通成员'}
            </span>
            <Link className="primaryButton fullWidth" href="/login">
              登录工作台<ArrowRight size={18} />
            </Link>
          </div>
        ) : (
          <>
            <div className="authTitleGroup">
              <h1 id="invitation-title">接受成员邀请</h1>
              <p>{preview?.inviterName ? `${preview.inviterName} 邀请你加入 KnowledgeHub` : '创建账号后加入 KnowledgeHub'}</p>
            </div>
            <div className="invitationSummary">
              <span><Mail size={16} />{preview?.email}</span>
              <span><ShieldCheck size={16} />{preview?.role === 'admin' ? '管理员' : '普通成员'}</span>
            </div>
            <form className="authForm" onSubmit={accept}>
              <label className="field">
                <span>姓名</span>
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  autoComplete="name"
                  maxLength={80}
                  required
                />
              </label>
              <label className="field">
                <span>密码</span>
                <span className="passwordInput">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="new-password"
                    minLength={PASSWORD_MIN_CHARACTERS}
                    maxLength={PASSWORD_MAX_CHARACTERS}
                    aria-describedby="invitation-password-policy"
                    required
                  />
                  <button
                    className="inputIconButton"
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    title={showPassword ? '隐藏密码' : '显示密码'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </span>
              </label>
              <PasswordStrength assessment={assessment} id="invitation-password-policy" />
              <label className="field">
                <span>确认密码</span>
                <input
                  type={showPassword ? 'text' : 'password'}
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
                    {passwordsMatch ? '两次密码一致' : '两次输入的密码不一致'}
                  </small>
                )}
              </label>
              {error && <div className="formError" role="alert">{error}</div>}
              <button className="primaryButton fullWidth" type="submit" disabled={submitting || !ready}>
                {submitting ? <LoaderCircle className="spin" size={18} /> : <UserPlus size={18} />}
                {submitting ? '正在创建账号' : '接受邀请并创建账号'}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
