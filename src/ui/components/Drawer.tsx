import { useEffect } from 'react';
import { Icon } from './Icon';

export function Drawer({ title, onClose, children, width = 420, dirty = false }: { title: string; onClose: () => void; children: React.ReactNode; width?: number; dirty?: boolean }) {
  function requestClose(): void {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    onClose();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (dirty && !window.confirm('Discard unsaved changes?')) return;
      onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dirty, onClose]);

  return (
    <div className="drawer-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}>
      <div className="drawer-panel" style={{ width }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-header">
          <h2>{title}</h2>
          <button type="button" className="drawer-close" onClick={requestClose} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </div>
    </div>
  );
}
