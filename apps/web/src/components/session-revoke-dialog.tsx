'use client';

import { LoaderCircle, LogOut, X } from 'lucide-react';
import { useState } from 'react';

interface SessionRevokeDialogProps {
  open: boolean;
  scope: 'single' | 'all';
  sessionName?: string;
  currentSession?: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function SessionRevokeDialog({
  open,
  scope,
  sessionName,
  currentSession,
  onClose,
  onConfirm,
}: SessionRevokeDialogProps) {
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const revokeAll = scope === 'all';
  const title = revokeAll ? '退出所有设备' : currentSession ? '退出当前设备' : '退出此设备';
  const description = revokeAll
    ? '全部刷新会话将立即失效，所有设备都需要重新登录。'
    : `${sessionName ? `“${sessionName}”` : '此设备'}的刷新会话将立即失效。${currentSession ? '你需要重新登录。' : ''}`;

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
          <h2 id="session-revoke-title">{title}</h2>
          <p>{description}</p>
        </div>
        <footer className="dialogActions">
          <button className="secondaryButton" type="button" onClick={onClose} disabled={submitting}>
            取消
          </button>
          <button className="dangerButton" type="button" onClick={confirm} disabled={submitting}>
            {submitting ? <LoaderCircle className="spin" size={18} /> : <LogOut size={18} />}
            {submitting ? '正在退出' : title}
          </button>
        </footer>
      </section>
    </div>
  );
}
