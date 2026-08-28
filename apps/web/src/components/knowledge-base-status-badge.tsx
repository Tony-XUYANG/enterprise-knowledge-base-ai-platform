import type { KnowledgeBaseStatus } from '@/lib/types';

const labels: Record<KnowledgeBaseStatus, string> = {
  pending: '待处理',
  ready: '就绪',
  failed: '失败',
  disabled: '已停用',
};

export function KnowledgeBaseStatusBadge({ status }: { status: KnowledgeBaseStatus }) {
  return <span className={`statusBadge knowledge-status-${status}`}>{labels[status]}</span>;
}
