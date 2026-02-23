import type { ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  accentColor: string;
  valueColor?: string;
  icon?: ReactNode;
}

export function StatCard({ label, value, sub, accentColor, valueColor, icon }: StatCardProps) {
  return (
    <div className="card">
      <div className="stat-accent" style={{ background: accentColor }} />
      <div className="flex items-start justify-between mb-2">
        <span className="card-label">{label}</span>
        {icon && <span className="text-muted">{icon}</span>}
      </div>
      <div className="card-value" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </div>
      {sub && <div className="card-sub">{sub}</div>}
    </div>
  );
}
