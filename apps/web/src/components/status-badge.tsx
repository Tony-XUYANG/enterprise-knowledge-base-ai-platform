import type { AppStatus } from '@/lib/types';

const labels: Record<AppStatus, string> = {
  draft: '草稿',
  active: '已启用',
  disabled: '已停用',
};

export function StatusBadge({ status }: { status: AppStatus }) {
  return <span className={`statusBadge status-${status}`}>{labels[status]}</span>;
}
