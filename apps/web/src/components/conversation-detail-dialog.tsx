'use client';

import {
  Bot,
  CircleAlert,
  LoaderCircle,
  MessageSquareText,
  Settings2,
  UserRound,
  Wrench,
  X,
} from 'lucide-react';
import { useEffect } from 'react';
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
  onClose,
}: {
  open: boolean;
  detail: ConversationDetail | null;
  loading: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="dialogBackdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
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
          <button className="iconButton" type="button" onClick={onClose} aria-label="关闭" title="关闭">
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
            <div className="messageTimeline" aria-label="消息时间线">
              {detail.messages.length === 0 ? (
                <div className="messageEmpty">这段对话还没有消息</div>
              ) : detail.messages.map((message) => {
                const RoleIcon = roleIcons[message.role];
                const tokenTotal = (message.promptTokens ?? 0) + (message.completionTokens ?? 0);
                return (
                  <article className={`messageEntry messageRole-${message.role}`} key={message.id}>
                    <span className="messageRoleIcon" aria-hidden="true"><RoleIcon size={16} /></span>
                    <div className="messageContent">
                      <header>
                        <strong>{roleLabels[message.role]}</strong>
                        <span>#{message.sequenceNo} · {formatDateTime(message.createdAt)}</span>
                      </header>
                      <p>{message.content}</p>
                      {(message.model || tokenTotal > 0 || message.latencyMs !== null || message.status === 'failed') && (
                        <footer>
                          {message.model && <span>{message.model}</span>}
                          {tokenTotal > 0 && <span>{tokenTotal} tokens</span>}
                          {message.latencyMs !== null && <span>{message.latencyMs} ms</span>}
                          {message.status === 'failed' && <span className="messageFailure"><CircleAlert size={13} />{message.errorCode || '生成失败'}</span>}
                        </footer>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}

        <footer className="dialogActions">
          <button className="secondaryButton" type="button" onClick={onClose}>完成</button>
        </footer>
      </section>
    </div>
  );
}
