'use client';

import { Eye, EyeOff, KeyRound, LoaderCircle, Save, ShieldCheck, X } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import type { AiApp, AppStatus } from '@/lib/types';

export interface AppFormInput {
  name: string;
  description: string | null;
  fastgptAppId: string | null;
  fastgptApiKey?: string;
  clearFastgptApiKey?: true;
  status: AppStatus;
  settings: { temperature: number };
}

interface ApplicationDialogProps {
  open: boolean;
  app: AiApp | null;
  onClose: () => void;
  onSave: (input: AppFormInput) => Promise<void>;
}

export function ApplicationDialog({ open, app, onClose, onSave }: ApplicationDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [fastgptAppId, setFastgptAppId] = useState('');
  const [fastgptApiKey, setFastgptApiKey] = useState('');
  const [clearFastgptApiKey, setClearFastgptApiKey] = useState(false);
  const [showFastgptApiKey, setShowFastgptApiKey] = useState(false);
  const [status, setStatus] = useState<AppStatus>('draft');
  const [temperature, setTemperature] = useState(0.2);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(app?.name ?? '');
    setDescription(app?.description ?? '');
    setFastgptAppId(app?.fastgptAppId ?? '');
    setFastgptApiKey('');
    setClearFastgptApiKey(false);
    setShowFastgptApiKey(false);
    setStatus(app?.status ?? 'draft');
    setTemperature(
      typeof app?.settings.temperature === 'number' ? app.settings.temperature : 0.2,
    );
    setError('');
  }, [app, open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open, saving]);

  if (!open) return null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      await onSave({
        name,
        description: description || null,
        fastgptAppId: fastgptAppId || null,
        ...(fastgptApiKey ? { fastgptApiKey } : {}),
        ...(clearFastgptApiKey ? { clearFastgptApiKey: true as const } : {}),
        status,
        settings: { temperature },
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dialogBackdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <section className="dialogPanel" role="dialog" aria-modal="true" aria-labelledby="app-dialog-title">
        <header className="dialogHeader">
          <h2 id="app-dialog-title">{app ? '编辑应用' : '创建应用'}</h2>
          <button
            className="iconButton"
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="关闭"
            title="关闭"
          >
            <X size={19} />
          </button>
        </header>

        <form className="dialogForm" onSubmit={handleSubmit}>
          <label className="field">
            <span>应用名称</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} autoFocus required />
          </label>

          <label className="field">
            <span>描述</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={3} />
          </label>

          <div className="formGrid">
            <label className="field">
              <span>FastGPT App ID</span>
              <input value={fastgptAppId} onChange={(event) => setFastgptAppId(event.target.value)} maxLength={120} />
            </label>

            <label className="field">
              <span>状态</span>
              <select value={status} onChange={(event) => setStatus(event.target.value as AppStatus)}>
                <option value="draft">草稿</option>
                <option value="active">已启用</option>
                <option value="disabled">已停用</option>
              </select>
            </label>
          </div>

          <div className="field secretField">
            <span className="credentialFieldHeader">
              <span>FastGPT API Key</span>
              {app?.hasFastgptApiKey && !clearFastgptApiKey && (
                <small className="credentialConfigured" id="app-api-key-state">
                  <ShieldCheck size={13} />已加密保存
                </small>
              )}
            </span>
            <span className="passwordInput">
              <input
                value={fastgptApiKey}
                type={showFastgptApiKey ? 'text' : 'password'}
                onChange={(event) => {
                  setFastgptApiKey(event.target.value);
                  if (event.target.value) setClearFastgptApiKey(false);
                }}
                placeholder={app?.hasFastgptApiKey ? '输入新密钥以替换现有配置' : '输入 API Key'}
                autoComplete="off"
                minLength={8}
                maxLength={1000}
                disabled={clearFastgptApiKey}
                aria-describedby={app?.hasFastgptApiKey && !clearFastgptApiKey ? 'app-api-key-state' : undefined}
              />
              <button
                className="inputIconButton"
                type="button"
                onClick={() => setShowFastgptApiKey((visible) => !visible)}
                disabled={clearFastgptApiKey}
                aria-label={showFastgptApiKey ? '隐藏 API Key' : '显示 API Key'}
                title={showFastgptApiKey ? '隐藏 API Key' : '显示 API Key'}
              >
                {showFastgptApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
            {app?.hasFastgptApiKey && (
              <label className="secretClearOption">
                <input
                  type="checkbox"
                  checked={clearFastgptApiKey}
                  onChange={(event) => {
                    setClearFastgptApiKey(event.target.checked);
                    if (event.target.checked) {
                      setFastgptApiKey('');
                      setShowFastgptApiKey(false);
                    }
                  }}
                />
                <span>移除已保存的 API Key</span>
              </label>
            )}
            {!app?.hasFastgptApiKey && (
              <small className="credentialEmpty"><KeyRound size={13} />尚未配置</small>
            )}
          </div>

          <label className="field rangeField">
            <span>
              Temperature
              <output>{temperature.toFixed(1)}</output>
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={temperature}
              onChange={(event) => setTemperature(Number(event.target.value))}
            />
          </label>

          {error && <div className="formError" role="alert">{error}</div>}

          <footer className="dialogActions">
            <button className="secondaryButton" type="button" onClick={onClose} disabled={saving}>
              取消
            </button>
            <button className="primaryButton" type="submit" disabled={saving}>
              {saving ? <LoaderCircle className="spin" size={18} /> : <Save size={18} />}
              {saving ? '保存中' : '保存'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
