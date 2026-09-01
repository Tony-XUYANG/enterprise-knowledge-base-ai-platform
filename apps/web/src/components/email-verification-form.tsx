'use client';

import {
  ArrowLeft,
  CircleCheckBig,
  LoaderCircle,
  Mail,
  MailCheck,
  Send,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { ClientApiError, clientApi } from '@/lib/client-api';
import { Brand } from './brand';

interface EmailVerificationFormProps {
  token: string;
  initialEmail: string;
  registered: boolean;
}

interface VerificationRequestAccepted {
  accepted: boolean;
  message: string;
}

export function EmailVerificationForm({
  token,
  initialEmail,
  registered,
}: EmailVerificationFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [verified, setVerified] = useState(false);
  const [success, setSuccess] = useState(
    registered ? '验证邮件已发送，请检查收件箱' : '',
  );
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setSubmitting(true);
    setError('');
    try {
      await clientApi<void>('/api/auth/email-verification/confirm', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      window.history.replaceState(null, '', '/verify-email?verified=1');
      setVerified(true);
    } catch (requestError) {
      setError(
        requestError instanceof ClientApiError
          ? requestError.message
          : '无法验证邮箱，请稍后重试',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const result = await clientApi<VerificationRequestAccepted>(
        '/api/auth/email-verification/resend',
        { method: 'POST', body: JSON.stringify({ email }) },
      );
      setSuccess(result.message);
    } catch (requestError) {
      setError(
        requestError instanceof ClientApiError
          ? requestError.message
          : '无法发送验证邮件，请稍后重试',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (verified) {
    return (
      <main className="authPage">
        <div className="authHeader"><Brand /></div>
        <section className="authPanel verificationResult" aria-labelledby="email-verified-title">
          <span className="verificationMark success" aria-hidden="true">
            <CircleCheckBig size={28} />
          </span>
          <div className="authTitleGroup">
            <h1 id="email-verified-title">邮箱验证成功</h1>
            <p>账号已激活，可以安全登录工作台</p>
          </div>
          <Link className="primaryButton fullWidth" href="/login">
            <MailCheck size={18} />前往登录
          </Link>
        </section>
      </main>
    );
  }

  const confirming = Boolean(token);
  return (
    <main className="authPage">
      <div className="authHeader"><Brand /></div>
      <section className="authPanel" aria-labelledby="email-verification-title">
        <span className="verificationMark" aria-hidden="true">
          {confirming ? <MailCheck size={26} /> : <Mail size={26} />}
        </span>
        <div className="authTitleGroup verificationTitleGroup">
          <h1 id="email-verification-title">
            {confirming ? '验证邮箱' : registered ? '检查邮箱' : '发送验证邮件'}
          </h1>
          <p>
            {confirming
              ? '确认此邮箱用于登录 KnowledgeHub'
              : registered
                ? `验证链接已发送至 ${initialEmail}`
                : '接收新的邮箱验证链接'}
          </p>
        </div>

        {confirming ? (
          <form className="authForm" onSubmit={handleConfirm}>
            {error && <div className="formError" role="alert">{error}</div>}
            <button className="primaryButton fullWidth" type="submit" disabled={submitting}>
              {submitting ? <LoaderCircle className="spin" size={18} /> : <MailCheck size={18} />}
              {submitting ? '正在验证' : '确认验证邮箱'}
            </button>
            {error && (
              <button
                className="secondaryButton fullWidth"
                type="button"
                onClick={() => router.replace('/verify-email')}
              >
                <Send size={17} />重新发送验证邮件
              </button>
            )}
          </form>
        ) : (
          <form className="authForm" onSubmit={handleResend}>
            <label className="field">
              <span>登录邮箱</span>
              <span className="fieldWithIcon">
                <Mail size={17} aria-hidden="true" />
                <input
                  name="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  maxLength={320}
                  required
                  autoFocus={!initialEmail}
                />
              </span>
            </label>
            {success && <div className="formSuccess" role="status">{success}</div>}
            {error && <div className="formError" role="alert">{error}</div>}
            <button className="primaryButton fullWidth" type="submit" disabled={submitting}>
              {submitting ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}
              {submitting ? '正在发送' : registered ? '重新发送' : '发送验证邮件'}
            </button>
          </form>
        )}

        <p className="authSwitch">
          <Link href="/login"><ArrowLeft size={15} />返回登录</Link>
        </p>
      </section>
    </main>
  );
}
