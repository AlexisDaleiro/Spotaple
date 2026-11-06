import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib/format';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: ReactNode;
  /** Nombre accesible; también se usa como tooltip. */
  label: string;
  /** Solo para botones de dos estados (aleatorio, favorito…). */
  pressed?: boolean;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'ghost' | 'solid';
}

export function IconButton({ icon, label, pressed, size = 'md', variant = 'ghost', className, ...rest }: Props) {
  return (
    <button
      type="button"
      className={cx('ibtn', `ibtn--${size}`, `ibtn--${variant}`, pressed && 'is-on', className)}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      {...rest}
    >
      {icon}
    </button>
  );
}
