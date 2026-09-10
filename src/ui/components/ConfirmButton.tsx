import { useEffect, useRef, useState } from 'react';
import { Button } from './Button';
import type { IconName } from './Icon';

/** Two-step inline confirmation for a risky, hard-to-undo action — avoids a modal dialog for something reversible-enough. */
export function ConfirmButton({
  label, confirmLabel = 'Confirm', onConfirm, icon = 'trash',
}: {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void;
  icon?: IconName;
}) {
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  if (!confirming) {
    return (
      <Button
        variant="ghost"
        icon={icon}
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
