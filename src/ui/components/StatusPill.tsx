import { Icon } from './Icon';
import type { Severity } from '../../domain/types';

type PillTone = Severity | 'neutral';

const TONE_ICON: Record<PillTone, 'critical' | 'warning' | 'check' | 'info' | null> = {
  critical: 'critical',
  warning: 'warning',
  info: 'info',
  neutral: 'check',
};

export function StatusPill({ tone, children, icon = true }: { tone: PillTone; children: React.ReactNode; icon?: boolean }) {
  const iconName = TONE_ICON[tone];
  return (
    <span className={`pill pill-${tone}`}>
      {icon && iconName && <Icon name={iconName} size={12} />}
      {children}
    </span>
  );
}

export function healthTone(gap: number): PillTone {
  if (gap < -0.001) return 'critical';
  return 'neutral';
}
