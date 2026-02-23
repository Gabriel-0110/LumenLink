import type { ReactNode } from 'react';
import { Package } from 'lucide-react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
}

export function EmptyState({ icon, title, description }: EmptyStateProps) {
  return (
    <div className="bg-surface border border-border rounded-card p-8 text-center">
      <div className="text-muted/50 mb-3 flex justify-center">
        {icon ?? <Package size={28} />}
      </div>
      <div className="text-sm font-medium text-muted">{title}</div>
      {description && <div className="text-xs text-muted/70 mt-1">{description}</div>}
    </div>
  );
}
