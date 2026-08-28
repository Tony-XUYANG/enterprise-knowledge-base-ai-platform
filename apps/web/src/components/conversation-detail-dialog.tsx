'use client';

import {
  Bot,
  CircleAlert,
  LoaderCircle,
  MessageSquareText,
  Send,
  Settings2,
  UserRound,
  Wrench,
  X,
} from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import type { ConversationDetail, MessageRole } from '@/lib/types';
import { ConversationStatusBadge } from './conversation-status-badge';

const roleLabels: Record<MessageRole, string> = {
  system: '系统',
  user: '用户',
  assistant: '助手',
  tool: '工具',
};

const roleIcons = {
  system: Settings2,
  user: UserRound,
  assistant: Bot,
  tool: Wrench,
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

export function ConversationDetailDialog({
  open,
  detail,
  loading,
  onSend,
  onClose,
}: {
  open: boolean;
  detail: ConversationDetail | null;
  loading: boolean;
  onSend: (message: string) => Promise<void>;
  onClose: () => void;
}) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const timelineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setMessage('');
    setError('');
  }, [detail?.conversation.id, open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !sending) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open, sending]);

  useEffect(() => {
    if (!open || !detail) return;
    const frame = window.requestAnimationFrame(() => {
      if (timelineRef.current) timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [detail, open]);

  if (!open) return null;

  const archived = detail?.conversation.status === 'archived';

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedMessage = message.trim();
    if (!normalizedMessage) return;
    setSending(true);
    setError('');
    try {
      await onSend(normalizedMessage);
      setMessage('');
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : '消息发送失败，请稍后重试');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="dialogBackdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !sending) onClose();
    }}>
      <section className="dialogPanel conversationDetailDialog" role="dialog" aria-modal="true" aria-labelledby="conversation-detail-title">
        <header className="dialogHeader">
          <div className="dialogTitleWithIcon">
            <span className="conversationTitleIcon" aria-hidden="true"><MessageSquareText size={18} /></span>
            <span>
              <h2 id="conversation-detail-title">{detail?.conversation.title ?? '对话详情'}</h2>
              <small>{detail?.conversation.appName ?? '正在读取会话记录'}</small>
            </span>
          </div>
          <button className="iconButton" type="button" onClick={onClose} disabled={sending} aria-label="关闭" title="关闭">
            <X size={19} />
          </button>
        </header>

        {loading || !detail ? (
          <div className="conversationDetailLoading"><LoaderCircle className="spin" size={20} />正在加载消息</div>
        ) : (
          <>
            <div className="conversationDetailMeta">
              <ConversationStatusBadge status={detail.conversation.status} />
              <span>{detail.messages.length} 条消息</span>
              <span>创建于 {formatDateTime(detail.conversation.createdAt)}</span>
            </div>
            <div className="messageTimeline" ref={timelineRef} aria-label="消息时间线">
              {detail.messages.length === 0 ? (
                <div className="messageEmpty">这段对话还没有消息</div>
              ) : detail.messages.map((timelineMessage) => {
                const RoleIcon = roleIcons[timelineMessage.role];
                const tokenTotal = (timelineMessage.promptTokens ?? 0) + (timelineMessage.completionTokens ?? 0);
                return (
                  <article className={`messageEntry messageRole-${timelineMessage.role}`} key={timelineMessage.id}>
                    <span className="messageRoleIcon" aria-hidden="true"><RoleIcon size={16} /></span>
                    <div className="messageContent">
                      <header>
                        <strong>{roleLabels[timelineMessage.role]}</strong>
                        <span>#{timelineMessage.sequenceNo} · {formatDateTime(timelineMessage.createdAt)}</span>
                      </header>
                      <p>{timelineMessage.content}</p>
                      {(timelineMessage.model || tokenTotal > 0 || timelineMessage.latencyMs !== null || timelineMessage.status !== 'completed') && (
                        <footer>
                          {timelineMessage.model && <span>{timelineMessage.model}</span>}
                          {tokenTotal > 0 && <span>{tokenTotal} tokens</span>}
                          {timelineMessage.latencyMs !== null && <span>{timelineMessage.latencyMs} ms</span>}
                          {timelineMessage.status === 'pending' && <span><LoaderCircle className="spin" size={12} />生成中</span>}
                          {timelineMessage.status === 'failed' && <span className="messageFailure"><CircleAlert size={13} />{timelineMessage.errorCode || '生成失败'}</span>}
                        </footer>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
            <form className="conversationComposer" onSubmit={submitMessage}>
              <label className="srOnly" htmlFor="conversation-message-input">发送消息</label>
              <textarea
                id="conversation-message-input"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder={archived ? '对话已归档' : '输入测试消息'}
                maxLength={4000}
                rows={2}
                disabled={archived || sending}
                required
              />
              <button className="primaryButton" type="submit" disabled={archived || sending || !message.trim()}>
                {sending ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}
                {sending ? '生成中' : '发送'}
              </button>
              {error && <div className="formError conversationComposerError" role="alert">{error}</div>}
            </form>
          </>
        )}
      </section>
    </div>
  );
}
