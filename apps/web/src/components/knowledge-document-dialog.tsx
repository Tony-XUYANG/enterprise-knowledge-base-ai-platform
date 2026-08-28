'use client';

import { FilePenLine, LoaderCircle, Save, X } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import type {
  KnowledgeDocument,
  KnowledgeDocumentSourceType,
  KnowledgeDocumentStatus,
} from '@/lib/types';

export interface KnowledgeDocumentFormInput {
  name: string;
  sourceType: KnowledgeDocumentSourceType;
  sourceUri: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  fastgptCollectionId: string | null;
  status: KnowledgeDocumentStatus;
  errorMessage: string | null;
}

interface KnowledgeDocumentDialogProps {
  open: boolean;
  knowledgeDocument: KnowledgeDocument | null;
  onClose: () => void;
  onSave: (input: KnowledgeDocumentFormInput) => Promise<void>;
}

export function KnowledgeDocumentDialog({
  open,
  knowledgeDocument,
  onClose,
  onSave,
}: KnowledgeDocumentDialogProps) {
  const [name, setName] = useState('');
  const [sourceType, setSourceType] = useState<KnowledgeDocumentSourceType>('file');
  const [sourceUri, setSourceUri] = useState('');
  const [mimeType, setMimeType] = useState('');
  const [sizeBytes, setSizeBytes] = useState('');
  const [fastgptCollectionId, setFastgptCollectionId] = useState('');
  const [status, setStatus] = useState<KnowledgeDocumentStatus>('pending');
  const [errorMessage, setErrorMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(knowledgeDocument?.name ?? '');
    setSourceType(knowledgeDocument?.sourceType ?? 'file');
    setSourceUri(knowledgeDocument?.sourceUri ?? '');
    setMimeType(knowledgeDocument?.mimeType ?? '');
    setSizeBytes(knowledgeDocument?.sizeBytes === null || knowledgeDocument?.sizeBytes === undefined
      ? ''
      : String(knowledgeDocument.sizeBytes));
    setFastgptCollectionId(knowledgeDocument?.fastgptCollectionId ?? '');
    setStatus(knowledgeDocument?.status ?? 'pending');
    setErrorMessage(knowledgeDocument?.errorMessage ?? '');
    setError('');
  }, [knowledgeDocument, open]);

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
        sourceType,
        sourceUri: sourceUri || null,
        mimeType: mimeType || null,
        sizeBytes: sizeBytes === '' ? null : Number(sizeBytes),
        fastgptCollectionId: fastgptCollectionId || null,
        status,
        errorMessage: errorMessage || null,
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '文档保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dialogBackdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose();
    }}>
      <section className="dialogPanel" role="dialog" aria-modal="true" aria-labelledby="document-dialog-title">
        <header className="dialogHeader">
          <span className="dialogTitleWithIcon">
            <span className="relationTitleIcon" aria-hidden="true"><FilePenLine size={19} /></span>
            <span>
              <h2 id="document-dialog-title">{knowledgeDocument ? '编辑文档' : '添加文档'}</h2>
              <small>{knowledgeDocument ? '更新解析与同步信息' : '登记知识库文档来源'}</small>
            </span>
          </span>
          <button className="iconButton" type="button" onClick={onClose} disabled={saving} aria-label="关闭" title="关闭">
            <X size={19} />
          </button>
        </header>

        <form className="dialogForm" onSubmit={handleSubmit}>
          <label className="field">
            <span>文档名称</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={255} autoFocus required />
          </label>

          <div className="formGrid equalFormGrid">
            <label className="field">
              <span>来源类型</span>
              <select value={sourceType} onChange={(event) => setSourceType(event.target.value as KnowledgeDocumentSourceType)}>
                <option value="file">文件</option>
                <option value="url">网页 URL</option>
                <option value="text">文本</option>
              </select>
            </label>
            <label className="field">
              <span>解析状态</span>
              <select value={status} onChange={(event) => setStatus(event.target.value as KnowledgeDocumentStatus)}>
                <option value="pending">待处理</option>
                <option value="processing">处理中</option>
                <option value="ready">就绪</option>
                <option value="failed">失败</option>
                <option value="disabled">已停用</option>
              </select>
            </label>
          </div>

          {sourceType === 'url' && (
            <label className="field">
              <span>来源 URL</span>
              <input type="url" value={sourceUri} onChange={(event) => setSourceUri(event.target.value)} maxLength={2000} required />
            </label>
          )}

          <div className="formGrid equalFormGrid">
            <label className="field">
              <span>MIME 类型</span>
              <input value={mimeType} onChange={(event) => setMimeType(event.target.value)} placeholder="text/markdown" maxLength={120} />
            </label>
            <label className="field">
              <span>文件大小（字节）</span>
              <input type="number" value={sizeBytes} onChange={(event) => setSizeBytes(event.target.value)} min={0} step={1} />
            </label>
          </div>

          <label className="field">
            <span>FastGPT Collection ID</span>
            <input value={fastgptCollectionId} onChange={(event) => setFastgptCollectionId(event.target.value)} maxLength={120} />
          </label>

          {status === 'failed' && (
            <label className="field">
              <span>失败原因</span>
              <textarea value={errorMessage} onChange={(event) => setErrorMessage(event.target.value)} maxLength={2000} rows={3} />
            </label>
          )}

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
