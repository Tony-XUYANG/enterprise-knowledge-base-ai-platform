'use client';

import { Archive, Ban, LoaderCircle, Replace, Trash2, X } from 'lucide-react';
import { useState } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  appName: string;
  subjectLabel?: string;
  variant?: 'disable' | 'archive' | 'delete' | 'replace';
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function ConfirmDialog({
  open,
  appName,
  subjectLabel = '应用',
  variant = 'disable',
  onClose,
  onConfirm,
}: ConfirmDialogProps) {
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const isArchive = variant === 'archive';
  const isDelete = variant === 'delete';
  const isReplace = variant === 'replace';
  const ActionIcon = isDelete ? Trash2 : isArchive ? Archive : isReplace ? Replace : Ban;
  const actionLabel = isDelete ? '删除' : isArchive ? '归档' : isReplace ? '覆盖' : '停用';

  async function confirm() {
    setSubmitting(true);
    try {
      await onConfirm();
    } catch {
      // The parent surface displays the API error and keeps the dialog open for retry.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dialogBackdrop" role="presentation">
      <section className="dialogPanel confirmPanel" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <header className="dialogHeader">
          <span className="dangerIcon" aria-hidden="true"><ActionIcon size={20} /></span>
          <button className="iconButton" type="button" onClick={onClose} disabled={submitting} aria-label="关闭" title="关闭">
            <X size={19} />
          </button>
        </header>
        <div className="confirmBody">
          <h2 id="confirm-title">{actionLabel}“{appName}”</h2>
          <p>
            {isReplace
              ? `覆盖后，${subjectLabel}的现有分块将被新内容替换。`
              : isDelete
              ? `删除后${subjectLabel}无法恢复。`
              : `${actionLabel}后${subjectLabel}将保留数据，可以稍后重新启用。`}
          </p>
        </div>
        <footer className="dialogActions">
          <button className="secondaryButton" type="button" onClick={onClose} disabled={submitting}>取消</button>
          <button className={isReplace ? 'primaryButton' : 'dangerButton'} type="button" onClick={confirm} disabled={submitting}>
            {submitting ? <LoaderCircle className="spin" size={18} /> : <ActionIcon size={18} />}
            {submitting ? `${actionLabel}中` : `确认${actionLabel}`}
          </button>
        </footer>
      </section>
    </div>
  );
}
