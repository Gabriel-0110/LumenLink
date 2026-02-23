import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import type { DailySummary } from '../../types/api';

interface Props {
  weekly: DailySummary[];
}

export function WeeklyPnlChart({ weekly }: Props) {
  // Reverse so oldest is on the left
  const chartData = [...(weekly ?? [])].reverse().map((d) => ({
    date: d.date.slice(5), // MM-DD
    value: +d.netPnlUsd.toFixed(2),
  }));

  return (
    <div className="card">
      <div className="section-title">7-Day P&L</div>
      <div className="h-[260px]">
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tick={{ fill: '#64748b', fontSize: 11 }}
              />
              <YAxis
                tickLine={false}
                axisLine={{ stroke: '#1e2d40' }}
                tick={{ fill: '#64748b', fontSize: 11 }}
                tickFormatter={(v: number) =>
                  `${v >= 0 ? '+' : ''}$${Math.abs(v).toFixed(0)}`
                }
                width={55}
              />
              <Tooltip
                contentStyle={{
                  background: '#1a2235',
                  border: '1px solid #1e2d40',
                  borderRadius: 8,
                  color: '#e2e8f0',
                  fontSize: 12,
                }}
                formatter={(value: number) => [
                  `${value >= 0 ? '+' : ''}$${Math.abs(value).toFixed(2)}`,
                  'P&L',
                ]}
              />
              <Bar dataKey="value" radius={[5, 5, 0, 0]} maxBarSize={40}>
                {chartData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.value >= 0 ? 'rgba(16,185,129,0.7)' : 'rgba(239,68,68,0.7)'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-muted">
            No weekly data yet
          </div>
        )}
      </div>
    </div>
  );
}
