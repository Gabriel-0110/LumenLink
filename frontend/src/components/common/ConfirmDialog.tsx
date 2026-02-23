import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  message: string;
  confirmLabel: string;
  confirmVariant?: 'danger' | 'primary';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  message,
  confirmLabel,
  confirmVariant = 'danger',
  loading,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="flex items-center gap-2 p-3 bg-surface2 rounded-input border border-border">
      <AlertTriangle size={16} className="text-warning shrink-0" />
      <span className="text-sm">{message}</span>
      <button
        onClick={onConfirm}
        className={`${confirmVariant === 'danger' ? 'btn-danger' : 'btn-primary'} text-xs px-3 py-1.5 min-h-[36px]`}
        disabled={loading}
      >
        {loading ? 'Working...' : confirmLabel}
      </button>
      <button onClick={onCancel} className="btn-ghost text-xs px-2 py-1.5 min-h-[36px]">
        <X size={14} />
      </button>
    </div>
  );
}
