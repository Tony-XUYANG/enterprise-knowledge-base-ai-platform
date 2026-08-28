import type { LucideIcon } from 'lucide-react';

export interface WorkspaceStatItem {
  label: string;
  value: number;
  icon: LucideIcon;
  tone?: 'default' | 'positive' | 'warning';
}

export function WorkspaceStats({
  label,
  items,
}: {
  label: string;
  items: WorkspaceStatItem[];
}) {
  return (
    <section className="statStrip" aria-label={label}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div className={`statItem statTone-${item.tone ?? 'default'}`} key={item.label}>
            <span className="statIcon" aria-hidden="true"><Icon size={17} /></span>
            <span>
              <small>{item.label}</small>
              <strong>{item.value}</strong>
            </span>
          </div>
        );
      })}
    </section>
  );
}
