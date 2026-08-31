'use client';

import {
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  QrCode,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  X,
} from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { ClientApiError, clientApi } from '@/lib/client-api';
import type {
  MfaActivation,
  MfaRecoveryCodeResult,
  MfaSetup,
  MfaStatus,
} from '@/lib/types';

interface MfaSettingsProps {
  onSecurityChanged: () => Promise<void>;
}

type MfaAction = 'setup' | 'regenerate' | 'disable';

export function MfaSettings({ onSecurityChanged }: MfaSettingsProps) {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [action, setAction] = useState<MfaAction | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [copied, setCopied] = useState<'secret' | 'codes' | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await clientApi<MfaStatus>('/api/auth/mfa'));
    } catch (requestError) {
      setError(
        requestError instanceof ClientApiError
          ? requestError.message
          : '双重验证状态加载失败，请稍后重试',
      );
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  function clearAction() {
    setAction(null);
    setSetup(null);
    setCurrentPassword('');
    setCode('');
    setShowPassword(false);
    setError('');
  }

  function beginAction(nextAction: MfaAction) {
    setAction(nextAction);
    setSetup(null);
    setRecoveryCodes([]);
    setCurrentPassword('');
    setCode('');
    setError('');
    setSuccess('');
  }

  async function handleSetupStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentPassword) return;
    setSubmitting(true);
    setError('');
    try {
      setSetup(await clientApi<MfaSetup>('/api/auth/mfa/setup', {
        method: 'POST',
        body: JSON.stringify({ currentPassword }),
      }));
      setCurrentPassword('');
    } catch (requestError) {
      setError(
        requestError instanceof ClientApiError
          ? requestError.message
          : '无法开始设置，请稍后重试',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEnable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!setup || code.length !== 6) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await clientApi<MfaActivation>('/api/auth/mfa/enable', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      setStatus({
        enabled: true,
        enabledAt: result.enabledAt,
        recoveryCodesRemaining: result.recoveryCodes.length,
      });
      setSetup(null);
      setAction(null);
      setCode('');
      setRecoveryCodes(result.recoveryCodes);
      setSuccess('双重验证已启用，其他设备会话已安全退出');
      await onSecurityChanged();
    } catch (requestError) {
      setError(
        requestError instanceof ClientApiError
          ? requestError.message
          : '双重验证启用失败，请稍后重试',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleProtectedAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || action === 'setup' || !currentPassword || code.trim().length < 6) return;
    setSubmitting(true);
    setError('');
    try {
      if (action === 'disable') {
        await clientApi<{ disabled: true; revokedSessions: number }>('/api/auth/mfa/disable', {
          method: 'POST',
          body: JSON.stringify({ currentPassword, code }),
        });
        setStatus({ enabled: false, enabledAt: null, recoveryCodesRemaining: 0 });
        setRecoveryCodes([]);
        setSuccess('双重验证已关闭，其他设备会话已安全退出');
      } else {
        const result = await clientApi<MfaRecoveryCodeResult>('/api/auth/mfa/recovery-codes', {
          method: 'POST',
          body: JSON.stringify({ currentPassword, code }),
        });
        setStatus((current) => current ? {
          ...current,
          recoveryCodesRemaining: result.recoveryCodes.length,
        } : current);
        setRecoveryCodes(result.recoveryCodes);
        setSuccess('恢复码已更新，旧恢复码已全部失效');
      }
      setAction(null);
      setCurrentPassword('');
      setCode('');
      await onSecurityChanged();
    } catch (requestError) {
      setError(
        requestError instanceof ClientApiError
          ? requestError.message
          : '操作失败，请稍后重试',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function copyText(value: string, target: 'secret' | 'codes') {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(target);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      setError('复制失败，请手动选择内容');
    }
  }

  function downloadRecoveryCodes() {
    const contents = [
      'KnowledgeHub 双重验证恢复码',
      '每个恢复码只能使用一次，请保存在安全位置。',
      '',
      ...recoveryCodes,
    ].join('\n');
    const url = URL.createObjectURL(new Blob([contents], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'knowledgehub-recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  }

  const formattedEnabledAt = status?.enabledAt
    ? new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(status.enabledAt))
    : null;

  return (
    <section className="settingsSection mfaSettingsSection" aria-labelledby="mfa-settings-title">
      <header className="settingsSectionHeader">
        <span className="settingsSectionIcon" aria-hidden="true"><ShieldCheck size={19} /></span>
        <div>
          <h2 id="mfa-settings-title">双重验证</h2>
          <span>验证器与恢复码</span>
        </div>
        {status && (
          <span className={`mfaStateBadge ${status.enabled ? 'enabled' : 'disabled'}`}>
            {status.enabled ? '已启用' : '未启用'}
          </span>
        )}
      </header>

      {status === null && !error ? (
        <div className="sessionListLoading"><LoaderCircle className="spin" size={18} />正在加载状态</div>
      ) : status && (
        <>
          <div className={`mfaStatusRow ${status.enabled ? 'enabled' : ''}`}>
            <span className="mfaStatusIcon" aria-hidden="true">
              {status.enabled ? <ShieldCheck size={21} /> : <Smartphone size={21} />}
            </span>
            <span>
              <strong>{status.enabled ? '账号受到双重验证保护' : '登录仅使用密码验证'}</strong>
              <small>
                {status.enabled
                  ? `启用于 ${formattedEnabledAt} · 剩余 ${status.recoveryCodesRemaining} 个恢复码`
                  : '使用验证器可以降低密码泄露带来的风险'}
              </small>
            </span>
          </div>

          {!status.enabled && action === null && recoveryCodes.length === 0 && (
            <div className="settingsFormActions">
              <button className="primaryButton" type="button" onClick={() => beginAction('setup')}>
                <QrCode size={18} />设置双重验证
              </button>
            </div>
          )}

          {status.enabled && action === null && recoveryCodes.length === 0 && (
            <div className="mfaActionButtons">
              <button className="secondaryButton" type="button" onClick={() => beginAction('regenerate')}>
                <RefreshCw size={17} />更新恢复码
              </button>
              <button className="dangerButton" type="button" onClick={() => beginAction('disable')}>
                <ShieldOff size={17} />关闭双重验证
              </button>
            </div>
          )}

          {action === 'setup' && !setup && (
            <form className="mfaActionForm" onSubmit={handleSetupStart}>
              <label className="field">
                <span>当前密码</span>
                <span className="passwordInput">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    autoComplete="current-password"
                    required
                    autoFocus
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
              <div className="mfaFormActions">
                <button className="secondaryButton" type="button" onClick={clearAction}>
                  <X size={17} />取消
                </button>
                <button className="primaryButton" type="submit" disabled={submitting || !currentPassword}>
                  {submitting ? <LoaderCircle className="spin" size={18} /> : <QrCode size={18} />}
                  {submitting ? '正在准备' : '生成二维码'}
                </button>
              </div>
            </form>
          )}

          {setup && (
            <div className="mfaSetupFlow">
              <div className="mfaQrArea">
                {/* The data URL is generated by the authenticated API from this one-time secret. */}
                <img src={setup.qrCodeDataUrl} alt="双重验证二维码" width="240" height="240" />
              </div>
              <div className="mfaSetupDetails">
                <span className="mfaStepLabel">验证器密钥</span>
                <div className="mfaManualKey">
                  <code>{setup.manualKey}</code>
                  <button
                    className="iconButton"
                    type="button"
                    onClick={() => void copyText(setup.manualKey, 'secret')}
                    aria-label="复制验证器密钥"
                    title="复制验证器密钥"
                  >
                    {copied === 'secret' ? <Check size={17} /> : <Copy size={17} />}
                  </button>
                </div>
                <form className="mfaEnableForm" onSubmit={handleEnable}>
                  <label className="field">
                    <span>验证器中的 6 位验证码</span>
                    <input
                      className="mfaCodeInput"
                      value={code}
                      onChange={(event) => setCode(event.target.value.replace(/\D/gu, '').slice(0, 6))}
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      placeholder="000000"
                      required
                      autoFocus
                    />
                  </label>
                  <div className="mfaFormActions">
                    <button className="secondaryButton" type="button" onClick={clearAction}>
                      <X size={17} />取消
                    </button>
                    <button className="primaryButton" type="submit" disabled={submitting || code.length !== 6}>
                      {submitting ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}
                      {submitting ? '正在启用' : '确认并启用'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {(action === 'regenerate' || action === 'disable') && (
            <form className="mfaActionForm" onSubmit={handleProtectedAction}>
              <div className="mfaActionHeading">
                <strong>{action === 'disable' ? '关闭双重验证' : '更新恢复码'}</strong>
                <small>
                  {action === 'disable'
                    ? '关闭后，后续登录将不再要求第二步验证。'
                    : '更新后，现有恢复码将立即失效。'}
                </small>
              </div>
              <label className="field">
                <span>当前密码</span>
                <span className="passwordInput">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    autoComplete="current-password"
                    required
                    autoFocus
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
              <label className="field">
                <span>{action === 'disable' ? '验证码或恢复码' : '6 位验证码'}</span>
                <input
                  className="mfaCodeInput"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  autoComplete="one-time-code"
                  inputMode={action === 'disable' ? 'text' : 'numeric'}
                  maxLength={action === 'disable' ? 40 : 6}
                  required
                />
              </label>
              <div className="mfaFormActions">
                <button className="secondaryButton" type="button" onClick={clearAction}>
                  <X size={17} />取消
                </button>
                <button
                  className={action === 'disable' ? 'dangerButton' : 'primaryButton'}
                  type="submit"
                  disabled={submitting || !currentPassword || code.trim().length < 6}
                >
                  {submitting
                    ? <LoaderCircle className="spin" size={18} />
                    : action === 'disable'
                      ? <ShieldOff size={18} />
                      : <RefreshCw size={18} />}
                  {submitting ? '正在处理' : action === 'disable' ? '确认关闭' : '生成新恢复码'}
                </button>
              </div>
            </form>
          )}

          {recoveryCodes.length > 0 && (
            <div className="mfaRecoveryPanel" role="status">
              <div className="mfaRecoveryHeader">
                <span>
                  <KeyRound size={19} aria-hidden="true" />
                  <strong>保存恢复码</strong>
                </span>
                <small>每个恢复码只能使用一次</small>
              </div>
              <div className="mfaRecoveryGrid">
                {recoveryCodes.map((recoveryCode) => <code key={recoveryCode}>{recoveryCode}</code>)}
              </div>
              <div className="mfaRecoveryActions">
                <button
                  className="secondaryButton"
                  type="button"
                  onClick={() => void copyText(recoveryCodes.join('\n'), 'codes')}
                >
                  {copied === 'codes' ? <Check size={17} /> : <Copy size={17} />}
                  {copied === 'codes' ? '已复制' : '复制'}
                </button>
                <button className="secondaryButton" type="button" onClick={downloadRecoveryCodes}>
                  <Download size={17} />下载
                </button>
                <button
                  className="primaryButton"
                  type="button"
                  onClick={() => {
                    setRecoveryCodes([]);
                    setSuccess('恢复码已确认保存');
                  }}
                >
                  <Check size={17} />已安全保存
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {error && <div className="formError" role="alert">{error}</div>}
      {success && <div className="formSuccess" role="status">{success}</div>}
    </section>
  );
}
