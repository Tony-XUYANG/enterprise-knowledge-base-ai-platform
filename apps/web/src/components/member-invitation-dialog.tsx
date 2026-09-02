'use client';

import { LoaderCircle, MailPlus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ManagedUserRole } from '@/lib/types';

export interface InvitationFormInput {
  email: string;
  role: ManagedUserRole;
}

interface MemberInvitationDialogProps {
  open: boolean;
  onClose: () => void;
  onInvite: (input: InvitationFormInput) => Promise<void>;
}

export function MemberInvitationDialog({
  open,
  onClose,
  onInvite,
}: MemberInvitationDialogProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ManagedUserRole>('member');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setEmail('');
    setRole('member');
    setError('');
    setSubmitting(false);
  }, [open]);

  if (!open) return null;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await onInvite({ email, role });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '邀请发送失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dialogBackdrop" role="presentation">
      <section className="dialogPanel invitationDialog" role="dialog" aria-modal="true" aria-labelledby="invite-member-title">
        <header className="dialogHeader">
          <div className="dialogTitleWithIcon">
            <span className="settingsSectionIcon" aria-hidden="true"><MailPlus size={19} /></span>
            <span>
              <h2 id="invite-member-title">邀请成员</h2>
              <small>邀请链接将发送到成员邮箱</small>
            </span>
          </div>
          <button className="iconButton" type="button" onClick={onClose} disabled={submitting} aria-label="关闭" title="关闭">
            <X size={19} />
          </button>
        </header>
        <form className="dialogForm" onSubmit={submit}>
          <label className="field">
            <span>成员邮箱</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              maxLength={320}
              placeholder="name@company.com"
              autoFocus
              required
            />
          </label>
          <label className="field">
            <span>账号角色</span>
            <select value={role} onChange={(event) => setRole(event.target.value as ManagedUserRole)}>
              <option value="member">普通成员</option>
              <option value="admin">管理员</option>
            </select>
            <small>管理员可以管理所有平台成员及邀请。</small>
          </label>
          {error && <div className="formError" role="alert">{error}</div>}
          <footer className="dialogActions">
            <button className="secondaryButton" type="button" onClick={onClose} disabled={submitting}>取消</button>
            <button className="primaryButton" type="submit" disabled={submitting || !email.trim()}>
              {submitting ? <LoaderCircle className="spin" size={18} /> : <MailPlus size={18} />}
              {submitting ? '正在发送' : '发送邀请'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
