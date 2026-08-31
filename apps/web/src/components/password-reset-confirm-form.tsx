'use client';

import { ArrowLeft, Eye, EyeOff, KeyRound, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useMemo, useState } from 'react';
import { ClientApiError, clientApi } from '@/lib/client-api';
import {
  assessPassword,
  PASSWORD_MAX_CHARACTERS,
  PASSWORD_MIN_CHARACTERS,
} from '@/lib/password-policy';
import { Brand } from './brand';
import { PasswordStrength } from './password-strength';

interface PasswordResetConfirmFormProps {
  token: string;
}

export function PasswordResetConfirmForm({ token }: PasswordResetConfirmFormProps) {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const assessment = useMemo(() => assessPassword(newPassword), [newPassword]);
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const formReady = Boolean(token && assessment.acceptable && passwordsMatch);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!token) {
      setError('密码重置链接无效或已过期');
      return;
    }
    if (!passwordsMatch) {
      setError('两次输入的新密码不一致');
      return;
    }
    if (!assessment.acceptable) {
      setError('新密码安全等级未达到要求');
      return;
    }

    setSubmitting(true);
    try {
      await clientApi<void>('/api/auth/password-reset/confirm', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword }),
      });
      router.replace('/login?passwordReset=1');
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof ClientApiError
          ? requestError.message
          : '无法重置密码，请稍后再试',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="authPage">
      <div className="authHeader"><Brand /></div>
      <section className="authPanel" aria-labelledby="password-reset-confirm-title">
        <div className="authTitleGroup">
          <h1 id="password-reset-confirm-title">设置新密码</h1>
          <p>完成后所有设备都需要重新登录</p>
        </div>

        <form className="authForm" onSubmit={handleSubmit}>
          {!token && (
            <div className="formError" role="alert">密码重置链接无效或已过期</div>
          )}
          <label className="field">
            <span>新密码</span>
            <span className="passwordInput">
              <input
                name="newPassword"
                type={showPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                minLength={PASSWORD_MIN_CHARACTERS}
                maxLength={PASSWORD_MAX_CHARACTERS}
                aria-describedby="reset-password-policy"
                required
              />
              <button
                className="inputIconButton"
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? '隐藏新密码' : '显示新密码'}
                title={showPassword ? '隐藏新密码' : '显示新密码'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </label>

          <PasswordStrength assessment={assessment} id="reset-password-policy" />

          <label className="field">
            <span>确认新密码</span>
            <input
              name="confirmPassword"
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
                {passwordsMatch ? '两次密码一致' : '两次输入的新密码不一致'}
              </small>
            )}
          </label>

          {error && <div className="formError" role="alert">{error}</div>}

          <button className="primaryButton fullWidth" type="submit" disabled={submitting || !formReady}>
            {submitting ? <LoaderCircle className="spin" size={18} /> : <KeyRound size={18} />}
            {submitting ? '正在重置' : '重置密码'}
          </button>
        </form>

        <p className="authSwitch">
          <Link href="/login"><ArrowLeft size={15} />返回登录</Link>
        </p>
      </section>
    </main>
  );
}
