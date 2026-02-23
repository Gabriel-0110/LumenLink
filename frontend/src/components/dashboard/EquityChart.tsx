import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { DashboardData } from '../../types/api';

interface Props {
  data: DashboardData;
}

function fmtUsd(v: number): string {
  const sign = v >= 0 ? '+' : '';
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

export function EquityChart({ data }: Props) {
  const curve = data.equityCurve ?? [];
  const totalPnl = curve.length > 0 ? curve[curve.length - 1].cumPnl : data.realizedPnlUsd;
  const isPositive = totalPnl >= 0;

  return (
    <div className="card flex flex-col">
      <div className="card-label">Cumulative P&L (14d)</div>
      <div className="flex items-baseline gap-2 mb-3">
        <span
          className={`text-[1.4rem] font-extrabold ${isPositive ? 'text-profit' : 'text-loss'}`}
        >
          {fmtUsd(totalPnl)}
        </span>
        <span className="text-xs text-muted">all-time realized</span>
      </div>
      <div className="flex-1 min-h-[220px]">
        {curve.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={curve} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
              <defs>
                <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor={isPositive ? '#10b981' : '#ef4444'}
                    stopOpacity={0.15}
                  />
                  <stop
                    offset="95%"
                    stopColor={isPositive ? '#10b981' : '#ef4444'}
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={{ stroke: '#1e2d40' }}
                tick={{ fill: '#64748b', fontSize: 11 }}
                tickFormatter={(v: string) => v.slice(5)}
              />
              <YAxis
                tickLine={false}
                axisLine={{ stroke: '#1e2d40' }}
                tick={{ fill: '#64748b', fontSize: 11 }}
                tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                width={50}
              />
              <Tooltip
                contentStyle={{
                  background: '#1a2235',
                  border: '1px solid #1e2d40',
                  borderRadius: 8,
                  color: '#e2e8f0',
                  fontSize: 12,
                }}
                formatter={(value: number) => [fmtUsd(value), 'P&L']}
                labelFormatter={(label: string) => label}
              />
              <Area
                type="monotone"
                dataKey="cumPnl"
                stroke={isPositive ? '#10b981' : '#ef4444'}
                strokeWidth={2}
                fill="url(#equityGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-muted">
            No equity data yet
          </div>
        )}
      </div>
    </div>
  );
}
