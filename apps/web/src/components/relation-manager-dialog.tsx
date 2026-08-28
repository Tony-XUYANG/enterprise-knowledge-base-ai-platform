'use client';

import { Link2, LoaderCircle, X } from 'lucide-react';
import { useEffect } from 'react';

export interface RelationOption {
  id: string;
  name: string;
  description: string | null;
  code: string | null;
  statusLabel: string;
  statusTone: 'positive' | 'warning' | 'muted' | 'danger';
  bound: boolean;
}

interface RelationManagerDialogProps {
  open: boolean;
  title: string;
  subjectName: string;
  optionLabel: string;
  options: RelationOption[];
  loading: boolean;
  togglingId: string | null;
  onClose: () => void;
  onToggle: (option: RelationOption, nextBound: boolean) => Promise<void>;
}

export function RelationManagerDialog({
  open,
  title,
  subjectName,
  optionLabel,
  options,
  loading,
  togglingId,
  onClose,
  onToggle,
}: RelationManagerDialogProps) {
  useEffect(() => {
    if (!open || togglingId) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open, togglingId]);

  if (!open) return null;

  return (
    <div
      className="dialogBackdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !togglingId) onClose();
      }}
    >
      <section className="dialogPanel relationDialog" role="dialog" aria-modal="true" aria-labelledby="relation-dialog-title">
        <header className="dialogHeader">
          <div className="dialogTitleWithIcon">
            <span className="relationTitleIcon" aria-hidden="true"><Link2 size={18} /></span>
            <span>
              <h2 id="relation-dialog-title">{title}</h2>
              <small>{subjectName}</small>
            </span>
          </div>
          <button className="iconButton" type="button" onClick={onClose} disabled={Boolean(togglingId)} aria-label="关闭" title="关闭">
            <X size={19} />
          </button>
        </header>

        <div className="relationList" aria-label={optionLabel}>
          {loading ? (
            <div className="relationLoading"><LoaderCircle className="spin" size={20} />正在加载</div>
          ) : options.length === 0 ? (
            <div className="relationEmpty">暂无可关联项目</div>
          ) : (
            options.map((option) => (
              <label className="relationRow" key={option.id}>
                <span className="relationIdentity">
                  <strong>{option.name}</strong>
                  <small>{option.code || option.description || '未配置外部 ID'}</small>
                </span>
                <span className={`relationStatus relationStatus-${option.statusTone}`}>
                  {option.statusLabel}
                </span>
                <span className="relationToggle">
                  {togglingId === option.id && <LoaderCircle className="spin" size={15} />}
                  <input
                    type="checkbox"
                    checked={option.bound}
                    disabled={Boolean(togglingId)}
                    onChange={(event) => void onToggle(option, event.target.checked)}
                    aria-label={`关联 ${option.name}`}
                  />
                </span>
              </label>
            ))
          )}
        </div>

        <footer className="dialogActions">
          <span className="relationSummary">已关联 {options.filter((option) => option.bound).length} 项</span>
          <button className="secondaryButton" type="button" onClick={onClose} disabled={Boolean(togglingId)}>完成</button>
        </footer>
      </section>
    </div>
  );
}
