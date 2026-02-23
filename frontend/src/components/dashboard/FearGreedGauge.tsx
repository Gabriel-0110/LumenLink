import type { Sentiment } from '../../types/api';

interface Props {
  sentiment: Sentiment | null;
}

function getGaugeColor(value: number): string {
  if (value <= 25) return '#ef4444';
  if (value <= 45) return '#f59e0b';
  if (value <= 55) return '#64748b';
  if (value <= 75) return '#10b981';
  return '#06b6d4';
}

export function FearGreedGauge({ sentiment }: Props) {
  const value = sentiment?.fearGreedIndex ?? 50;
  const label = sentiment?.fearGreedLabel ?? '--';
  const newsScore = sentiment?.newsScore;
  const color = getGaugeColor(value);

  // Needle rotation: 0 = -90deg (extreme fear), 100 = +90deg (extreme greed)
  const needleDeg = (value / 100) * 180 - 90;

  return (
    <div className="card flex flex-col">
      <div className="card-label">Market Sentiment</div>
      <div className="flex-1 flex flex-col items-center justify-center gap-1 py-4">
        {/* SVG Gauge */}
        <svg
          width="180"
          height="100"
          viewBox="0 0 200 110"
          className="overflow-visible"
        >
          {/* Background arc segments */}
          <path
            d="M20,100 A80,80 0 0,1 54,30"
            fill="none"
            stroke="#1e3a5f"
            strokeWidth="14"
            strokeLinecap="round"
          />
          <path
            d="M54,30 A80,80 0 0,1 100,20"
            fill="none"
            stroke="#1e3a5f"
            strokeWidth="14"
            strokeLinecap="round"
          />
          <path
            d="M100,20 A80,80 0 0,1 146,30"
            fill="none"
            stroke="#1e3a5f"
            strokeWidth="14"
            strokeLinecap="round"
          />
          <path
            d="M146,30 A80,80 0 0,1 180,100"
            fill="none"
            stroke="#1e3a5f"
            strokeWidth="14"
            strokeLinecap="round"
          />

          {/* Needle */}
          <line
            x1="100"
            y1="100"
            x2="100"
            y2="28"
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
            transform={`rotate(${needleDeg},100,100)`}
          />
          <circle cx="100" cy="100" r="5" fill="#e2e8f0" />

          {/* Zone labels */}
          <text x="13" y="116" fontSize="8" fill="#64748b">
            E.Fear
          </text>
          <text x="100" y="14" fontSize="8" fill="#64748b" textAnchor="middle">
            Neutral
          </text>
          <text x="187" y="116" fontSize="8" fill="#64748b" textAnchor="end">
            E.Greed
          </text>
        </svg>

        {/* Value display */}
        <div className="text-[2.2rem] font-extrabold leading-none" style={{ color }}>
          {sentiment ? value : '--'}
        </div>
        <div className="text-sm font-semibold" style={{ color }}>
          {label}
        </div>

        {/* News score */}
        <div className="text-[0.68rem] text-muted mt-2">
          {newsScore != null
            ? `News: ${newsScore > 0 ? '+' : ''}${(newsScore * 100).toFixed(0)}%`
            : 'News: --'}
        </div>
      </div>
    </div>
  );
}
