import type { ReactNode } from 'react';

type BadgeVariant = 'success' | 'danger' | 'warning' | 'info' | 'muted';

interface StatusBadgeProps {
  label: string;
  variant: BadgeVariant;
  icon?: ReactNode;
  dot?: boolean;
}

const variantClasses: Record<BadgeVariant, string> = {
  success: 'bg-profit/10 text-profit',
  danger: 'bg-loss/10 text-loss',
  warning: 'bg-warning/10 text-warning',
  info: 'bg-brand/10 text-brand',
  muted: 'bg-muted/20 text-muted',
};

export function StatusBadge({ label, variant, icon, dot }: StatusBadgeProps) {
  return (
    <span className={`pill gap-1 ${variantClasses[variant]}`}>
      {dot && (
        <span
          className={`w-1.5 h-1.5 rounded-full animate-pulse-dot ${
            variant === 'success'
              ? 'bg-profit'
              : variant === 'danger'
                ? 'bg-loss'
                : variant === 'warning'
                  ? 'bg-warning'
                  : variant === 'info'
                    ? 'bg-brand'
                    : 'bg-muted'
          }`}
        />
      )}
      {icon}
      {label}
    </span>
  );
}
