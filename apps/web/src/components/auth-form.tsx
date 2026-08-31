'use client';

import {
  ArrowLeft,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LogIn,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useMemo, useState } from 'react';
import { ClientApiError, clientApi } from '@/lib/client-api';
import {
  assessPassword,
  PASSWORD_MAX_CHARACTERS,
  PASSWORD_MIN_CHARACTERS,
} from '@/lib/password-policy';
import type { MfaRequiredResult, User } from '@/lib/types';
import { Brand } from './brand';
import { PasswordStrength } from './password-strength';

interface AuthFormProps {
  mode: 'login' | 'register';
  successMessage?: string;
}

export function AuthForm({ mode, successMessage }: AuthFormProps) {
  const router = useRouter();
  const isRegister = mode === 'register';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [mfaChallenge, setMfaChallenge] = useState<MfaRequiredResult | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaMethod, setMfaMethod] = useState<'totp' | 'recovery'>('totp');
  const passwordAssessment = useMemo(
    () => assessPassword(password, { email, displayName }),
    [displayName, email, password],
  );
  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const registerReady = passwordAssessment.acceptable && passwordsMatch;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (isRegister && !registerReady) {
      setError(passwordsMatch ? '密码安全等级未达到要求' : '两次输入的密码不一致');
      return;
    }
    setSubmitting(true);

    try {
      const result = await clientApi<User | MfaRequiredResult>(`/api/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
          ...(isRegister ? { displayName } : {}),
        }),
      });
      if ('mfaRequired' in result && result.mfaRequired) {
        setMfaChallenge(result);
        setPassword('');
        return;
      }
      router.replace('/overview');
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof ClientApiError
          ? requestError.message
          : '无法连接服务器，请稍后重试',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMfaSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mfaChallenge || mfaCode.trim().length < 6) return;
    setError('');
    setSubmitting(true);
    try {
      await clientApi<User>('/api/auth/mfa/verify', {
        method: 'POST',
        body: JSON.stringify({ mfaToken: mfaChallenge.mfaToken, code: mfaCode }),
      });
      router.replace('/overview');
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof ClientApiError
          ? requestError.message
          : '身份验证失败，请稍后重试',
      );
    } finally {
      setSubmitting(false);
    }
  }

  function returnToLogin() {
    setMfaChallenge(null);
    setMfaCode('');
    setMfaMethod('totp');
    setError('');
  }

  return (
    <main className="authPage">
      <div className="authHeader">
        <Brand />
      </div>

      <section className="authPanel" aria-labelledby="auth-title">
        <div className="authTitleGroup">
          <h1 id="auth-title">{mfaChallenge ? '验证身份' : isRegister ? '创建账号' : '登录'}</h1>
          <p>
            {mfaChallenge
              ? '完成双重验证后进入工作台'
              : isRegister
                ? '开始管理你的 AI 应用'
                : '继续进入工作台'}
          </p>
        </div>

        {mfaChallenge ? (
          <form className="authForm mfaLoginForm" onSubmit={handleMfaSubmit}>
            <div className="mfaLoginMark" aria-hidden="true"><ShieldCheck size={24} /></div>
            <div className="segmentedControl" aria-label="验证方式">
              <button
                type="button"
                className={mfaMethod === 'totp' ? 'active' : ''}
                onClick={() => {
                  setMfaMethod('totp');
                  setMfaCode('');
                  setError('');
                }}
              >
                验证器
              </button>
              <button
                type="button"
                className={mfaMethod === 'recovery' ? 'active' : ''}
                onClick={() => {
                  setMfaMethod('recovery');
                  setMfaCode('');
                  setError('');
                }}
              >
                恢复码
              </button>
            </div>

            <label className="field">
              <span>{mfaMethod === 'totp' ? '6 位验证码' : '恢复码'}</span>
              <input
                name="mfaCode"
                className="mfaCodeInput"
                value={mfaCode}
                onChange={(event) => setMfaCode(event.target.value)}
                autoComplete="one-time-code"
                inputMode={mfaMethod === 'totp' ? 'numeric' : 'text'}
                pattern={mfaMethod === 'totp' ? '[0-9]{6}' : undefined}
                maxLength={mfaMethod === 'totp' ? 6 : 40}
                placeholder={mfaMethod === 'totp' ? '000000' : 'XXXX-XXXX-XXXX-XXXX-XXXX'}
                autoFocus
                required
              />
            </label>

            {error && <div className="formError" role="alert">{error}</div>}

            <button
              className="primaryButton fullWidth"
              type="submit"
              disabled={submitting || mfaCode.trim().length < 6}
            >
              {submitting ? <LoaderCircle className="spin" size={18} /> : <KeyRound size={18} />}
              {submitting ? '正在验证' : '验证并登录'}
            </button>
            <button className="textButton authBackButton" type="button" onClick={returnToLogin}>
              <ArrowLeft size={17} />返回密码登录
            </button>
          </form>
        ) : (
        <form className="authForm" onSubmit={handleSubmit}>
          {successMessage && (
            <div className="formSuccess" role="status">
              {successMessage}
            </div>
          )}
          {isRegister && (
            <label className="field">
              <span>姓名</span>
              <input
                name="displayName"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                autoComplete="name"
                maxLength={80}
                required
              />
            </label>
          )}

          <label className="field">
            <span>邮箱</span>
            <input
              name="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              maxLength={320}
              required
            />
          </label>

          <label className="field">
            <span>密码</span>
            <span className="passwordInput">
              <input
                name="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                minLength={isRegister ? PASSWORD_MIN_CHARACTERS : 1}
                maxLength={PASSWORD_MAX_CHARACTERS}
                aria-describedby={isRegister ? 'password-policy' : undefined}
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

          {!isRegister && (
            <Link className="authRecoveryLink" href="/forgot-password">忘记密码？</Link>
          )}

          {isRegister && (
            <PasswordStrength assessment={passwordAssessment} id="password-policy" />
          )}

          {isRegister && (
            <label className="field">
              <span>确认密码</span>
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
                  {passwordsMatch ? '两次密码一致' : '两次输入的密码不一致'}
                </small>
              )}
            </label>
          )}

          {error && (
            <div className="formError" role="alert">
              {error}
            </div>
          )}

          <button className="primaryButton fullWidth" type="submit" disabled={submitting || (isRegister && !registerReady)}>
            {submitting ? (
              <LoaderCircle className="spin" size={18} />
            ) : isRegister ? (
              <UserPlus size={18} />
            ) : (
              <LogIn size={18} />
            )}
            {submitting ? '正在提交' : isRegister ? '创建账号' : '登录'}
          </button>
        </form>

        )}

        {!mfaChallenge && <p className="authSwitch">
          {isRegister ? '已有账号？' : '还没有账号？'}{' '}
          <Link href={isRegister ? '/login' : '/register'}>
            {isRegister ? '直接登录' : '立即注册'}
          </Link>
        </p>}
      </section>
    </main>
  );
}
