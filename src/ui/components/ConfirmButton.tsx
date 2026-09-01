import { useEffect, useRef, useState } from 'react';
import { Button } from './Button';

/** Two-step inline delete confirmation — avoids a modal dialog for a low-risk, reversible-enough action. */
export function ConfirmButton({ label, confirmLabel = 'Confirm', onConfirm }: { label: string; confirmLabel?: string; onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  if (!confirming) {
    return (
      <Button
        variant="ghost"
        icon="trash"
        size="sm"
        onClick={() => {
          setConfirming(true);
          timer.current = setTimeout(() => setConfirming(false), 3000);
        }}
      >
        {label}
      </Button>
    );
  }

  return (
    <Button
      variant="danger"
      size="sm"
      onClick={() => {
        if (timer.current) clearTimeout(timer.current);
        setConfirming(false);
        onConfirm();
      }}
    >
      {confirmLabel}?
    </Button>
  );
}
