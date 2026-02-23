import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

interface Props {
  wins: number;
  losses: number;
}

const COLORS = ['#10b981', '#ef4444'];

export function WinLossDonut({ wins, losses }: Props) {
  const total = wins + losses;
  const winRate = total > 0 ? (wins / total) * 100 : 0;

  const chartData = [
    { name: 'Wins', value: wins || 0.001 },
    { name: 'Losses', value: losses || 0.001 },
  ];

  return (
    <div className="card flex flex-col">
      <div className="section-title">Win / Loss</div>
      <div className="flex-1 flex flex-col items-center justify-center gap-2">
        {/* Donut with center label */}
        <div className="relative w-[150px] h-[150px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={45}
                outerRadius={65}
                paddingAngle={2}
                dataKey="value"
                strokeWidth={0}
              >
                {chartData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          {/* Center text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div
              className="text-2xl font-extrabold"
              style={{ color: winRate >= 50 ? '#10b981' : '#ef4444' }}
            >
              {winRate.toFixed(0)}%
            </div>
            <div className="text-[0.7rem] text-muted">win rate</div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-profit" />
            <span>{wins} wins</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-loss" />
            <span>{losses} losses</span>
          </span>
        </div>
      </div>
    </div>
  );
}
