'use client';

import { LoaderCircle, LogOut, X } from 'lucide-react';
import { useState } from 'react';

interface SessionRevokeDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function SessionRevokeDialog({
  open,
  onClose,
  onConfirm,
}: SessionRevokeDialogProps) {
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  async function confirm() {
    setSubmitting(true);
    try {
      await onConfirm();
    } catch {
      // The account surface keeps the dialog open and displays the API error.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dialogBackdrop" role="presentation">
      <section
        className="dialogPanel confirmPanel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="session-revoke-title"
      >
        <header className="dialogHeader">
          <span className="dangerIcon" aria-hidden="true"><LogOut size={20} /></span>
          <button
            className="iconButton"
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="关闭"
            title="关闭"
          >
            <X size={19} />
          </button>
        </header>
        <div className="confirmBody">
          <h2 id="session-revoke-title">退出所有设备</h2>
          <p>全部刷新会话将立即失效，所有设备都需要重新登录。</p>
        </div>
        <footer className="dialogActions">
          <button className="secondaryButton" type="button" onClick={onClose} disabled={submitting}>
            取消
          </button>
          <button className="dangerButton" type="button" onClick={confirm} disabled={submitting}>
            {submitting ? <LoaderCircle className="spin" size={18} /> : <LogOut size={18} />}
            {submitting ? '正在退出' : '确认退出'}
          </button>
        </footer>
      </section>
    </div>
  );
}
