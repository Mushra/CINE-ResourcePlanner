import { useStore } from '../../store/useStore';
import { Icon } from './Icon';

export function Toaster() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="toaster" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <Icon name={t.kind === 'success' ? 'check' : t.kind === 'error' ? 'critical' : 'info'} size={14} />
          <span>{t.message}</span>
          <button type="button" className="toast-dismiss" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
