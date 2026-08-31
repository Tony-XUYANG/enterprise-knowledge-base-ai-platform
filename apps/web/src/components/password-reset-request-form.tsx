'use client';

import { ArrowLeft, LoaderCircle, Mail, Send } from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { ClientApiError, clientApi } from '@/lib/client-api';
import { Brand } from './brand';

interface PasswordResetAccepted {
  accepted: boolean;
  message: string;
}

export function PasswordResetRequestForm() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSuccess('');
    setSubmitting(true);
    try {
      const result = await clientApi<PasswordResetAccepted>('/api/auth/password-reset/request', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setSuccess(result.message);
    } catch (requestError) {
      setError(
        requestError instanceof ClientApiError
          ? requestError.message
          : '无法发送重置邮件，请稍后再试',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="authPage">
      <div className="authHeader"><Brand /></div>
      <section className="authPanel" aria-labelledby="password-reset-request-title">
        <div className="authTitleGroup">
          <h1 id="password-reset-request-title">找回密码</h1>
          <p>接收一次性密码重置链接</p>
        </div>

        <form className="authForm" onSubmit={handleSubmit}>
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
              />
            </span>
          </label>

          {success && <div className="formSuccess" role="status">{success}</div>}
          {error && <div className="formError" role="alert">{error}</div>}

          <button className="primaryButton fullWidth" type="submit" disabled={submitting}>
            {submitting ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}
            {submitting ? '正在发送' : '发送重置邮件'}
          </button>
        </form>

        <p className="authSwitch">
          <Link href="/login"><ArrowLeft size={15} />返回登录</Link>
        </p>
      </section>
    </main>
  );
}
