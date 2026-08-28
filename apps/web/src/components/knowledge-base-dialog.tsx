'use client';

import { LoaderCircle, Save, X } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import type { KnowledgeBase, KnowledgeBaseStatus } from '@/lib/types';

export interface KnowledgeBaseFormInput {
  name: string;
  description: string | null;
  fastgptDatasetId: string | null;
  status: KnowledgeBaseStatus;
  metadata: Record<string, unknown>;
}

interface KnowledgeBaseDialogProps {
  open: boolean;
  knowledgeBase: KnowledgeBase | null;
  onClose: () => void;
  onSave: (input: KnowledgeBaseFormInput) => Promise<void>;
}

export function KnowledgeBaseDialog({
  open,
  knowledgeBase,
  onClose,
  onSave,
}: KnowledgeBaseDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [datasetId, setDatasetId] = useState('');
  const [status, setStatus] = useState<KnowledgeBaseStatus>('pending');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(knowledgeBase?.name ?? '');
    setDescription(knowledgeBase?.description ?? '');
    setDatasetId(knowledgeBase?.fastgptDatasetId ?? '');
    setStatus(knowledgeBase?.status ?? 'pending');
    setError('');
  }, [knowledgeBase, open]);

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
        fastgptDatasetId: datasetId || null,
        status,
        metadata: knowledgeBase?.metadata ?? {},
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
      <section
        className="dialogPanel compactDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="knowledge-dialog-title"
      >
        <header className="dialogHeader">
          <h2 id="knowledge-dialog-title">
            {knowledgeBase ? '编辑知识库' : '创建知识库'}
          </h2>
          <button className="iconButton" type="button" onClick={onClose} disabled={saving} aria-label="关闭" title="关闭">
            <X size={19} />
          </button>
        </header>

        <form className="dialogForm" onSubmit={handleSubmit}>
          <label className="field">
            <span>知识库名称</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} autoFocus required />
          </label>

          <label className="field">
            <span>描述</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={3} />
          </label>

          <div className="formGrid">
            <label className="field">
              <span>FastGPT Dataset ID</span>
              <input value={datasetId} onChange={(event) => setDatasetId(event.target.value)} maxLength={120} />
            </label>

            <label className="field">
              <span>状态</span>
              <select value={status} onChange={(event) => setStatus(event.target.value as KnowledgeBaseStatus)}>
                <option value="pending">待处理</option>
                <option value="ready">就绪</option>
                <option value="failed">失败</option>
                <option value="disabled">已停用</option>
              </select>
            </label>
          </div>

          {error && <div className="formError" role="alert">{error}</div>}

          <footer className="dialogActions">
            <button className="secondaryButton" type="button" onClick={onClose} disabled={saving}>取消</button>
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
