'use client';

import { LoaderCircle, Save, X } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import type { AiApp, Conversation } from '@/lib/types';

export interface ConversationFormInput {
  appId: string;
  title: string;
}

interface ConversationDialogProps {
  open: boolean;
  conversation: Conversation | null;
  apps: AiApp[];
  onClose: () => void;
  onSave: (input: ConversationFormInput) => Promise<void>;
}

export function ConversationDialog({
  open,
  conversation,
  apps,
  onClose,
  onSave,
}: ConversationDialogProps) {
  const [title, setTitle] = useState('');
  const [appId, setAppId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(conversation?.title ?? '新对话');
    setAppId(conversation?.appId ?? apps[0]?.id ?? '');
    setError('');
  }, [apps, conversation, open]);

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
      await onSave({ appId, title });
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
      <section className="dialogPanel compactDialog" role="dialog" aria-modal="true" aria-labelledby="conversation-dialog-title">
        <header className="dialogHeader">
          <h2 id="conversation-dialog-title">
            {conversation ? '重命名对话' : '创建对话'}
          </h2>
          <button className="iconButton" type="button" onClick={onClose} disabled={saving} aria-label="关闭" title="关闭">
            <X size={19} />
          </button>
        </header>

        <form className="dialogForm" onSubmit={handleSubmit}>
          <label className="field">
            <span>对话标题</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} autoFocus required />
          </label>

          <label className="field">
            <span>所属应用</span>
            <select value={appId} onChange={(event) => setAppId(event.target.value)} disabled={Boolean(conversation)} required>
              {apps.map((app) => (
                <option value={app.id} key={app.id}>
                  {app.name}{app.status === 'disabled' ? '（已停用）' : ''}
                </option>
              ))}
            </select>
          </label>

          {apps.length === 0 && <div className="formError" role="alert">请先创建一个 AI 应用</div>}
          {error && <div className="formError" role="alert">{error}</div>}

          <footer className="dialogActions">
            <button className="secondaryButton" type="button" onClick={onClose} disabled={saving}>取消</button>
            <button className="primaryButton" type="submit" disabled={saving || !appId}>
              {saving ? <LoaderCircle className="spin" size={18} /> : <Save size={18} />}
              {saving ? '保存中' : '保存'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
