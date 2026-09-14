import { useCallback, useState } from 'react';
import { Button } from './Button';

interface PendingConfirm {
  message: string;
  resolve: (value: boolean) => void;
}

/**
 * Promise-based Yes/No confirmation, for flows (like the timeline drag prompts) where a native
 * `window.confirm` reads as too blunt for the app's polish level. Usage:
 *   const { confirm, dialog } = useConfirmDialog();
 *   const ok = await confirm('Move resources with the project?');
 *   // render `{dialog}` once, near the top of the component tree.
 */
export function useConfirmDialog() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => setPending({ message, resolve }));
  }, []);

  function respond(value: boolean): void {
    pending?.resolve(value);
    setPending(null);
  }

  const dialog = pending ? (
    <div className="confirm-dialog-overlay" role="presentation" onClick={() => respond(false)}>
      <div className="confirm-dialog" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <p className="confirm-dialog-message">{pending.message}</p>
        <div className="confirm-dialog-actions">
          <Button variant="ghost" onClick={() => respond(false)}>Non</Button>
          <Button variant="primary" onClick={() => respond(true)}>Oui</Button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, dialog };
}
