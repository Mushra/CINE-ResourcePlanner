import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function EmptyState({
  icon, title, description, action, compact,
}: { icon: IconName; title: string; description: string; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={`empty-state ${compact ? 'empty-state-compact' : ''}`}>
      <div className="empty-state-icon"><Icon name={icon} size={compact ? 16 : 22} /></div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
