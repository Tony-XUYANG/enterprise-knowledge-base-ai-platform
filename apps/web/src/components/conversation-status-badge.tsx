import type { ConversationStatus } from '@/lib/types';

const labels: Record<ConversationStatus, string> = {
  active: '进行中',
  archived: '已归档',
};

export function ConversationStatusBadge({ status }: { status: ConversationStatus }) {
  return <span className={`statusBadge conversation-status-${status}`}>{labels[status]}</span>;
}
