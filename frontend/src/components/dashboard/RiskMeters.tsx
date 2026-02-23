import type { DashboardData } from '../../types/api';

interface Props {
  data: DashboardData;
}

export function RiskMeters({ data }: Props) {
  const risk = data.risk;
  const pnl = data.realizedPnlUsd + data.unrealizedPnlUsd;

  // Daily loss utilization
  const lossUsedPct =
    risk.maxDailyLossUsd > 0
      ? Math.min(100, (Math.abs(Math.min(0, pnl)) / risk.maxDailyLossUsd) * 100)
      : 0;

  // Position utilization
  const posUsed = data.positions.length;
  const posMax = risk.maxOpenPositions || 1;
  const posUsedPct = (posUsed / posMax) * 100;

  const meters: Array<{
    label: string;
    pct: number;
    color: string;
    text: string;
  }> = [
    {
      label: 'Daily Loss',
      pct: lossUsedPct,
      color:
        lossUsedPct > 70 ? '#ef4444' : lossUsedPct > 40 ? '#f59e0b' : '#10b981',
      text: `${lossUsedPct.toFixed(0)}%`,
    },
    {
      label: 'Open Positions',
      pct: Math.min(100, posUsedPct),
      color: posUsed >= posMax ? '#ef4444' : '#3b82f6',
      text: `${posUsed}/${posMax}`,
    },
  ];

  const riskItems: Array<[string, string]> = [
    ['Max Position', `$${risk.maxPositionUsd}`],
    ['Max Daily Loss', `$${risk.maxDailyLossUsd}`],
    ['Max Open Pos', String(risk.maxOpenPositions)],
    ['Cooldown', `${risk.cooldownMinutes}m`],
  ];

  return (
    <div className="card">
      <div className="section-title">Risk / Limits</div>

      {/* Risk grid */}
      <div className="grid grid-cols-2 gap-2.5 mb-4">
        {riskItems.map(([label, value]) => (
          <div
            key={label}
            className="bg-surface2 rounded-input p-3 border border-border"
          >
            <div className="text-[0.66rem] uppercase tracking-wider text-muted">
              {label}
            </div>
            <div className="text-base font-bold mt-1">{value}</div>
          </div>
        ))}
      </div>

      <div className="section-title">Utilisation</div>

      {/* Utilization meters */}
      <div className="flex flex-col gap-3">
        {meters.map((m) => (
          <div key={m.label}>
            <div className="flex justify-between text-xs text-muted mb-1">
              <span>{m.label}</span>
              <span style={{ color: m.color }}>{m.text}</span>
            </div>
            <div className="meter-bar">
              <div
                className="meter-fill"
                style={{ width: `${m.pct}%`, background: m.color }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
