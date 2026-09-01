import { useEffect, useRef, useState } from 'react';

export function NumberField({
  value,
  onCommit,
  step = 0.5,
  min = 0,
  placeholder = '0',
  className,
  autoFocus,
}: {
  value: number;
  onCommit: (value: number) => void;
  step?: number;
  min?: number;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(value ? String(value) : '');
  const skipCommitRef = useRef(false);

  useEffect(() => {
    setText(value ? String(value) : '');
  }, [value]);

  function commit(): void {
    if (skipCommitRef.current) {
      skipCommitRef.current = false;
      return;
    }
    const parsed = parseFloat(text);
    const next = Number.isFinite(parsed) ? Math.max(min, parsed) : 0;
    setText(next ? String(next) : '');
    if (next !== value) onCommit(next);
  }

  return (
    <input
      type="number"
      inputMode="decimal"
      className={className}
      value={text}
      placeholder={placeholder}
      step={step}
      min={min}
      autoFocus={autoFocus}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          (e.target as HTMLInputElement).blur();
        } else if (e.key === 'Escape') {
          skipCommitRef.current = true;
          setText(value ? String(value) : '');
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
