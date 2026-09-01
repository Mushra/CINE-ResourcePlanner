import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: IconName;
  size?: 'sm' | 'md';
}

export function Button({ variant = 'secondary', icon, size = 'md', className, children, ...rest }: ButtonProps) {
  return (
    <button type="button" className={`btn btn-${variant} btn-${size} ${className ?? ''}`} {...rest}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </button>
  );
}
