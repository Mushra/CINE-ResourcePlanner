import type { ReactNode } from 'react';
import { useUiStore } from '../../store/useUiStore';
import { Icon } from './Icon';

/**
 * Controlled <details>/<summary> so collapse state survives outside React (persisted in
 * useUiStore, keyed by scopeKey) instead of resetting on every re-render.
 */
export function Collapsible({
  scopeKey,
  summary,
  count,
  defaultOpen = true,
  className,
  children,
}: {
  scopeKey: string;
  summary: ReactNode;
  count?: number;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const collapsedValue = useUiStore((s) => s.collapsed[scopeKey]);
  const toggleCollapse = useUiStore((s) => s.toggleCollapse);
  const isCollapsed = collapsedValue === undefined ? !defaultOpen : collapsedValue;

  return (
    <details
      className={`collapsible ${className ?? ''}`}
      open={!isCollapsed}
      onToggle={(e) => {
        if (e.target !== e.currentTarget) return; // ignore toggle events bubbling up from a nested Collapsible
        const open = (e.target as HTMLDetailsElement).open;
        if (open === isCollapsed) toggleCollapse(scopeKey);
      }}
    >
      <summary className="collapsible-summary">
        <Icon name="chevron-right" size={13} className="collapsible-chevron" />
        <span className="collapsible-summary-content">{summary}</span>
        {count !== undefined && <span className="collapsible-count">{count}</span>}
      </summary>
      <div className="collapsible-body">{children}</div>
    </details>
  );
}
