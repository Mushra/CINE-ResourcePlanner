import { useCallback, useState } from 'react';
import { Button } from './Button';

interface PendingConfirm {
  message: string;
  resolve: (value: boolean) => void;
}

export type Confirm3Result = 'yes' | 'no' | 'cancel';

interface PendingConfirm3 {
  message: string;
  yesLabel: string;
  noLabel: string;
  cancelLabel: string;
  resolve: (value: Confirm3Result) => void;
}

/**
 * Promise-based Yes/No/Cancel confirmations, for flows (like the timeline drag prompts) where a
 * native `window.confirm` reads as too blunt for the app's polish level, and a binary Yes/No isn't
 * enough (e.g. the move-resources prompt also needs a way to abort the whole action). Usage:
 *   const { confirm, confirm3, dialog } = useConfirmDialog();
 *   const ok = await confirm('Move resources with the project?');
 *   const choice = await confirm3('Move resources too?'); // 'yes' | 'no' | 'cancel'
 *   // render `{dialog}` once, near the top of the component tree.
 */
export function useConfirmDialog() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [pending3, setPending3] = useState<PendingConfirm3 | null>(null);

  const confirm = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => setPending({ message, resolve }));
  }, []);

  const confirm3 = useCallback((
    message: string,
    opts?: { yesLabel?: string; noLabel?: string; cancelLabel?: string },
  ): Promise<Confirm3Result> => {
    return new Promise((resolve) => setPending3({
      message,
      yesLabel: opts?.yesLabel ?? 'Oui',
      noLabel: opts?.noLabel ?? 'Non',
      cancelLabel: opts?.cancelLabel ?? 'Annuler',
      resolve,
    }));
  }, []);

  function respond(value: boolean): void {
    pending?.resolve(value);
    setPending(null);
  }

  function respond3(value: Confirm3Result): void {
    pending3?.resolve(value);
    setPending3(null);
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
  ) : pending3 ? (
    <div className="confirm-dialog-overlay" role="presentation" onClick={() => respond3('cancel')}>
      <div className="confirm-dialog" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <p className="confirm-dialog-message">{pending3.message}</p>
        <div className="confirm-dialog-actions">
          <Button variant="ghost" onClick={() => respond3('cancel')}>{pending3.cancelLabel}</Button>
          <Button variant="ghost" onClick={() => respond3('no')}>{pending3.noLabel}</Button>
          <Button variant="primary" onClick={() => respond3('yes')}>{pending3.yesLabel}</Button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, confirm3, dialog };
}
